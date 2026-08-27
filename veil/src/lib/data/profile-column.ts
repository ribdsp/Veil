import type { Column, ColumnProfile, Dataset, FormatBucket, Issue } from '@/types/domain'

/**
 * Compute a column's profile: the densest answer in the tool surface.
 *
 * Owner: Riko.
 *
 * Called from `lib/guard`, never from a tool. The functions here return statistics and classes; they never
 * return a value. Masking happens in `guard/redact.ts` and the exemplars arrive here already masked, so this
 * file has no reason to hold a raw string beyond the loop it was read in.
 */

/**
 * Type, missing count, distinct count, format histogram, length range, masked exemplars.
 *
 * TODO(riko), Day 3: implement on top of `reduceColumn` from `parse-csv.ts`. One pass computing everything —
 * a pass per statistic is five passes over 50k rows, on the thread holding the UI.
 *
 * TODO(riko), Day 3: cap `distinctCount` computation. A `Set` over a unique 50k column holds 50k strings,
 * which is both a memory spike and a second place raw values live for the lifetime of the profile. Stop
 * counting at 1,000 distinct values and report `'unique'`; nothing in the product needs the exact number
 * above that, and the answer to "is this an identifier" is settled long before 1,000.
 */
export function profileColumn(
  _dataset: Dataset,
  _column: Column,
  _k: number,
): Omit<ColumnProfile, 'exemplars'> {
  throw new Error('profileColumn: not implemented')
}

/**
 * Group a column's values by the format each matches.
 *
 * TODO(riko), Day 3: implement using `classify` from `patterns.ts`, not `matchesFormat`. A histogram built
 * from `matchesFormat` has overlapping buckets — `+6281234567890` is both `phoneE164` and
 * `digitsFixedLength` — and buckets that overlap do not sum to the row count, which is the same
 * "I was given a filtered dataset" failure that dropping small groups causes.
 *
 * TODO(riko), Day 3: buckets below k merge into `unrecognised` rather than disappearing, and the merge is
 * re-checked afterwards: two buckets of 2 merge to 4, which is still below the threshold. Keep at most 8
 * buckets and merge the tail.
 */
export function formatBuckets(
  _dataset: Dataset,
  _column: Column,
  _k: number,
): readonly FormatBucket[] {
  throw new Error('formatBuckets: not implemented')
}

/**
 * Everything wrong with one column.
 *
 * TODO(riko), Day 4: implement. The eleven `IssueCode` values in `domain.ts` are the full list; each needs a
 * count and up to 100 row ids. Notes on the ones with judgement in them:
 *
 *   - `mostlyFilledButSomeEmpty` — only fires when the column is ≥ 90% filled. A half-empty column is a
 *     design choice, not a defect, and reporting it as one teaches the agent to propose transforms nobody
 *     asked for.
 *   - `inconsistentDateFormat` — two or more date formats in one column. The most valuable finding in the
 *     product, and the reason `normaliseDate` exists.
 *   - `ambiguousDateOrder` — `dateDmySlash` and `dateMdySlash` both present, or a single format with every
 *     day ≤ 12. Unresolvable without asking; hand it to `ask_human`.
 *   - `numberStoredAsText` — the column types as `text` but ≥ 95% of values parse as numbers. Check for
 *     leading zeros first: `007` parses, and "fixing" it destroys the value.
 *   - `placeholderValue` — `N/A`, `-`, `null`, `NULL`, `#N/A`, `TBD`, `?`. Compare case-insensitively but
 *     record what was actually there, so the transform report shows the human their own file's convention.
 *   - `outlierNumeric` — flag by count, never by value. "3 rows are far from the rest" is a finding; the
 *     numbers themselves are three real values from three real records.
 *
 * TODO(riko), Day 4: `trailingWhitespace` deserves care. Trimming is the single most common cleaning
 * operation and the one most likely to be applied blindly, and there are columns where a trailing space is
 * meaningful — fixed-width exports, deliberately padded codes. Report it; let the human approve it.
 */
export function columnIssues(
  _dataset: Dataset,
  _column: Column,
  _k: number,
): readonly Issue[] {
  throw new Error('columnIssues: not implemented')
}
