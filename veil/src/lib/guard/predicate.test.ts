import { describe, expect, it } from 'vitest'

import type { Column, NamedFormat } from '@/types/domain'

import { columnsInQuery, conditionHolds, evaluate, parseQuery } from './predicate'

/**
 * Predicate validation, written as a specification before the implementation existed.
 *
 * Owner: Riko. **These tests are red on purpose.** Implement `predicate.ts` to make them pass; do not
 * weaken, skip or delete a case — CONTRIBUTING.md § Some tests are red on purpose.
 *
 * This is the file that has to hold the line on "nothing from the model is executed". Several cases below
 * exist specifically because the field they reject will be proposed again by someone who has not read
 * docs/privacy-guard.md § Predicate limits.
 */

const COLUMNS: readonly Column[] = [
  { id: 'name', index: 0, type: 'text' },
  { id: 'phone', index: 1, type: 'text' },
  { id: 'city', index: 2, type: 'text' },
  { id: 'age', index: 3, type: 'integer' },
]

/** Stand-in recogniser: the real ones live in `lib/data/patterns.ts`. */
const matchesFormat = (value: string, format: NamedFormat): boolean =>
  format === 'blank' ? value.trim() === '' : format === 'phoneE164' && value.startsWith('+')

describe('parseQuery', () => {
  it('accepts a single well-formed condition', () => {
    // Arrange
    const raw = { conditions: [{ kind: 'isEmpty', column: 'phone' }], join: 'all' }

    // Act
    const result = parseQuery(raw, COLUMNS)

    // Assert
    expect(result.ok).toBe(true)
  })

  it('accepts exactly three conditions', () => {
    const raw = {
      conditions: [
        { kind: 'isEmpty', column: 'phone' },
        { kind: 'equals', column: 'city', value: 'Mataram' },
        { kind: 'compare', column: 'age', op: '>', value: 30 },
      ],
      join: 'all',
    }

    expect(parseQuery(raw, COLUMNS).ok).toBe(true)
  })

  it('rejects a fourth condition', () => {
    // Three is where "a legitimate data-cleaning question" and "a description of a person" separate.
    const raw = {
      conditions: [
        { kind: 'isEmpty', column: 'phone' },
        { kind: 'equals', column: 'city', value: 'Ampenan' },
        { kind: 'compare', column: 'age', op: '>', value: 70 },
        { kind: 'lengthBetween', column: 'name', min: 11, max: 11 },
      ],
      join: 'all',
    }

    const result = parseQuery(raw, COLUMNS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('tooManyConditions')
  })

  it('rejects an empty condition list', () => {
    // A predicate matching every row is a row count, which describe_dataset gives away free.
    expect(parseQuery({ conditions: [], join: 'all' }, COLUMNS).ok).toBe(false)
  })

  it('rejects an unknown column and lists the real ones', () => {
    // A bare "unknown column" costs the agent a question to rediscover something we already knew.
    const result = parseQuery(
      { conditions: [{ kind: 'isEmpty', column: 'telephone' }], join: 'all' },
      COLUMNS,
    )

    if (result.ok) throw new Error('expected refusal')
    expect(result.code).toBe('unknownColumn')
    expect(result.reason).toMatch(/phone/)
  })

  it('rejects a format outside the closed enum', () => {
    const result = parseQuery(
      { conditions: [{ kind: 'matchesFormat', column: 'phone', format: 'indonesianMobile' }], join: 'all' },
      COLUMNS,
    )

    if (result.ok) throw new Error('expected refusal')
    expect(result.code).toBe('unknownFormat')
  })

  it('rejects a regex passed as a format, and says what to use instead', () => {
    // This is the branch a model reaches when it wants pattern matching. The message has to teach, or the
    // model spends its budget trying variations of the same rejected idea.
    const result = parseQuery(
      { conditions: [{ kind: 'matchesFormat', column: 'phone', format: '^\\d{15}$' }], join: 'all' },
      COLUMNS,
    )

    if (result.ok) throw new Error('expected refusal')
    expect(result.code).toBe('unknownFormat')
    expect(result.reason).toMatch(/phoneE164|named format/i)
  })

  it('ignores a pattern field even when a valid format sits beside it', () => {
    // The dangerous shape: a model sends both, hoping one is honoured. The parser must build the condition
    // from the enum and drop the pattern entirely — not merge them, not prefer the pattern.
    const raw = {
      conditions: [
        { kind: 'matchesFormat', column: 'phone', format: 'phoneE164', pattern: '^0812(\\d)' },
      ],
      join: 'all',
    }

    const result = parseQuery(raw, COLUMNS)

    if (!result.ok) return // rejecting the unexpected field outright is also correct
    expect(JSON.stringify(result.query)).not.toMatch(/0812/)
  })

  it('rejects a nested condition tree', () => {
    // Arbitrary nesting can express a one-person predicate assembled from innocent parts. Deciding whether
    // a tree is too specific is open-ended; counting to three cannot be subtly wrong.
    const raw = {
      conditions: [
        { kind: 'any', conditions: [{ kind: 'isEmpty', column: 'phone' }] },
      ],
      join: 'all',
    }

    expect(parseQuery(raw, COLUMNS).ok).toBe(false)
  })

  it('rejects a join operator it does not know', () => {
    const raw = { conditions: [{ kind: 'isEmpty', column: 'phone' }], join: 'none' }

    expect(parseQuery(raw, COLUMNS).ok).toBe(false)
  })

  it('rejects a compare against a non-numeric column', () => {
    // Otherwise every string parses to NaN, nothing matches, and the agent reads a real zero.
    const raw = {
      conditions: [{ kind: 'compare', column: 'name', op: '>', value: 5 }],
      join: 'all',
    }

    expect(parseQuery(raw, COLUMNS).ok).toBe(false)
  })

  it('rejects a lengthBetween whose min exceeds its max', () => {
    const raw = {
      conditions: [{ kind: 'lengthBetween', column: 'name', min: 10, max: 3 }],
      join: 'all',
    }

    expect(parseQuery(raw, COLUMNS).ok).toBe(false)
  })

  it('accepts equals with a literal value', () => {
    // Considered and allowed. "How many rows say active" is the most ordinary question in data cleaning,
    // and refusing it would break the product. k-suppression is what keeps it safe: a guess narrow enough
    // to name one person comes back suppressed.
    const raw = {
      conditions: [{ kind: 'equals', column: 'city', value: 'Mataram' }],
      join: 'all',
    }

    expect(parseQuery(raw, COLUMNS).ok).toBe(true)
  })
})

describe('columnsInQuery', () => {
  it('lists each column once, however many conditions name it', () => {
    const result = parseQuery(
      {
        conditions: [
          { kind: 'lengthBetween', column: 'name', min: 1, max: 3 },
          { kind: 'isEmpty', column: 'name' },
        ],
        join: 'all',
      },
      COLUMNS,
    )

    if (!result.ok) throw new Error('expected a valid query')
    expect(columnsInQuery(result.query)).toEqual(['name'])
  })
})

describe('conditionHolds', () => {
  it('matches an empty cell for isEmpty', () => {
    expect(conditionHolds({ kind: 'isEmpty', column: 'phone' }, '', matchesFormat)).toBe(true)
  })

  it('treats a whitespace-only cell as empty', () => {
    // A cell containing "  " is empty to every human who looks at the file, and the agent's cleaning rule
    // has to agree with the human or the transform report is wrong.
    expect(conditionHolds({ kind: 'isEmpty', column: 'phone' }, '   ', matchesFormat)).toBe(true)
  })

  it('compares numerically, not lexically', () => {
    // '9' > '10' is true for strings. Getting this wrong makes every numeric predicate quietly incorrect.
    const condition = { kind: 'compare', column: 'age', op: '>', value: 9 } as const

    expect(conditionHolds(condition, '10', matchesFormat)).toBe(true)
  })

  it('treats an unparseable number as not matching rather than as zero', () => {
    // Zero would sit inside somebody's `<` predicate and silently join their group.
    const condition = { kind: 'compare', column: 'age', op: '<', value: 1 } as const

    expect(conditionHolds(condition, 'n/a', matchesFormat)).toBe(false)
  })

  it('is exact for equals, not case-insensitive or trimmed', () => {
    // Tempting to be helpful here. Don't: the agent uses equals to measure how messy a column is, and a
    // forgiving comparison hides exactly the inconsistency it is looking for.
    expect(conditionHolds({ kind: 'equals', column: 'city', value: 'Mataram' }, 'mataram ', matchesFormat))
      .toBe(false)
  })
})

describe('evaluate', () => {
  const ROWS: readonly (readonly string[])[] = [
    ['Ani', '+6281100000001', 'Mataram', '31'],
    ['Budi', '', 'Mataram', '44'],
    ['Cici', '0812-1000-0002', 'Ampenan', '29'],
  ]

  it('returns row ids, never values', () => {
    const result = parseQuery({ conditions: [{ kind: 'isEmpty', column: 'phone' }], join: 'all' }, COLUMNS)
    if (!result.ok) throw new Error('expected a valid query')

    const rows = evaluate(result.query, ROWS, COLUMNS)

    expect(rows).toEqual([1])
  })

  it('applies "any" as a union', () => {
    const result = parseQuery(
      {
        conditions: [
          { kind: 'isEmpty', column: 'phone' },
          { kind: 'equals', column: 'city', value: 'Ampenan' },
        ],
        join: 'any',
      },
      COLUMNS,
    )
    if (!result.ok) throw new Error('expected a valid query')

    expect([...evaluate(result.query, ROWS, COLUMNS)].sort()).toEqual([1, 2])
  })
})
