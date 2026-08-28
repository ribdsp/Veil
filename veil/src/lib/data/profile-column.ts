import type {
  Column,
  ColumnProfile,
  ColumnSummary,
  Dataset,
  FormatBucket,
  Issue,
  IssueCode,
  NamedFormat,
  RowId,
} from '@/types/domain'

import { reduceColumn } from './parse-csv'
import { classify, dateParts, isPlaceholder, isRealDate, numericValue } from './patterns'

/**
 * Compute a column's profile: the densest answer in the tool surface.
 *
 * Owner: Riko.
 *
 * Called from `lib/guard`, never from a tool. The functions here return statistics and classes; they never
 * return a value. Masking happens in `guard/redact.ts` and the exemplars arrive here already masked, so this
 * file has no reason to hold a raw string beyond the loop it was read in.
 *
 * Everything below reads cells through `reduceColumn`, which is the only exit from `parse-csv.ts`. The
 * accumulators are mutated in place inside the reducer rather than rebuilt per row — a new object for each
 * of 50,000 rows is 50,000 allocations on the thread holding the UI, and the accumulator never escapes the
 * function that made it.
 */

/** Distinct values counted before giving up and saying `'unique'`. See `profileColumn`. */
const DISTINCT_CAP = 1000

/** Format buckets reported. `ColumnProfile.formats` documents the same number. */
const MAX_BUCKETS = 8

/** Row ids per issue. `Issue.affectedCount` carries the true total. */
const MAX_ISSUE_ROWS = 100

/** Share of non-empty values that has to parse as a number before the rest are called a defect. */
const NUMERIC_DOMINANCE = 0.95

/** Share of non-empty values that has to share one length before the other lengths are a defect. */
const LENGTH_DOMINANCE = 0.9

/** Share of non-empty values that has to be distinct before a repeat is a defect rather than a category. */
const KEY_DISTINCTNESS = 0.9

/** Interquartile ranges from the quartiles before a number is far enough out to be worth a look. */
const OUTLIER_FENCE = 3

/** Numeric values needed before "far from the rest" means anything. */
const MIN_DISTRIBUTION_ROWS = 20

/* -------------------------------------------------------------------------------------------------
 * The profile
 * ---------------------------------------------------------------------------------------------- */

type Scan = {
  empty: number
  nonEmpty: number
  minLength: number
  maxLength: number
  formats: Map<NamedFormat, number>
  /** Dropped once `DISTINCT_CAP` is passed, which is also the signal to report `'unique'`. */
  distinct: Set<string> | null
}

function newScan(): Scan {
  return {
    empty: 0,
    nonEmpty: 0,
    minLength: Number.POSITIVE_INFINITY,
    maxLength: 0,
    formats: new Map(),
    distinct: new Set(),
  }
}

function scanCell(scan: Scan, cell: string): void {
  if (cell.trim() === '') {
    scan.empty += 1
    return
  }

  scan.nonEmpty += 1

  // Code points, not UTF-16 units. A length of 2 for one emoji is a number no human recognises as the
  // length of their own data.
  const length = [...cell].length
  if (length < scan.minLength) scan.minLength = length
  if (length > scan.maxLength) scan.maxLength = length

  const format = classify(cell)
  scan.formats.set(format, (scan.formats.get(format) ?? 0) + 1)

  if (scan.distinct !== null) {
    scan.distinct.add(cell)
    // Past the cap the set is released. It is the one structure here that grows with the file, and holding
    // 50,000 strings for the lifetime of a profile is both a memory spike and a second place the user's
    // values live.
    if (scan.distinct.size > DISTINCT_CAP) scan.distinct = null
  }
}

/**
 * Type, missing count, distinct count, format histogram, length range.
 *
 * One pass computing all of it. A pass per statistic is five passes over 50k rows on the thread holding the
 * UI, and that thread is the one the human has to be able to click "reveal" on.
 *
 * `distinctCount` is `'unique'` once more than 1,000 distinct values have been seen. Nothing in the product
 * needs the exact number above that — the question a distinct count answers is "is this an identifier", and
 * that is settled long before 1,000 — while the exact number is a figure an agent can difference against.
 * The tool description tells the model what the word means, so `'unique'` is never read as `rowCount`.
 *
 * Blank cells are counted in `emptyCount` and left out of the format histogram. `FormatBucket.share` is
 * defined over non-empty values, so including a `blank` bucket would produce shares that sum to more than 1
 * in a half-empty column, and a model that adds up the shares would conclude the buckets overlap.
 */
export function profileColumn(
  dataset: Dataset,
  column: Column,
  k: number,
): Omit<ColumnProfile, 'exemplars'> {
  const scan = reduceColumn(dataset, column, newScan(), (state, cell) => {
    scanCell(state, cell)
    return state
  })

  const histogram = bucketise(scan.formats, scan.nonEmpty, k)

  return {
    id: column.id,
    type: column.type,
    emptyCount: scan.empty,
    distinctCount: scan.distinct === null ? 'unique' : scan.distinct.size,
    minLength: scan.nonEmpty === 0 ? 0 : scan.minLength,
    maxLength: scan.maxLength,
    formats: histogram.buckets,
    truncated: histogram.truncated,
  }
}

/**
 * The cheap half of a profile: type, missing count, distinct count. No format histogram.
 *
 * `describe_dataset` needs this for every column and is not charged, so it is the one call whose cost is
 * bounded only by the file. `profileColumn` runs 24 recognisers per cell; on 20 columns × 50,000 rows that is
 * 24 million pattern tests to answer "what is in this file", on the thread holding the UI. This runs none.
 *
 * Deliberately not a second definition of anything: same `DISTINCT_CAP`, same `'unique'` rule, same
 * "blank means empty" test as `scanCell`. A summary that counted distinctness differently from the profile
 * would make `describe_dataset` and `profile_column` disagree about the same column, and the agent would
 * spend a question finding out which one to believe.
 */
export function columnSummary(dataset: Dataset, column: Column): ColumnSummary {
  const scan = reduceColumn(
    dataset,
    column,
    { empty: 0, distinct: new Set<string>() as Set<string> | null },
    (state, cell) => {
      if (cell.trim() === '') {
        state.empty += 1
        return state
      }
      if (state.distinct !== null) {
        state.distinct.add(cell)
        if (state.distinct.size > DISTINCT_CAP) state.distinct = null
      }
      return state
    },
  )

  return {
    id: column.id,
    type: column.type,
    emptyCount: scan.empty,
    distinctCount: scan.distinct === null ? 'unique' : scan.distinct.size,
  }
}

/**
 * Group a column's values by the format each matches.
 *
 * Built with `classify`, not `matchesFormat`: a histogram built from `matchesFormat` has overlapping buckets
 * — `+6281234567890` is both `phoneE164` and `digitsFixedLength` — and buckets that overlap do not sum to
 * the row count, which is the same "I was given a filtered dataset" failure that dropping small groups
 * causes.
 *
 * A second pass over the column, so `profileColumn` does not call this. Two entry points, one pass each,
 * beats one entry point and two passes for the caller who wanted everything.
 */
export function formatBuckets(
  dataset: Dataset,
  column: Column,
  k: number,
): readonly FormatBucket[] {
  const scan = reduceColumn(dataset, column, newScan(), (state, cell) => {
    scanCell(state, cell)
    return state
  })
  return bucketise(scan.formats, scan.nonEmpty, k).buckets
}

/** Row ids kept per raw format, for exemplars. `sampleExemplars` masks these and keeps the distinct ones. */
const MAX_EXEMPLAR_ROWS = 16

/** A reported bucket plus a few rows that landed in it, for `guard/redact.ts` to mask. */
export type FormatSample = FormatBucket & { rowIds: readonly RowId[] }

/**
 * The format histogram, plus a handful of row ids per reported bucket.
 *
 * What `sample_shapes` is built on. The row ids exist so the guard can mask an exemplar per bucket; they are
 * capped at 16 per raw format, and rows are kept in file order, which is what makes two identical calls return
 * the same exemplars.
 *
 * 16 is a privacy parameter, not a memory one. `sampleExemplars` masks these rows and keeps only the *distinct*
 * masks, so a deeper pool preferentially surfaces unusual shapes — an unusually long name, a value with digits
 * in it — which is the opposite of what suppression is for. Raising it would show more of a column's real
 * variety and would also make a distinctive mask likelier to appear; that trade is a decision for whoever owns
 * docs/privacy-guard.md, not a tuning constant.
 *
 * Attribution after folding is the part worth reading. `bucketise` folds every below-k and past-eighth bucket
 * into `unrecognised`, so the ids of a folded format have to follow their count there — otherwise the agent
 * gets a bucket of 40 with one exemplar in it, and the two numbers in front of it disagree. When
 * `unrecognised` is not itself reported, those ids are dropped with the count they belonged to: a shape below
 * k does not get an exemplar by the back door.
 */
export function formatSamples(
  dataset: Dataset,
  column: Column,
  k: number,
): { buckets: readonly FormatSample[]; truncated: boolean } {
  const scan = reduceColumn(
    dataset,
    column,
    {
      nonEmpty: 0,
      counts: new Map<NamedFormat, number>(),
      rowIds: new Map<NamedFormat, RowId[]>(),
    },
    (state, cell, rowId) => {
      if (cell.trim() === '') return state

      state.nonEmpty += 1
      const format = classify(cell)
      state.counts.set(format, (state.counts.get(format) ?? 0) + 1)

      const seen = state.rowIds.get(format)
      if (seen === undefined) state.rowIds.set(format, [rowId])
      else if (seen.length < MAX_EXEMPLAR_ROWS) seen.push(rowId)

      return state
    },
  )

  const histogram = bucketise(scan.counts, scan.nonEmpty, k)
  const reported = new Set(histogram.buckets.map((bucket) => bucket.format))
  const folded = [...scan.counts.keys()].filter((format) => !reported.has(format))

  const buckets = histogram.buckets.map((bucket) => ({
    ...bucket,
    rowIds:
      bucket.format === 'unrecognised'
        ? [...(scan.rowIds.get('unrecognised') ?? []), ...folded.flatMap((f) => scan.rowIds.get(f) ?? [])]
        : (scan.rowIds.get(bucket.format) ?? []),
  }))

  return { buckets, truncated: histogram.truncated }
}

/**
 * Counts into reported buckets.
 *
 * Two folds, in this order: buckets below k, then everything past the eighth. Both land in `unrecognised`
 * rather than disappearing, for the reason `mergeSmallGroups` exists — a histogram that does not sum to the
 * non-empty count tells the agent the dataset was filtered.
 *
 * The merged bucket is re-checked against k afterwards, because two buckets of two make a bucket of four and
 * publishing that would be doing the suppression once. When even the merged bucket is too small it is
 * dropped and `truncated` is what says a tail exists.
 */
function bucketise(
  counts: ReadonlyMap<NamedFormat, number>,
  nonEmpty: number,
  k: number,
): { buckets: readonly FormatBucket[]; truncated: boolean } {
  const ordered = [...counts]
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count || a.format.localeCompare(b.format))

  const kept: { format: NamedFormat; count: number }[] = []
  let foldedRows = 0
  let foldedBuckets = 0

  for (const bucket of ordered) {
    if (bucket.count >= k && kept.length < MAX_BUCKETS) kept.push(bucket)
    else {
      foldedRows += bucket.count
      foldedBuckets += 1
    }
  }

  const merged = foldInto(kept, foldedRows, k)

  return {
    buckets: merged
      .sort((a, b) => b.count - a.count || a.format.localeCompare(b.format))
      .map(({ format, count }) => ({
        format,
        count,
        share: nonEmpty === 0 ? 0 : Math.round((count / nonEmpty) * 1000) / 1000,
      })),
    truncated: foldedBuckets > 0,
  }
}

function foldInto(
  kept: readonly { format: NamedFormat; count: number }[],
  foldedRows: number,
  k: number,
): { format: NamedFormat; count: number }[] {
  if (foldedRows === 0) return [...kept]

  const existing = kept.find((bucket) => bucket.format === 'unrecognised')
  if (existing !== undefined) {
    return kept.map((bucket) =>
      bucket.format === 'unrecognised' ? { ...bucket, count: bucket.count + foldedRows } : bucket,
    )
  }
  // Below k even after merging: named nowhere, counted nowhere, and `truncated` is the only honest thing
  // left to say about it.
  if (foldedRows < k) return [...kept]

  return [...kept, { format: 'unrecognised', count: foldedRows }]
}

/* -------------------------------------------------------------------------------------------------
 * The findings
 *
 * Row ids and counts here are **not** k-suppressed, and that is the documented decision rather than an
 * omission — see docs/privacy-guard.md § "Row ids are not suppressed, on purpose". A row id is a position
 * in a file; it identifies nobody without the file, and suppressing "3 rows have an impossible date" would
 * leave the agent unable to fix the three rows that most need fixing. k is still used where a *distribution*
 * is being described rather than a defect located: see `outOfRange`.
 * ---------------------------------------------------------------------------------------------- */

type Finding = { rowIds: RowId[]; count: number }

function newFinding(): Finding {
  return { rowIds: [], count: 0 }
}

/** Rows arrive in ascending order, so `rowIds` is ascending without a sort. */
function note(finding: Finding, rowId: RowId): void {
  finding.count += 1
  if (finding.rowIds.length < MAX_ISSUE_ROWS) finding.rowIds.push(rowId)
}

function toIssue(code: IssueCode, column: Column, finding: Finding): Issue | null {
  if (finding.count === 0) return null
  return {
    code,
    column: column.id,
    rowIds: finding.rowIds,
    affectedCount: finding.count,
    truncated: finding.count > finding.rowIds.length,
  }
}

type IssueScan = {
  nonEmpty: number
  leading: Finding
  trailing: Finding
  placeholder: Finding
  impossibleDate: Finding
  futureDate: Finding
  nonNumeric: Finding
  numericCount: number
  leadingZeroCount: number
  /** Values and their rows, for the outlier fence. Numbers, not the strings they were read from. */
  numbers: number[]
  numberRows: RowId[]
  /** Row ids per format, for `mixedFormat`, capped the same way a finding is. */
  byFormat: Map<NamedFormat, Finding>
  /** Row ids per length, for `inconsistentLength`. */
  byLength: Map<number, Finding>
  /** Exact value → occurrences, for `duplicateKey`. Dropped past the cap. */
  byValue: Map<string, number> | null
  /** Case-folded value → the first spelling seen, for `inconsistentCase`. Dropped past the cap. */
  byFolded: Map<string, string> | null
  /** Folded values seen spelled more than one way. */
  caseConflicts: Set<string>
}

/**
 * Everything wrong with one column.
 *
 * All eleven `IssueCode` values are produced here. The ones with judgement in them:
 *
 *   - `mixedFormat` — two or more formats among the non-empty values, reported against the rows that are
 *     *not* in the majority format. The most valuable finding in the product and the reason
 *     `normaliseDate` exists.
 *   - `nonNumericInNumericColumn` — fires when at least 95% of non-empty values parse as numbers and the
 *     rest do not, whatever the column's inferred type. That covers both a numeric column with three
 *     `N/A`s in it and a column of numbers stored as text with three stray words. It does **not** fire when
 *     the numbers carry leading zeros: `007` parses, and a column of `007`s is a code that "fixing" would
 *     destroy.
 *   - `outOfRange` — outliers by count, never by value. "3 rows are far from the rest" is a finding; the
 *     three numbers are three real values belonging to three real records. Needs a distribution to be far
 *     from, so it is skipped for columns with fewer than 20 numeric values, and skipped when the column has
 *     fewer than k of them: an outlier flag over four values points at one person's number.
 *   - `placeholderValue` — compared case-insensitively against the trimmed cell, so `N/A` and `n/a` are one
 *     finding. What was actually written is not recorded here: `Issue` has nowhere to put it, and the
 *     human sees their own file's convention in `propose_transform`'s masked examples instead.
 *   - `duplicateKey` — a repeat in a column that is otherwise ≥90% distinct. In a column of categories a
 *     repeat is the point, so the distinctness floor is what stops this from firing on every `city`.
 *   - `inconsistentCase` — the same value spelled two ways, `Mataram` and `mataram`, rather than merely
 *     "this column contains both cases". A column of names contains both cases by design.
 *   - `trailingWhitespace` — reported, never auto-fixed. Trimming is the most common cleaning operation and
 *     the most likely to be applied blindly, and there are columns where a trailing space is meaningful:
 *     fixed-width exports, deliberately padded codes. The human approves it.
 *
 * Two passes. The first collects everything a single cell can answer for itself; the second exists only
 * because `duplicateKey` and `inconsistentCase` cannot know which rows are affected until the whole column
 * has been seen, and it is skipped when neither found anything.
 */
export function columnIssues(dataset: Dataset, column: Column, k: number): readonly Issue[] {
  const scan = reduceColumn(dataset, column, newIssueScan(), (state, cell, rowId) => {
    scanForIssues(state, cell, rowId)
    return state
  })

  const issues: (Issue | null)[] = [
    toIssue('leadingWhitespace', column, scan.leading),
    toIssue('trailingWhitespace', column, scan.trailing),
    toIssue('placeholderValue', column, scan.placeholder),
    toIssue('impossibleDate', column, scan.impossibleDate),
    toIssue('futureDate', column, scan.futureDate),
    mixedFormatIssue(column, scan),
    numericIssue(column, scan),
    lengthIssue(column, scan),
    outlierIssue(dataset, column, scan, k),
    ...repeatIssues(dataset, column, scan),
  ]

  return issues.filter((issue): issue is Issue => issue !== null)
}

function newIssueScan(): IssueScan {
  return {
    nonEmpty: 0,
    leading: newFinding(),
    trailing: newFinding(),
    placeholder: newFinding(),
    impossibleDate: newFinding(),
    futureDate: newFinding(),
    nonNumeric: newFinding(),
    numericCount: 0,
    leadingZeroCount: 0,
    numbers: [],
    numberRows: [],
    byFormat: new Map(),
    byLength: new Map(),
    byValue: new Map(),
    byFolded: new Map(),
    caseConflicts: new Set(),
  }
}

/** Today, in the timezone of the person looking at the file, which is the only "today" that means anything. */
function today(): { year: number; month: number; day: number } {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

const TODAY = today()

function isFuture(parts: { year: number; month: number; day: number }): boolean {
  if (parts.year !== TODAY.year) return parts.year > TODAY.year
  if (parts.month !== TODAY.month) return parts.month > TODAY.month
  return parts.day > TODAY.day
}

function scanForIssues(scan: IssueScan, cell: string, rowId: RowId): void {
  if (cell.trim() === '') return
  scan.nonEmpty += 1

  if (/^\s/.test(cell)) note(scan.leading, rowId)
  if (/\s$/.test(cell)) note(scan.trailing, rowId)
  if (isPlaceholder(cell)) note(scan.placeholder, rowId)

  const format = classify(cell)
  const formatFinding = scan.byFormat.get(format) ?? newFinding()
  note(formatFinding, rowId)
  scan.byFormat.set(format, formatFinding)

  const length = [...cell].length
  const lengthFinding = scan.byLength.get(length) ?? newFinding()
  note(lengthFinding, rowId)
  scan.byLength.set(length, lengthFinding)

  const parts = dateParts(cell, format)
  if (parts !== null) {
    if (!isRealDate(parts)) note(scan.impossibleDate, rowId)
    else if (isFuture(parts)) note(scan.futureDate, rowId)
  }

  const value = numericValue(cell)
  if (value === null) note(scan.nonNumeric, rowId)
  else {
    scan.numericCount += 1
    scan.numbers.push(value)
    scan.numberRows.push(rowId)
    const digits = cell.trim().replace(/^-/, '')
    if (digits.length > 1 && digits.startsWith('0') && !digits.startsWith('0.')) {
      scan.leadingZeroCount += 1
    }
  }

  if (scan.byValue !== null) {
    scan.byValue.set(cell, (scan.byValue.get(cell) ?? 0) + 1)
    if (scan.byValue.size > DISTINCT_CAP) scan.byValue = null
  }

  if (scan.byFolded !== null) {
    const folded = cell.trim().toLowerCase()
    const first = scan.byFolded.get(folded)
    if (first === undefined) scan.byFolded.set(folded, cell)
    else if (first !== cell) scan.caseConflicts.add(folded)
    if (scan.byFolded.size > DISTINCT_CAP) {
      scan.byFolded = null
      scan.caseConflicts.clear()
    }
  }
}

/**
 * Two or more formats in one column, reported against the minority.
 *
 * The majority format is the column's apparent intent, so the rows worth naming are the ones that depart
 * from it. `affectedCount` is every non-majority row even when more than 100 are named, which is the usual
 * case for the finding that matters: "412 rows are in the other date layout".
 */
function mixedFormatIssue(column: Column, scan: IssueScan): Issue | null {
  if (scan.byFormat.size < 2) return null

  const ordered = [...scan.byFormat].sort((a, b) => b[1].count - a[1].count)
  const [majority, ...minority] = ordered
  if (majority === undefined) return null

  const rowIds = minority
    .flatMap(([, finding]) => finding.rowIds)
    .sort((a, b) => a - b)
    .slice(0, MAX_ISSUE_ROWS)
  const affectedCount = scan.nonEmpty - majority[1].count
  if (affectedCount === 0) return null

  return {
    code: 'mixedFormat',
    column: column.id,
    rowIds,
    affectedCount,
    truncated: affectedCount > rowIds.length,
  }
}

/** Numbers with a few non-numbers in them — or a text column that is numbers with a few words in it. */
function numericIssue(column: Column, scan: IssueScan): Issue | null {
  if (scan.nonEmpty === 0 || scan.nonNumeric.count === 0) return null
  if (scan.numericCount / scan.nonEmpty < NUMERIC_DOMINANCE) return null
  // Leading zeros mean this is a code that happens to be written in digits. Calling the non-numeric rows a
  // defect here invites `normaliseNumber`, which is the transform that turns `007` into `7`.
  if (scan.leadingZeroCount > 0) return null
  return toIssue('nonNumericInNumericColumn', column, scan.nonNumeric)
}

/** One length dominates and a few values disagree — a truncated ID, a phone number missing a digit. */
function lengthIssue(column: Column, scan: IssueScan): Issue | null {
  if (scan.byLength.size < 2 || scan.nonEmpty === 0) return null

  const ordered = [...scan.byLength].sort((a, b) => b[1].count - a[1].count)
  const [majority, ...minority] = ordered
  if (majority === undefined) return null
  if (majority[1].count / scan.nonEmpty < LENGTH_DOMINANCE) return null

  const rowIds = minority
    .flatMap(([, finding]) => finding.rowIds)
    .sort((a, b) => a - b)
    .slice(0, MAX_ISSUE_ROWS)
  const affectedCount = scan.nonEmpty - majority[1].count

  return {
    code: 'inconsistentLength',
    column: column.id,
    rowIds,
    affectedCount,
    truncated: affectedCount > rowIds.length,
  }
}

/**
 * Values far outside the interquartile range.
 *
 * Three IQRs rather than the conventional 1.5, because at 1.5 a skewed but perfectly ordinary column — every
 * salary column ever exported — reports a tenth of its rows as outliers, and a finding that fires on
 * healthy data teaches the agent to ignore findings.
 *
 * The k check is the one place k does real work in this function. Describing where the middle of a column is
 * requires the middle to be made of enough people to be nobody in particular; below k, "this row is far from
 * the others" is a sentence about one person's number.
 */
function outlierIssue(
  _dataset: Dataset,
  column: Column,
  scan: IssueScan,
  k: number,
): Issue | null {
  if (scan.numbers.length < Math.max(MIN_DISTRIBUTION_ROWS, k)) return null

  const sorted = [...scan.numbers].sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const spread = q3 - q1
  // A column of one repeated number has no outliers, and a fence of zero would call every other value one.
  if (spread <= 0) return null

  const low = q1 - OUTLIER_FENCE * spread
  const high = q3 + OUTLIER_FENCE * spread

  const finding = newFinding()
  for (let index = 0; index < scan.numbers.length; index += 1) {
    const value = scan.numbers[index]
    const rowId = scan.numberRows[index]
    if (value === undefined || rowId === undefined) continue
    if (value < low || value > high) note(finding, rowId)
  }

  return toIssue('outOfRange', column, finding)
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const low = sorted[lower] ?? 0
  const high = sorted[upper] ?? low
  return low + (high - low) * (position - lower)
}

/**
 * The two findings that need the whole column before they know which rows to name.
 *
 * A second pass, run only when the first found something to look for. Skipped entirely for columns with more
 * than 1,000 distinct values: there, `byValue` was released, a repeat is not evidence of anything, and
 * `find_duplicates` is the tool that does this properly with blocking.
 */
function repeatIssues(dataset: Dataset, column: Column, scan: IssueScan): (Issue | null)[] {
  const byValue = scan.byValue
  const repeated =
    byValue !== null &&
    scan.nonEmpty > 0 &&
    byValue.size / scan.nonEmpty >= KEY_DISTINCTNESS &&
    byValue.size < scan.nonEmpty

  const conflicted = scan.caseConflicts.size > 0
  if (!repeated && !conflicted) return []

  const duplicates = newFinding()
  const cases = newFinding()

  reduceColumn(dataset, column, null, (_state, cell, rowId) => {
    if (cell.trim() === '') return null
    if (repeated && byValue !== null && (byValue.get(cell) ?? 0) > 1) note(duplicates, rowId)
    if (conflicted && scan.caseConflicts.has(cell.trim().toLowerCase())) note(cases, rowId)
    return null
  })

  return [toIssue('duplicateKey', column, duplicates), toIssue('inconsistentCase', column, cases)]
}
