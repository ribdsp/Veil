import { describe, expect, it } from 'vitest'

import { mergeSmallGroups, reportCount, validateK } from './k-anonymity'

/**
 * The suppression rule, written as a specification before the implementation existed.
 *
 * Owner: Riko. **These tests are red on purpose.** Make them green by implementing `k-anonymity.ts`.
 *
 * Do not make them green by weakening an assertion, adding `.skip`, or deleting a case. Here that
 * converts a specification into a lie, and the lie is specifically about whether a real person can be
 * identified from Veil's output. If you believe a case is wrong, argue it in the PR and change it in the
 * open — CONTRIBUTING.md § Some tests are red on purpose.
 *
 * The cases below are ordered from obvious to subtle. The last three are the ones that were argued about.
 */

describe('reportCount', () => {
  it('reports a count at or above k', () => {
    // Arrange
    const count = 5

    // Act
    const result = reportCount(count, 5)

    // Assert
    expect(result).toEqual({ status: 'reported', value: 5 })
  })

  it('suppresses a count below k', () => {
    const result = reportCount(4, 5)

    expect(result.status).toBe('suppressed')
  })

  it('reports zero rather than suppressing it', () => {
    // "No rows match" describes nobody — it is a fact about the predicate, not about a person. And the
    // agent needs to tell "nothing here" apart from "something here I may not see": the first means move
    // on, the second means tell the human to look. Suppressing zero collapses that distinction.
    const result = reportCount(0, 5)

    expect(result).toEqual({ status: 'reported', value: 0 })
  })

  it('states the range in the suppression reason, not just that it refused', () => {
    // Strictly, "between 1 and 4" is information. It is also the information that makes the agent useful,
    // and it narrows nobody down: the bound is exactly the threshold describe_dataset already published.
    const result = reportCount(2, 5)

    if (result.status !== 'suppressed') throw new Error('expected suppression')
    expect(result.reason).toMatch(/between 1 and 4/i)
    expect(result.code).toBe('belowK')
  })

  it('never puts the real count in the suppression reason', () => {
    // The obvious implementation writes "3 rows match, which is below 5". That reveals the exact number
    // the suppression existed to hide, in the field explaining the suppression.
    const result = reportCount(3, 5)

    if (result.status !== 'suppressed') throw new Error('expected suppression')
    expect(result.reason).not.toMatch(/\b3\b/)
  })

  it('honours a raised k', () => {
    expect(reportCount(9, 12).status).toBe('suppressed')
    expect(reportCount(12, 12).status).toBe('reported')
  })
})

describe('mergeSmallGroups', () => {
  it('keeps groups at or above k', () => {
    const groups = [
      { key: 'active', count: 800 },
      { key: 'dormant', count: 200 },
    ]

    const result = mergeSmallGroups(groups, 5)

    expect(result.groups).toEqual(groups)
    expect(result.mergedGroupCount).toBe(0)
  })

  it('merges small groups into __other__ instead of dropping them', () => {
    const result = mergeSmallGroups(
      [
        { key: 'active', count: 800 },
        { key: 'pending', count: 3 },
        { key: 'archived', count: 2 },
      ],
      5,
    )

    expect(result.groups).toContainEqual({ key: '__other__', count: 5 })
    expect(result.mergedGroupCount).toBe(2)
  })

  it('preserves the total, which is the whole point of merging', () => {
    // An agent whose groups do not sum to rowCount concludes it was handed a filtered dataset, and every
    // number it reports afterwards is wrong in a way nobody can detect.
    const groups = [
      { key: 'a', count: 40 },
      { key: 'b', count: 4 },
      { key: 'c', count: 3 },
      { key: 'd', count: 1 },
    ]
    const total = groups.reduce((sum, group) => sum + group.count, 0)

    const result = mergeSmallGroups(groups, 5)

    expect(result.groups.reduce((sum, group) => sum + group.count, 0)).toBe(total)
  })

  it('does not emit an empty __other__ when nothing was merged', () => {
    // A zero-count __other__ tells the agent a suppression happened when none did, which makes it
    // hedge a conclusion that did not need hedging.
    const result = mergeSmallGroups([{ key: 'only', count: 99 }], 5)

    expect(result.groups.map((group) => group.key)).not.toContain('__other__')
  })

  it('suppresses an __other__ bucket that is itself below k', () => {
    // The case that is easy to miss. Two groups of 2 merge to a bucket of 4, which is still below the
    // threshold — the merge has to be re-checked, or suppression is defeated by doing it once.
    const result = mergeSmallGroups(
      [
        { key: 'big', count: 90 },
        { key: 'x', count: 2 },
        { key: 'y', count: 2 },
      ],
      5,
    )

    const other = result.groups.find((group) => group.key === '__other__')
    expect(other).toBeUndefined()
    expect(result.mergedGroupCount).toBe(2)
  })

  it('merges the tail beyond maxGroups rather than truncating it', () => {
    // Truncation would break the total in the same way dropping does, and silently.
    const groups = Array.from({ length: 40 }, (_, index) => ({
      key: `group-${index}`,
      count: 100 - index,
    }))
    const total = groups.reduce((sum, group) => sum + group.count, 0)

    const result = mergeSmallGroups(groups, 5, 25)

    expect(result.groups.length).toBeLessThanOrEqual(26)
    expect(result.groups.reduce((sum, group) => sum + group.count, 0)).toBe(total)
  })
})

describe('validateK', () => {
  it('accepts the default', () => {
    expect(validateK(5)).toEqual({ ok: true, k: 5 })
  })

  it('accepts a raised threshold', () => {
    expect(validateK(20)).toEqual({ ok: true, k: 20 })
  })

  it('rejects anything below the floor', () => {
    const result = validateK(2)

    expect(result.ok).toBe(false)
  })

  it('explains the rejection, because the UI shows the reason next to the control', () => {
    const result = validateK(1)

    if (result.ok) throw new Error('expected rejection')
    expect(result.reason.length).toBeGreaterThan(20)
  })

  it('rejects a fractional or non-finite threshold', () => {
    // k=4.5 silently floors to 4 in most implementations, which is one below the floor by arithmetic
    // rather than by decision.
    expect(validateK(4.5).ok).toBe(false)
    expect(validateK(Number.NaN).ok).toBe(false)
    expect(validateK(Number.POSITIVE_INFINITY).ok).toBe(false)
  })
})
