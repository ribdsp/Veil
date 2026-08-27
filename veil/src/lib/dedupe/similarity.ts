/**
 * String similarity for near-duplicate detection.
 *
 * Owner: Riko.
 *
 * Runs entirely inside the guard. The agent receives a pair of row ids and a score; it never learns which
 * characters differed, which is what makes `find_duplicates` the clearest demonstration of the whole
 * premise — genuinely useful work that genuinely needs to compare values, where the agent never sees one.
 */

/**
 * Normalised Levenshtein similarity in [0, 1].
 *
 * TODO(riko), Day 5: implement with the two-row dynamic-programming variant, not the full matrix. Full-matrix
 * Levenshtein on 40-character strings across thousands of candidate pairs allocates enough to matter on the
 * thread holding the UI, and the two-row form is the same algorithm with O(min(a,b)) memory.
 *
 * TODO(riko), Day 5: short-circuit on a length difference greater than the tolerance implied by the
 * threshold. At 0.85, strings differing in length by more than 15% cannot possibly score high enough, and
 * that check removes most of the work before it starts.
 */
export function similarity(_a: string, _b: string): number {
  throw new Error('similarity: not implemented')
}

/**
 * Fold a value for comparison: lowercase, collapse whitespace, strip punctuation.
 *
 * The reason `find_duplicates` catches `PT. Sumber Jaya` and `pt sumber jaya`, which is the case people
 * actually have in their files.
 *
 * TODO(riko), Day 5: implement. Use `localeCompare`-safe folding rather than a naive `toLowerCase()` — see
 * the test for the case that breaks.
 */
export function fold(_value: string): string {
  throw new Error('fold: not implemented')
}
