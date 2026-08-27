import type { Column, Condition, NamedFormat, Query, RefusalCode } from '@/types/domain'

import { knownFormats, matchesFormat as matchesNamedFormat, numericValue } from '@/lib/data/patterns'

import { MAX_CONDITIONS } from './guard'

/**
 * Parse and validate a predicate that arrived from a model.
 *
 * Owner: Riko. Required reading: docs/privacy-guard.md § Predicate limits.
 *
 * Two jobs, in this order, and the order is the point:
 *
 *  1. **Validate.** Arity, known columns, closed format enum, well-formed condition objects. Runs before a
 *     single row is read, so a predicate specific enough to describe one human being is rejected rather
 *     than evaluated-then-suppressed.
 *  2. **Evaluate.** Turn a validated `Query` into a row-id set.
 *
 * ## Nothing from the model is executed, ever
 *
 * There is no `pattern` field, no `expression` field, and no path from a model string to `new RegExp`,
 * `eval`, or `new Function`. `no-eval.test.ts` greps `src/` and fails the build if the last two appear.
 *
 * The reason is not that regexes are hard to sanitise. It is that arbitrary granularity is itself the
 * vulnerability: `^0812(\d)` → `^08121(\d)` → `^081213(\d)` extracts a phone number one digit at a time
 * through counts that are every one of them above the suppression threshold. k-anonymity cannot see it.
 * A hostile pattern is also a denial of service against the tab holding the user's only copy of their data.
 *
 * So matching is a closed `NamedFormat` enum, recognised by hand-written functions in
 * `lib/data/patterns.ts`. Adding a format is a two-line PR and is the right way to extend this.
 *
 * ## On the refusal codes used here
 *
 * `RefusalCode` in the frozen `domain.ts` has no member for "these arguments are malformed", so structural
 * rejections — nesting, a bad `join`, a `min` above its `max` — carry `tooManyConditions`, the code for
 * *the shape of the predicate is not acceptable*, and say precisely what was wrong in `reason`. The code is
 * a hint; the sentence is what the model acts on. Adding a seventh code would be a change to a file all
 * three of us import, which is a conversation rather than a commit.
 */

export type ParseResult =
  | { ok: true; query: Query }
  | { ok: false; code: RefusalCode; reason: string }

const CONDITION_KINDS = ['equals', 'isEmpty', 'matchesFormat', 'compare', 'lengthBetween'] as const
const COMPARE_OPS = ['<', '<=', '>', '>='] as const
const JOINS = ['all', 'any'] as const

/** Column types a numeric comparison can be asked about. `mixed` is allowed: a numeric column with three
 * `N/A` cells in it infers as `mixed`, and refusing to compare it would refuse the most ordinary cleaning
 * question there is. `text`, `date` and `boolean` are refused, because there every cell parses to NaN,
 * nothing matches, and the agent reads a real zero. */
const COMPARABLE_TYPES = ['integer', 'decimal', 'mixed'] as const

/** The same list, for `guard.ts`: `sum` over a `text` column is the same mistake as `compare` on one. */
export function isComparableType(type: Column['type']): boolean {
  return (COMPARABLE_TYPES as readonly string[]).includes(type)
}

function refuse(code: RefusalCode, reason: string): ParseResult {
  return { ok: false, code, reason }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/** Names, quoted, for an error message. Listing them costs the agent nothing; omitting them costs a call. */
function list(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ')
}

/** Whether a string looks like a pattern rather than a format name — the branch that has to teach. */
function looksLikeRegex(value: string): boolean {
  return /[\\^$*+?[\](){}|]/.test(value)
}

/**
 * Turn raw tool arguments into a `Query`, or say exactly why not.
 *
 * Takes the column list so an unknown column can be reported *with the available names*. A bare "unknown
 * column" costs the agent a question to rediscover something we already knew.
 *
 * The condition is rebuilt field by field from the closed vocabulary rather than spread from the input. That
 * is what makes a smuggled `pattern` disappear: it is not stripped, it is simply never copied, so there is
 * no code path in which it exists downstream and no future refactor that can accidentally honour it.
 */
export function parseQuery(raw: unknown, columns: readonly Column[]): ParseResult {
  const root = asRecord(raw)
  if (root === null) {
    return refuse(
      'tooManyConditions',
      'Expected an object with a "conditions" array and a "join" of "all" or "any".',
    )
  }

  const rawConditions = root['conditions']
  if (!Array.isArray(rawConditions)) {
    return refuse('tooManyConditions', '"conditions" must be an array of 1 to 3 condition objects.')
  }

  if (rawConditions.length === 0) {
    return refuse(
      'tooManyConditions',
      'At least 1 condition is required. A predicate with no conditions matches every row, which is the ' +
        'row count — describe_dataset reports that free of charge and without spending any budget.',
    )
  }

  if (rawConditions.length > MAX_CONDITIONS) {
    return refuse(
      'tooManyConditions',
      `At most ${MAX_CONDITIONS} conditions are allowed and ${rawConditions.length} were sent. Three is ` +
        `where "a data-cleaning question" and "a description of one person" separate. Ask a broader ` +
        `question, or split it into separate calls and compare the counts.`,
    )
  }

  const join = root['join']
  if (typeof join !== 'string' || !JOINS.some((allowed) => allowed === join)) {
    return refuse(
      'tooManyConditions',
      `"join" must be one of ${list(JOINS)}. There is no "none" and no negation: a NOT over a narrow ` +
        `predicate is a way to ask about everybody except one person.`,
    )
  }

  const parsed: Condition[] = []
  for (const rawCondition of rawConditions) {
    const result = parseCondition(rawCondition, columns)
    if (!result.ok) return result
    parsed.push(result.condition)
  }

  return { ok: true, query: { conditions: parsed, join: join as Query['join'] } }
}

type ConditionResult = { ok: true; condition: Condition } | { ok: false; code: RefusalCode; reason: string }

function parseCondition(raw: unknown, columns: readonly Column[]): ConditionResult {
  const record = asRecord(raw)
  if (record === null) {
    return { ok: false, code: 'tooManyConditions', reason: 'Each condition must be an object.' }
  }

  const kind = record['kind']
  if (typeof kind !== 'string' || !CONDITION_KINDS.some((allowed) => allowed === kind)) {
    // A nested tree arrives here, as `{ kind: 'any', conditions: [...] }`. Rejecting it is deliberate:
    // deciding whether a *tree* is too specific is open-ended, and a subtly wrong check is worse than a
    // crude exact one. Counting to three cannot be subtly wrong.
    return {
      ok: false,
      code: 'unknownFormat',
      reason:
        `Unknown condition kind ${typeof kind === 'string' ? `"${kind}"` : 'in a condition'}. Use one of ` +
        `${list(CONDITION_KINDS)}. Conditions are a flat list joined by "all" or "any" and cannot ` +
        `contain other conditions.`,
    }
  }

  const columnName = record['column']
  if (typeof columnName !== 'string' || columnName.length === 0) {
    return {
      ok: false,
      code: 'unknownColumn',
      reason: `Every condition needs a "column". Available columns: ${list(columns.map((c) => c.id))}.`,
    }
  }

  const column = columns.find((candidate) => candidate.id === columnName)
  if (column === undefined) {
    return {
      ok: false,
      code: 'unknownColumn',
      reason: `No column named "${columnName}". Available columns: ${list(columns.map((c) => c.id))}.`,
    }
  }

  switch (kind) {
    case 'isEmpty':
      return { ok: true, condition: { kind: 'isEmpty', column: column.id } }

    case 'equals': {
      const value = record['value']
      if (typeof value !== 'string') {
        return {
          ok: false,
          code: 'tooManyConditions',
          reason: '"equals" needs a string "value". Cells are strings here; send "30", not 30.',
        }
      }
      return { ok: true, condition: { kind: 'equals', column: column.id, value } }
    }

    case 'matchesFormat': {
      const format = record['format']
      if (typeof format !== 'string') {
        return {
          ok: false,
          code: 'unknownFormat',
          reason: `"matchesFormat" needs a "format" naming one of: ${list(knownFormats())}.`,
        }
      }
      const known = knownFormats().find((candidate) => candidate === format)
      if (known === undefined) {
        const teaching = looksLikeRegex(format)
          ? 'Patterns are not accepted — no regex from a caller is ever compiled or run here. Name a ' +
            'format instead: "phoneE164" for +6281234567890, "phoneLocalId" for 081234567890, ' +
            '"digitsFixedLength" for a bare identifier. If none of them fits, sample_shapes will show ' +
            'you the shapes present in the column.'
          : `Use one of: ${list(knownFormats())}.`
        return {
          ok: false,
          code: 'unknownFormat',
          reason: `Unknown format "${format}". ${teaching}`,
        }
      }
      // Built from the enum alone. Anything else on the object — `pattern`, `regex`, `expression` — is
      // never read, so it cannot be honoured by accident later.
      return { ok: true, condition: { kind: 'matchesFormat', column: column.id, format: known } }
    }

    case 'compare': {
      if (!COMPARABLE_TYPES.some((allowed) => allowed === column.type)) {
        return {
          ok: false,
          code: 'unknownColumn',
          reason:
            `"compare" needs a numeric column and "${column.id}" is ${column.type}. In a text column ` +
            `every cell parses to NaN, nothing matches, and the count that comes back is a real zero ` +
            `that means nothing. Use "lengthBetween" or "matchesFormat" on this column instead.`,
        }
      }
      const op = record['op']
      if (typeof op !== 'string' || !COMPARE_OPS.some((allowed) => allowed === op)) {
        return {
          ok: false,
          code: 'tooManyConditions',
          reason: `"compare" needs an "op" of ${list(COMPARE_OPS)}. There is no "=" — use "equals".`,
        }
      }
      const value = record['value']
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return {
          ok: false,
          code: 'tooManyConditions',
          reason: '"compare" needs a finite numeric "value".',
        }
      }
      return {
        ok: true,
        condition: { kind: 'compare', column: column.id, op: op as '<' | '<=' | '>' | '>=', value },
      }
    }

    case 'lengthBetween': {
      const min = record['min']
      const max = record['max']
      if (!isWholeNumber(min) || !isWholeNumber(max) || min < 0 || max < 0) {
        return {
          ok: false,
          code: 'tooManyConditions',
          reason: '"lengthBetween" needs whole, non-negative "min" and "max" character counts.',
        }
      }
      if (min > max) {
        return {
          ok: false,
          code: 'tooManyConditions',
          reason: `"lengthBetween" has min ${min} above max ${max}, which matches nothing. Swap them.`,
        }
      }
      return { ok: true, condition: { kind: 'lengthBetween', column: column.id, min, max } }
    }
  }

  // Unreachable: `kind` was checked against CONDITION_KINDS above. Present so that adding a kind to
  // `domain.ts` without handling it here is a compile error rather than a silent `undefined`.
  return { ok: false, code: 'unknownFormat', reason: `Unhandled condition kind "${String(kind)}".` }
}

/**
 * Which columns a query touches — what the budget charges.
 *
 * De-duplicated: `lengthBetween(name, 1, 3) AND isEmpty(name)` is one question about one column, and
 * charging it twice punishes a precise predicate. An agent punished for precision asks two vaguer questions
 * instead, which discloses more.
 */
export function columnsInQuery(query: Query): readonly string[] {
  return [...new Set(query.conditions.map((condition) => condition.column))]
}

/**
 * Numbers, strictly, and by the same definition the rest of the codebase uses.
 *
 * Delegated to `patterns.ts` rather than kept here as a second regex, because the two would drift and the
 * drift would show up as a column the profile calls numeric and `compare` matches nothing in. It also
 * closes one specific hole: a leading `+` is not a sign, so `+6281234567890` is not the number
 * 6,281,234,567,890, which is what it would have been read as by anything that accepted `[+-]?`.
 *
 * `1.234,56` is still rejected rather than guessed at when it is not unambiguously the comma-decimal form.
 * Both readings are defensible and one of them is wrong by a factor of a thousand, so the cell does not
 * match and the row is not counted. A comparison that silently misreads a European decimal is exactly the
 * failure that looks like a valid answer.
 */
function toNumber(cell: string): number | null {
  return numericValue(cell)
}

/**
 * Whether a single condition holds for a single cell.
 *
 * Split out because it is the one function here small enough to reason about exhaustively, and because
 * `evaluate` gets long. Exported for the tests only.
 *
 * The switch is exhaustive over `Condition['kind']` with no `default` branch, so adding a condition kind to
 * `domain.ts` fails to compile here — which is the correct place to be reminded.
 */
export function conditionHolds(
  condition: Condition,
  cell: string,
  matchesFormat: (value: string, format: NamedFormat) => boolean,
): boolean {
  switch (condition.kind) {
    case 'isEmpty':
      // Whitespace-only counts as empty: a cell containing "  " is empty to every human who looks at the
      // file, and the agent's cleaning rule has to agree with the human or the transform report is wrong.
      return cell.trim() === ''

    case 'equals':
      // Exact. Tempting to trim or lowercase here; don't. The agent uses equals to measure how messy a
      // column is, and a forgiving comparison hides exactly the inconsistency it is looking for.
      return cell === condition.value

    case 'matchesFormat':
      return matchesFormat(cell, condition.format)

    case 'compare': {
      const value = toNumber(cell)
      // Unparseable is *not matching*, never zero. Zero is a value that would sit inside somebody's `<`
      // predicate and silently join their group.
      if (value === null) return false
      switch (condition.op) {
        case '<':
          return value < condition.value
        case '<=':
          return value <= condition.value
        case '>':
          return value > condition.value
        case '>=':
          return value >= condition.value
        default: {
          // Unreachable while `op` has four members, and here so that it stays unreachable. Without it this
          // block ends without returning and falls through into `lengthBetween` below, where `condition.min`
          // is `undefined` and every row quietly stops matching — a fifth operator would compile, pass the
          // tests that do not use it, and silently answer 0 to every question that did. Assigning to `never`
          // fails the build instead.
          const unhandled: never = condition.op
          throw new Error(`matches: unhandled comparison operator ${String(unhandled)}`)
        }
      }
    }

    case 'lengthBetween': {
      // Code points, not UTF-16 units: an emoji or a combining accent is one character to the person who
      // typed it, and a length predicate that says otherwise misreports the column.
      const length = [...cell].length
      return length >= condition.min && length <= condition.max
    }
  }
}

/**
 * Evaluate a validated query against the rows.
 *
 * Returns row ids, not values, and that signature is load-bearing: it is what lets `find_issues` be useful
 * without being a read. Callers inside `lib/guard` may hold row ids freely; nothing in `lib/webmcp/tools`
 * may turn one into a cell.
 *
 * One pass over the rows, evaluating every condition per row, rather than intersecting per-condition sets —
 * a 50k-row file scanned three times is three times the main-thread block, and this runs on the thread
 * holding the UI. `all` short-circuits on the first failure and `any` on the first success, so a cheap
 * condition placed first is genuinely cheaper.
 */
export function evaluate(
  query: Query,
  rows: readonly (readonly string[])[],
  columns: readonly Column[],
): readonly number[] {
  const indexOf = new Map(columns.map((column) => [column.id, column.index]))
  const matched: number[] = []

  for (let rowId = 0; rowId < rows.length; rowId += 1) {
    const row = rows[rowId]
    if (row === undefined) continue

    let holds = query.join === 'all'
    for (const condition of query.conditions) {
      const index = indexOf.get(condition.column)
      const cell = index === undefined ? '' : (row[index] ?? '')
      const result = conditionHolds(condition, cell, matchesNamedFormat)
      if (query.join === 'all' && !result) {
        holds = false
        break
      }
      if (query.join === 'any' && result) {
        holds = true
        break
      }
    }

    if (holds) matched.push(rowId)
  }

  return matched
}
