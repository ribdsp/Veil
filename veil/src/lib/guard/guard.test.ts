import { describe, expect, it } from 'vitest'

import type { AggregateSpec, Dataset, TransformSpec } from '@/types/domain'

import { createGuard } from './guard'

/**
 * Two suppression decisions that live in the guard rather than in the arithmetic.
 *
 * Owner: Riko. Contract: docs/privacy-guard.md.
 *
 * Both are cases where a call is well-formed, its columns exist, and answering it would still be wrong — so
 * neither the transform layer nor `answers.ts` can be the one to say no. `guard.ts` owns policy; these tests
 * pin the two policies whose absence produced a report that understated what a write would do, and a below-k
 * count reachable by subtraction.
 */

const DATASET: Dataset = {
  columns: [
    { id: 'name', index: 0, type: 'text' },
    { id: 'city', index: 1, type: 'text' },
    { id: 'phone', index: 2, type: 'text' },
  ],
  rows: [
    ['Ani', 'Jakarta', '081210000001'],
    ['Budi', 'Jakarta', '081210000002'],
    ['Cici', 'Jakarta', '081210000003'],
    ['Dedi', 'Jakarta', '081210000004'],
    ['Eka', 'Jakarta', '081210000005'],
    ['Fajar', 'Jakarta', '081210000006'],
    ['Gita', 'Solo', '081210000007'],
    ['Hasan', 'Solo', ''],
  ],
  sourceName: 'test.csv',
  rowCount: 8,
}

function guard() {
  return createGuard(DATASET, { k: 5, queriesPerColumn: 12 })
}

describe('dropColumn cannot be narrowed to rows', () => {
  it('refuses a preview of dropColumn with a row subset', () => {
    // Arrange
    // The transform layer would blank row 0 *and* remove the column from every row, then report one change.
    // The human would approve "1 row" and lose the column, with no undo for a destructive kind.
    const spec: TransformSpec = { kind: 'dropColumn', column: 'phone' }

    // Act
    const verdict = guard().preview(spec, [0])

    // Assert
    expect(verdict.status).toBe('refused')
    if (verdict.status === 'refused') expect(verdict.reason).toMatch(/maskColumn/)
  })

  it('refuses the commit as well, so the check cannot be skipped by calling the write directly', async () => {
    // Arrange
    const spec: TransformSpec = { kind: 'dropColumn', column: 'phone' }

    // Act
    const outcome = await guard().commit(spec, [0], 'tidying up')

    // Assert
    // Refused before any approval is asked for: there is no dialog to click through.
    expect(outcome.status).toBe('refused')
  })

  it('still previews a dropColumn over the whole column', () => {
    // Arrange
    const spec: TransformSpec = { kind: 'dropColumn', column: 'phone' }

    // Act
    const verdict = guard().preview(spec)

    // Assert
    expect(verdict.status).toBe('answered')
    if (verdict.status === 'answered') expect(verdict.value.destructive).toBe(true)
  })

  it('still allows maskColumn on a row subset, which does have a per-row meaning', () => {
    // Arrange
    // Masking rewrites cells, so masking some of them is coherent — and it is how an agent acts on the row
    // ids find_issues handed it.
    const spec: TransformSpec = { kind: 'maskColumn', column: 'phone', keep: 'lastFour' }

    // Act
    const verdict = guard().preview(spec, [0, 1])

    // Assert
    expect(verdict.status).toBe('answered')
  })
})

describe('a filtered aggregate does not publish its tail below k', () => {
  it('refuses when the merged remainder is a below-k count of filtered rows', () => {
    // Arrange
    // Two Solo rows survive the filter. Their group is below k, so it merges into "__other__" — and with a
    // filter in play nothing else reports how many rows matched, so printing the tail's size would be the
    // below-k count count_where withholds, reached by subtraction.
    const spec: AggregateSpec = {
      groupBy: 'city',
      fn: 'count',
      filter: { conditions: [{ kind: 'equals', column: 'city', value: 'Solo' }], join: 'all' },
    }

    // Act
    const verdict = guard().aggregate(spec)

    // Assert
    expect(verdict.status).toBe('refused')
    if (verdict.status === 'refused') expect(verdict.code).toBe('belowK')
  })

  it('answers the same shape unfiltered, where the tail is arithmetic the caller could already do', () => {
    // Arrange
    // Without a filter the total is free from describe_dataset, so the tail is derivable whether or not it is
    // printed — withholding it would break the total and teach the agent it had a filtered dataset.
    const spec: AggregateSpec = { groupBy: 'city', fn: 'count' }

    // Act
    const verdict = guard().aggregate(spec)

    // Assert
    expect(verdict.status).toBe('answered')
    if (verdict.status === 'answered') {
      expect(verdict.value.groups.map((entry) => entry.key)).toEqual(['Jakarta'])
      expect(verdict.value.other).toEqual({ groupCount: 1, rowCount: 2 })
    }
  })
})
