import { describe, expect, it } from 'vitest'

import type { AggregateSpec, Dataset } from '@/types/domain'

import { computeAggregate } from './answers'

/**
 * The suppression rule inside an aggregate's arithmetic.
 *
 * Owner: Riko. Contract: docs/privacy-guard.md § Merged, never dropped.
 *
 * `mergeSmallGroups` decides which *groups* may be named and is tested in `k-anonymity.test.ts`. What is tested
 * here is the other half, which that file cannot see: whether the *number* attached to a named group is safe.
 * A group can be large enough to name and still have its statistic come from one person, because the column
 * being summed is not always filled — `mostlyFilledButSomeEmpty` and `numberStoredAsText` are issue codes this
 * codebase looks for, so a partly-numeric column is the ordinary case. A group size that passes k while the
 * contributing rows do not is the shape of that leak, and it is the first test below.
 */

/** Twelve rows in one group, one of which holds a salary. The other group is filled and above k. */
const GAPPY: Dataset = {
  columns: [
    { id: 'city', index: 0, type: 'text' },
    { id: 'salary', index: 1, type: 'integer' },
  ],
  rows: [
    ['Jakarta', '9500000'],
    ['Jakarta', ''],
    ['Jakarta', ''],
    ['Jakarta', ''],
    ['Jakarta', ''],
    ['Jakarta', ''],
    ['Bandung', '4000000'],
    ['Bandung', '4200000'],
    ['Bandung', '4400000'],
    ['Bandung', '4600000'],
    ['Bandung', '4800000'],
    ['Bandung', '5000000'],
  ],
  sourceName: 'test.csv',
  rowCount: 12,
}

/** k = 5, so both groups above are nameable and only one of them has five contributors. */
const K = 5

function group(dataset: Dataset, spec: AggregateSpec, key: string) {
  const found = computeAggregate(dataset, spec, K).groups.find((candidate) => candidate.key === key)
  if (found === undefined) throw new Error(`expected a group called "${key}"`)
  return found
}

describe('computeAggregate value suppression', () => {
  it('withholds a mean computed from fewer than k rows even when the group is large', () => {
    // Arrange
    // Six Jakarta rows, one salary. `bucket.count >= k` passes; the mean is that one person's salary.
    const spec: AggregateSpec = { groupBy: 'city', fn: 'mean', over: 'salary' }

    // Act
    const jakarta = group(GAPPY, spec, 'Jakarta')

    // Assert
    expect(jakarta.count).toBe(6)
    expect(jakarta.value).toBe('suppressed')
  })

  it('withholds a sum computed from fewer than k rows for the same reason', () => {
    // Arrange
    // A sum over one contributing row is that row's value with extra steps.
    const spec: AggregateSpec = { groupBy: 'city', fn: 'sum', over: 'salary' }

    // Act
    const jakarta = group(GAPPY, spec, 'Jakarta')

    // Assert
    expect(jakarta.value).toBe('suppressed')
  })

  it('still reports the group size, because the group is not what is being hidden', () => {
    // Arrange
    const spec: AggregateSpec = { groupBy: 'city', fn: 'mean', over: 'salary' }

    // Act
    const jakarta = group(GAPPY, spec, 'Jakarta')

    // Assert
    // Suppressing the count as well would break the total and read as a filtered dataset.
    expect(jakarta.count).toBe(6)
  })

  it('answers a mean over enough contributors', () => {
    // Arrange
    const spec: AggregateSpec = { groupBy: 'city', fn: 'mean', over: 'salary' }

    // Act
    const bandung = group(GAPPY, spec, 'Bandung')

    // Assert
    expect(bandung.value).toBe(4_500_000)
  })

  it('withholds an extreme until the group has twice k contributors', () => {
    // Arrange
    // Bandung has six contributors, above k and below 2k: a max there is one person's salary with a
    // one-in-six pointer at whose. An extreme selects a member of the group rather than summarising it.
    const spec: AggregateSpec = { groupBy: 'city', fn: 'max', over: 'salary' }

    // Act
    const bandung = group(GAPPY, spec, 'Bandung')

    // Assert
    expect(bandung.count).toBe(6)
    expect(bandung.value).toBe('suppressed')
  })

  it('reports "suppressed" rather than 0 for a group with nothing to add up', () => {
    // Arrange
    const empty: Dataset = {
      columns: GAPPY.columns,
      rows: Array.from({ length: 6 }, () => ['Solo', '']),
      sourceName: 'test.csv',
      rowCount: 6,
    }
    const spec: AggregateSpec = { groupBy: 'city', fn: 'sum', over: 'salary' }

    // Act
    const solo = group(empty, spec, 'Solo')

    // Assert
    // A zero would be read as a real total by anything summing the column afterwards.
    expect(solo.value).toBe('suppressed')
  })

  it('counts every row in the group, filled or not', () => {
    // Arrange
    // `count` needs no contributors: it is the group's size, which is above k by construction.
    const spec: AggregateSpec = { groupBy: 'city', fn: 'count' }

    // Act
    const result = computeAggregate(GAPPY, spec, K)

    // Assert
    const total = result.groups.reduce(
      (sum, candidate) => sum + (typeof candidate.count === 'number' ? candidate.count : 0),
      0,
    )
    expect(total).toBe(GAPPY.rowCount)
  })
})
