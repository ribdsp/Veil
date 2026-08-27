/**
 * Turn a value into its shape.
 *
 * Owner: Riko. Required reading: docs/privacy-guard.md § Masking.
 *
 * `9` for a digit, `A` for an uppercase letter, `a` for a lowercase letter, everything else literal:
 *
 *   Ahmad Fauzi            →  Aaaaa Aaaaa
 *   +6281234567890         →  +99999999999999
 *   27/08/2026             →  99/99/9999
 *   a.wijaya@example.co.id →  a.aaaaaa@aaaaaaa.aa.aa
 *
 * **Punctuation and structure survive, and they have to.** An agent writing a date transform needs to know
 * whether the separator is `/` or `.`; one writing a phone transform needs to see the `+`. That is the
 * entire informational content of a masked exemplar, and masking the punctuation too would leave a string
 * of `9`s that says nothing.
 *
 * The leakage this accepts is written down rather than waved away: `a.aaaaaa@aaaaaaa.aa.aa` reveals that
 * the local part begins with a letter and contains a dot, and a very short value in a distinctive column
 * could in principle be narrowed by its mask. What bounds it is that exemplars are capped at 10 per column,
 * drawn only from format buckets that are themselves above k, and there is no way to ask for the mask of a
 * *specific* row.
 */

/**
 * Mask one value.
 *
 * TODO(riko), Day 3: implement. Iterate code points, not UTF-16 units: `value.length` and index access
 * split an emoji or a Devanagari cluster in half, and half a code point in the output is a bug that only
 * appears on the datasets we did not test with. `[...value]` is enough.
 *
 * TODO(riko), Day 3: a non-Latin letter has no `A`/`a` distinction to report. Map any letter outside
 * `[A-Za-z]` to a single `x` rather than guessing at case — and note in the exemplar list that the column
 * contains non-Latin script, because that is a fact the agent needs to write a sensible transform and it is
 * not visible from a mask of `x`s.
 */
export function mask(_value: string): string {
  throw new Error('mask: not implemented')
}

/**
 * Mask a before/after pair for a transform preview.
 *
 * `{ from: '99/99/9999', to: '9999-99-99' }` — enough to confirm the transform does what was intended, not
 * enough to read a record. An unmasked pair would be a bulk read wearing a preview's clothes.
 *
 * TODO(riko), Day 3: implement.
 */
export function maskPair(_before: string, _after: string): { from: string; to: string } {
  throw new Error('maskPair: not implemented')
}

/**
 * Pick exemplars to show, spreading across buckets before doubling up within one.
 *
 * Ten masks of the same format teach the agent nothing on the tenth that it did not know on the second; one
 * mask per format teaches it the shape of the problem.
 *
 * TODO(riko), Day 3: implement — round-robin across buckets, then fill. Sample deterministically (first
 * matching row per bucket, in row order) rather than randomly: an exemplar set that changes between two
 * calls makes a suspicious agent call again, and calling again is how a differencing attack starts.
 */
export function sampleExemplars(
  _buckets: readonly { format: string; rowIds: readonly number[] }[],
  _valueAt: (rowId: number) => string,
  _limit = 10,
): readonly { format: string; masked: string }[] {
  throw new Error('sampleExemplars: not implemented')
}
