import type {
  AggregateFn,
  AggregateGroup,
  AggregateResult,
  AggregateSpec,
  Column,
  CrosstabResult,
  Dataset,
  DatasetSummary,
  RowId,
} from '@/types/domain'

import { columnSummary } from '@/lib/data/profile-column'
import { numericValue } from '@/lib/data/patterns'
import { reduceColumn } from '@/lib/data/parse-csv'

import { OTHER_KEY, mergeSmallGroups, reportCount } from './k-anonymity'
import { evaluate } from './predicate'

/**
 * The arithmetic behind three of the guard's answers.
 *
 * Owner: Riko.
 *
 * Split out of `guard.ts` so that file stays what it is meant to be — validation, budget, suppression policy
 * and nothing else. Grouping and cross-tabulation are loops with edge cases, and reading them interleaved with
 * the refusal rules makes both harder to check.
 *
 * These are free functions taking a `Dataset`, which `guard.ts` deliberately is not. That is safe for the same
 * reason `lib/data/profile-column.ts` is safe: a tool cannot call them, because a tool cannot obtain a
 * `Dataset`. There is exactly one in the process, it lives in a closure inside `guard.ts`, and no method on
 * `GuardHandle` returns it. `guard/no-leak.test.ts` keeps the store's copy out of `lib/webmcp/tools/` too.
 *
 * Suppression still happens here rather than being left to the caller — `reportCount` and `mergeSmallGroups`
 * are applied to every number on the way out. A helper that returned raw counts for `guard.ts` to filter
 * afterwards would be one refactor away from a raw count reaching a response.
 */

/** Groups named in an aggregate response before the rest fold into `__other__`. */
const MAX_GROUPS = 25

/** Distinct values per axis in a crosstab. The product is the cell count, and 12 × 12 is already a lot. */
export const MAX_CROSSTAB_KEYS = 12

/** Cells in a crosstab. A wider pair is refused with a pointer at `aggregate`. */
export const MAX_CROSSTAB_CELLS = 100

/**
 * A group of exactly k rows has an extreme that *is* one row's value.
 *
 * `min` and `max` do not summarise a group, they select a member of it. "The maximum salary among the 5 people
 * in Kebayoran" is one person's salary, published with a 1-in-5 pointer at who. Sum and mean mix the members
 * together and are safe at k *contributors*; extremes need the group to be big enough that the pointer is not
 * useful, and twice k is the convention this codebase settles on. Below that the count is still reported — the
 * group is not hidden, only its edges are.
 */
const EXTREME_K_MULTIPLE = 2

/**
 * Row count, per-column summaries, and the k in force.
 *
 * `dataset.rows.length` rather than `dataset.rowCount` when the two could differ: the array is what every
 * other read walks, so it is the number the rest of the response is consistent with.
 */
export function summarise(dataset: Dataset, k: number): DatasetSummary {
  return {
    rowCount: dataset.rows.length,
    columns: dataset.columns.map((column) => columnSummary(dataset, column)),
    minGroupSize: k,
  }
}

/**
 * Distinct values in a column, up to a cap.
 *
 * Answers "is this column too wide to cross-tabulate" without building a set of 50,000 strings to discover
 * that the answer is yes. Stops counting at `cap` and says `'more'`, which is all the caller does with it.
 */
export function distinctAtMost(dataset: Dataset, column: Column, cap: number): number | 'more' {
  const seen = reduceColumn(dataset, column, new Set<string>(), (values, cell) => {
    if (values.size <= cap) values.add(cell.trim())
    return values
  })

  return seen.size > cap ? 'more' : seen.size
}

type Bucket = {
  count: number
  numbers: number
  sum: number
  min: number
  max: number
}

/**
 * Group by one column, with small groups folded into `__other__` rather than dropped.
 *
 * The fold is what keeps the response honest: a response whose groups sum to less than the row count reads as
 * a filtered dataset, and an agent that believes it was given a filtered dataset draws conclusions about the
 * wrong file. `mergeSmallGroups` owns that decision; this function owns the arithmetic and the extremes rule.
 *
 * `other` carries the tail's row count even when the tail is a single group below k, which looks like a
 * suppression bypass and is not — *for an unfiltered aggregate*. `rowCount` is free from `describe()`, the
 * named groups are all above k, and their sum subtracted from the total *is* the tail, so withholding the
 * number hides nothing and breaks the total instead. The tail's *key* is what stays hidden, and it does.
 *
 * A `spec.filter` removes the premise: nothing in the API reports how many rows matched a predicate, so with a
 * filter the tail is no longer arithmetic the caller could already do — it is a fresh count of a
 * subpopulation, and a tail below k is then exactly the disclosure `count` refuses, arriving as a subtraction.
 * That case is refused in `guard.aggregate`, which owns suppression *policy*; this function still reports the
 * number, because a helper that silently returned a broken total would be worse than one whose caller says no.
 *
 * A group whose valued column holds no number reports `'suppressed'` rather than `0`. A sum of nothing is not
 * zero, and a zero here would be read as a real total by anything summing the column afterwards.
 */
export function computeAggregate(dataset: Dataset, spec: AggregateSpec, k: number): AggregateResult {
  const groupBy = dataset.columns.find((column) => column.id === spec.groupBy)
  const over = spec.over === undefined ? undefined : dataset.columns.find((c) => c.id === spec.over)
  if (groupBy === undefined) {
    throw new Error(`computeAggregate: no column called "${spec.groupBy}". The guard validates this first.`)
  }

  const included = spec.filter === undefined ? null : new Set(evaluate(spec.filter, dataset.rows, dataset.columns))

  const buckets = new Map<string, Bucket>()
  let matched = 0

  dataset.rows.forEach((row, rowId: RowId) => {
    if (included !== null && !included.has(rowId)) return

    matched += 1
    const key = row[groupBy.index] ?? ''
    const bucket = buckets.get(key) ?? {
      count: 0,
      numbers: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    }
    bucket.count += 1

    if (over !== undefined) {
      const value = numericValue(row[over.index] ?? '')
      if (value !== null) {
        bucket.numbers += 1
        bucket.sum += value
        if (value < bucket.min) bucket.min = value
        if (value > bucket.max) bucket.max = value
      }
    }

    buckets.set(key, bucket)
  })

  const merged = mergeSmallGroups(
    [...buckets].map(([key, bucket]) => ({ key, count: bucket.count })),
    k,
    MAX_GROUPS,
  )

  const named = merged.groups.filter((group) => group.key !== OTHER_KEY)
  const keptRows = named.reduce((total, group) => total + group.count, 0)

  const groups: AggregateGroup[] = named.map((group) => ({
    key: group.key,
    count: group.count,
    value: metric(spec.fn, buckets.get(group.key), group.count, k),
  }))

  return {
    groups,
    other:
      merged.mergedGroupCount === 0
        ? null
        : { groupCount: merged.mergedGroupCount, rowCount: matched - keptRows },
    truncated: merged.mergedGroupCount > 0,
  }
}

/**
 * One group's number, or `'suppressed'`.
 *
 * **k is checked against the rows that carry a number, not against the size of the group.** The two differ
 * whenever the valued column has gaps, which is not a contrived case: `mostlyFilledButSomeEmpty` and
 * `numberStoredAsText` are two of the issue codes this codebase looks for, so a partly-numeric column is the
 * expected input rather than the exotic one. A group of twenty rows where one holds a parseable value has a
 * sum and a mean equal to that one person's value, and the nineteen empty rows are no protection at all —
 * `bucket.count >= k` would pass and publish it. `profile-column.ts` gates its outlier report the same way,
 * on `numbers.length` rather than on row count.
 *
 * Extremes need both: `count` because the group must be worth naming, `numbers` because the extreme is a
 * pointer at whichever contributing row holds it.
 */
function metric(
  fn: AggregateFn,
  bucket: Bucket | undefined,
  count: number,
  k: number,
): number | 'suppressed' {
  if (fn === 'count') return count
  if (bucket === undefined || bucket.numbers < k) return 'suppressed'

  if (fn === 'sum') return round(bucket.sum)
  if (fn === 'mean') return round(bucket.sum / bucket.numbers)

  const extremeFloor = EXTREME_K_MULTIPLE * k
  if (count < extremeFloor || bucket.numbers < extremeFloor) return 'suppressed'
  return round(fn === 'min' ? bucket.min : bucket.max)
}

/**
 * Three decimal places, and integers left exactly as they are.
 *
 * `0.1 + 0.2` is `0.30000000000000004`, and a report full of those reads as a rounding bug in Veil rather
 * than as the float arithmetic every spreadsheet also does. Large integers skip the rounding entirely: a sum
 * of account-sized numbers multiplied by 1000 and back loses the last digits, which is worse than an ugly
 * fraction.
 */
function round(value: number): number {
  if (Number.isInteger(value) || Math.abs(value) > 1e12) return value
  return Math.round(value * 1000) / 1000
}

/**
 * A contingency table with every cell k-checked on its own.
 *
 * Checking the response as a whole is the mistake this avoids: a table of 100 cells over 8,000 rows passes any
 * whole-response test and still has a cell containing one person in it. Each cell is a group, and each group
 * is checked.
 *
 * Axis keys are cell values, so a key is only named when its own marginal total is at or above k. A key with
 * three rows behind it would arrive with every cell suppressed and the key itself still published — which is
 * the same disclosure `aggregate` refuses, made by a different route.
 */
export function computeCrosstab(
  dataset: Dataset,
  rowColumn: Column,
  columnColumn: Column,
  k: number,
): CrosstabResult {
  const rowTotals = new Map<string, number>()
  const columnTotals = new Map<string, number>()
  const cellCounts = new Map<string, number>()

  for (const row of dataset.rows) {
    const rowKey = row[rowColumn.index] ?? ''
    const columnKey = row[columnColumn.index] ?? ''

    rowTotals.set(rowKey, (rowTotals.get(rowKey) ?? 0) + 1)
    columnTotals.set(columnKey, (columnTotals.get(columnKey) ?? 0) + 1)

    const cell = cellKey(rowKey, columnKey)
    cellCounts.set(cell, (cellCounts.get(cell) ?? 0) + 1)
  }

  const rowKeys = axisKeys(rowTotals, k)
  const columnKeys = axisKeys(columnTotals, k)

  let suppressedCells = 0

  const cells = rowKeys.map((rowKey) =>
    columnKeys.map((columnKey) => {
      const reported = reportCount(cellCounts.get(cellKey(rowKey, columnKey)) ?? 0, k)
      if (reported.status === 'suppressed') {
        suppressedCells += 1
        return 'suppressed' as const
      }
      return reported.value
    }),
  )

  return {
    rowKeys,
    columnKeys,
    cells,
    suppressedCells,
    truncated: rowTotals.size > rowKeys.length || columnTotals.size > columnKeys.length,
  }
}

/**
 * One cell's key in the counting map.
 *
 * The separator is U+0000, written as an escape because a raw control character in a source file is invisible
 * to whoever reads it next. It has to be something no cell can contain: with a space, the pair
 * `("a b", "c")` and the pair `("a", "b c")` produce the same key and their counts merge — a crosstab that
 * quietly adds two unrelated groups together and reports the total as one cell. A CSV cell can hold a space,
 * a tab, a comma or a newline; it cannot hold a NUL.
 */
function cellKey(rowKey: string, columnKey: string): string {
  return `${rowKey}\u0000${columnKey}`
}

/** Keys above k, most frequent first, capped. Ties broken by name so two identical calls agree. */
function axisKeys(totals: ReadonlyMap<string, number>, k: number): readonly string[] {
  return [...totals]
    .filter(([, count]) => count >= k)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_CROSSTAB_KEYS)
    .map(([key]) => key)
}
