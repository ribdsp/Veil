import { describe, expect, it } from 'vitest'

import { charge, exhaustedColumns, remaining, remainingAcross } from './query-budget'

/**
 * The query budget, written as a specification before the implementation existed.
 *
 * Owner: Riko. **These tests are red on purpose.** Implement `query-budget.ts` to make them pass; do not
 * weaken, skip or delete a case — CONTRIBUTING.md § Some tests are red on purpose.
 *
 * The interesting cases are the last four. Everything before them is arithmetic.
 */

const LIMIT = 12

describe('charge', () => {
  it('charges a fresh column and reports what is left', () => {
    // Arrange
    const state = new Map<string, number>()

    // Act
    const result = charge(state, ['phone'], LIMIT)

    // Assert
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.remaining).toBe(11)
  })

  it('does not mutate the state it was given', () => {
    // The store holds this map. An in-place charge makes the budget untestable without a store, and makes
    // a failed charge leave a partial mutation behind.
    const state = new Map([['phone', 3]])

    charge(state, ['phone'], LIMIT)

    expect(state.get('phone')).toBe(3)
  })

  it('charges every column a multi-column query names', () => {
    const result = charge(new Map(), ['city', 'status'], LIMIT)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.get('city')).toBe(1)
    expect(result.state.get('status')).toBe(1)
  })

  it('refuses when a column is exhausted', () => {
    const result = charge(new Map([['phone', LIMIT]]), ['phone'], LIMIT)

    expect(result.ok).toBe(false)
  })

  it('names the exhausted column in the reason', () => {
    // The agent has to know *which* column closed, or its only recovery is to try each in turn — which
    // spends budget on the columns that still had some.
    const result = charge(new Map([['phone', LIMIT]]), ['phone', 'city'], LIMIT)

    if (result.ok) throw new Error('expected refusal')
    expect(result.reason).toMatch(/phone/)
  })

  it('charges nothing when any one column is exhausted', () => {
    // All or nothing. A partial charge leaves the agent having paid for an answer it did not get, and a
    // partial *answer* — a crosstab with one axis silently missing — reads as a real result.
    const state = new Map([
      ['phone', LIMIT],
      ['city', 0],
    ])

    const result = charge(state, ['phone', 'city'], LIMIT)

    expect(result.ok).toBe(false)
    expect(state.get('city')).toBe(0)
  })

  it('charges a column named twice in one query only once', () => {
    // `lengthBetween(name, 1, 3) AND isEmpty(name)` is one question about one column. Charging twice
    // punishes a precise predicate, and the agent's response to being punished for precision is to ask
    // two vaguer questions instead — which discloses more, not less.
    const result = charge(new Map(), ['name', 'name'], LIMIT)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.get('name')).toBe(1)
  })

  it('leaves a column at exactly zero remaining after the last question', () => {
    // Off-by-one here is the difference between 12 questions and 13, and 13 is a number nobody chose.
    let state: ReadonlyMap<string, number> = new Map()
    for (let index = 0; index < LIMIT; index += 1) {
      const result = charge(state, ['phone'], LIMIT)
      expect(result.ok, `charge ${index + 1} of ${LIMIT}`).toBe(true)
      if (!result.ok) return
      state = result.state
    }

    expect(remaining(state, 'phone', LIMIT)).toBe(0)
    expect(charge(state, ['phone'], LIMIT).ok).toBe(false)
  })
})

describe('remaining', () => {
  it('reports the full limit for a column never queried', () => {
    expect(remaining(new Map(), 'unseen', LIMIT)).toBe(LIMIT)
  })

  it('never reports a negative number', () => {
    // Defensive, and it earns its place: a negative remaining count formatted into a tool response reads
    // to a model as a broken tool, and it will report the page as broken rather than the budget as spent.
    expect(remaining(new Map([['phone', 99]]), 'phone', LIMIT)).toBe(0)
  })
})

describe('remainingAcross', () => {
  it('reports the tightest column, since that is what fails next', () => {
    const state = new Map([
      ['city', 2],
      ['status', 9],
    ])

    expect(remainingAcross(state, ['city', 'status'], LIMIT)).toBe(3)
  })

  it('reports the full limit for an empty column list', () => {
    expect(remainingAcross(new Map(), [], LIMIT)).toBe(LIMIT)
  })
})

describe('exhaustedColumns', () => {
  it('lists only the columns with nothing left', () => {
    const state = new Map([
      ['phone', LIMIT],
      ['city', 4],
      ['name', LIMIT],
    ])

    expect([...exhaustedColumns(state, LIMIT)].sort()).toEqual(['name', 'phone'])
  })
})
