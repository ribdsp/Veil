import type { Column, Dataset, DuplicatePair } from '@/types/domain'

/**
 * Find candidate duplicate pairs without comparing every row to every other row.
 *
 * Owner: Riko.
 *
 * A 50,000-row file has 1.25 billion pairs. Comparing them all with Levenshtein is not slow, it is
 * impossible — and this runs on the thread holding the UI, which is the thread the human uses to answer
 * reveal requests. So: **blocking**. Group rows by a cheap key that near-duplicates are very likely to
 * share, then compare only within groups.
 */

/** Never return more than this many pairs; the response says when it truncated. */
export const MAX_PAIRS = 50

/**
 * A cheap key that near-duplicates tend to share.
 *
 * TODO(riko), Day 5: implement. Start with the first two characters of the folded value plus its length
 * bucket (length ÷ 4). Cheap, and it groups `Ahmad`/`Ahmed` together.
 *
 * TODO(riko), Day 5: use **two** blocking passes with different keys and union the results — one keyed on the
 * prefix, one on the last four characters. A single prefix key misses every duplicate whose first character
 * is the typo, which is a whole class of real duplicates (`Wijaya`/`Vijaya`) and precisely the class a human
 * would not spot either. Two cheap passes beat one clever key.
 */
function blockKey(_value: string): string {
  throw new Error('blockKey: not implemented')
}

/**
 * Candidate pairs above the threshold, highest score first.
 *
 * TODO(riko), Day 5: implement. Concatenate the named columns per row, fold, block, compare within blocks,
 * score with `similarity`, keep pairs at or above `threshold`.
 *
 * TODO(riko), Day 5: cap the work, not just the output. A pathological file — one where every row shares a
 * block key, e.g. a column of `N/A` — puts the whole file in one block and the quadratic blow-up is back.
 * Abandon a block larger than 500 rows and report it: "column x has 4,000 rows sharing a value, which is
 * probably a placeholder rather than a duplicate" is a *better* finding than a list of pairs anyway.
 *
 * TODO(riko), Day 5: emit each pair once. `(3, 17)` and `(17, 3)` are the same pair, and a UI listing both
 * asks the human to make the same decision twice — which is how habituation starts, and habituation is the
 * risk docs/threat-model.md (T8) admits it cannot measure.
 */
export function findPairs(
  _dataset: Dataset,
  _columns: readonly Column[],
  _threshold: number,
): { pairs: readonly DuplicatePair[]; truncated: boolean; skippedBlocks: readonly string[] } {
  throw new Error('findPairs: not implemented')
}

void blockKey
