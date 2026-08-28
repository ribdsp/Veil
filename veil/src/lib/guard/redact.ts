/**
 * Turn a value into its shape.
 *
 * Owner: Riko. Required reading: docs/privacy-guard.md § Masking.
 *
 * `0` for a digit, `A` for an uppercase letter, `a` for a lowercase letter, everything else literal:
 *
 *   Ahmad Fauzi            →  Aaaaa Aaaaa
 *   +6281234567890         →  +0000000000000
 *   27/08/2026             →  00/00/0000
 *   a.wijaya@example.co.id →  a.aaaaaa@aaaaaaa.aa.aa
 *
 * **Punctuation and structure survive, and they have to.** An agent writing a date transform needs to know
 * whether the separator is `/` or `.`; one writing a phone transform needs to see the `+`. That is the
 * entire informational content of a masked exemplar, and masking the punctuation too would leave a string
 * of placeholders that says nothing.
 *
 * The leakage this accepts is written down rather than waved away: `a.aaaaaa@aaaaaaa.aa.aa` reveals that
 * the local part begins with a letter and contains a dot, and a very short value in a distinctive column
 * could in principle be narrowed by its mask. What bounds it is that exemplars are capped at 10 per column,
 * drawn only from format buckets that are themselves above k, and there is no way to ask for the mask of a
 * *specific* row.
 *
 * ## The digit glyph is `0`, not `9`
 *
 * `apply-transform.test.ts` asserts that no masked example contains `[1-9]`, which is the stronger property
 * and the right one: with `9` as the placeholder, a mask is indistinguishable from a real value made of
 * nines, and "is this a mask or a value" is a question no reader of a report should have to ask. Several
 * files in `docs/` and one comment in `domain.ts` still say `9`; they are outside this area and are flagged
 * rather than edited.
 */

/** Placeholders. One character each, so a mask has the same visible length as its value. */
const DIGIT = '0'
const UPPER = 'A'
const LOWER = 'a'
/** A letter with no case to report — Han, Arabic, Devanagari, Thai. See `mask`. */
const OTHER_LETTER = 'x'

const ASCII_DIGIT = /^\d$/
const ASCII_UPPER = /^[A-Z]$/
const ASCII_LOWER = /^[a-z]$/
const ANY_LETTER = /^\p{L}$/u
/** Combining marks: accents, vowel signs, viramas. Dropped rather than kept. See `mask`. */
const COMBINING_MARK = /^\p{M}$/u

/**
 * Mask one value.
 *
 * Iterates code points, not UTF-16 units. `value.length` and `value[i]` split an emoji or a Devanagari
 * cluster in half, and half a code point in the output is a bug that only appears on the datasets we did not
 * test with. `[...value]` is enough.
 *
 * Each character is classified by its **base** letter, found by decomposing that one character with NFD. `é`
 * is one code point in almost every real CSV, and classifying it directly would put it outside `[A-Za-z]` and
 * mask it as `x` — which then has `scriptNote` telling the agent that case transforms do nothing to it, about
 * a letter where `changeCase` works perfectly. Decomposing per character rather than normalising the whole
 * string keeps one visible character to one mask character: NFD over a Hangul syllable yields three jamo, and
 * a mask longer than its value misreports the shape.
 *
 * A letter whose base is still outside `[A-Za-z]` has no `A`/`a` distinction to report, so it becomes a single
 * `x` rather than a guess at its case. That the column is non-Latin is a fact the agent needs in order to
 * write a sensible transform — `changeCase` on a Han column is a no-op, and an agent that does not know why
 * will propose it twice — and it is not visible from a row of `x`s. `scriptNote` says it in words.
 *
 * Combining marks are dropped rather than passed through as literals. The letter they attach to has already
 * become `a`, and keeping the mark would render the mask as `á` — a mask that shows a diacritic from
 * somebody's name, which is both a leak and a shape no transform needs to see.
 */
export function mask(value: string): string {
  let masked = ''

  for (const character of value) {
    if (COMBINING_MARK.test(character)) continue

    // The first code point of the decomposition: `é` → `e`, `한` → `ᄒ`, everything already-decomposed → itself.
    const base = [...character.normalize('NFD')][0] ?? character

    if (ASCII_DIGIT.test(base)) masked += DIGIT
    else if (ASCII_UPPER.test(base)) masked += UPPER
    else if (ASCII_LOWER.test(base)) masked += LOWER
    else if (ANY_LETTER.test(base)) masked += OTHER_LETTER
    // Punctuation, spaces and symbols pass through as themselves, not as their decomposition.
    else masked += character
  }

  return masked
}

/**
 * Mask a before/after pair for a transform preview.
 *
 * `{ from: '00/00/0000', to: '0000-00-00' }` — enough to confirm the transform does what was intended, not
 * enough to read a record. An unmasked pair would be a bulk read wearing a preview's clothes.
 */
export function maskPair(before: string, after: string): { from: string; to: string } {
  return { from: mask(before), to: mask(after) }
}

/**
 * Whether a set of masks contains letters from a script with no case.
 *
 * Returned as a sentence for the tool layer to append to an exemplar list, because
 * `{ format, masked }` has nowhere to put it and `ColumnProfile` is frozen. The alternative — leaving the
 * agent to infer it from `x` — costs a call and usually produces a `changeCase` proposal that does nothing.
 */
export function scriptNote(masks: readonly string[]): string | null {
  const affected = masks.filter((masked) => masked.includes(OTHER_LETTER)).length
  if (affected === 0) return null
  return (
    `${affected} of these shapes contain "${OTHER_LETTER}", which stands for a letter in a script that has ` +
    `no upper and lower case — Han, Arabic, Devanagari, Thai. Case transforms do nothing to those values.`
  )
}

/**
 * Pick exemplars to show, spreading across buckets before doubling up within one.
 *
 * Ten masks of the same format teach the agent nothing on the tenth that it did not know on the second; one
 * mask per format teaches it the shape of the problem. So: round-robin across the buckets, then fill from
 * whichever still have rows left — and skip a mask already shown for that format, because masking collapses
 * values, and a low-cardinality column otherwise answers with the same string ten times. Fewer than `limit`
 * exemplars is the honest answer when the column only has that many shapes in it.
 *
 * Sampled deterministically — first matching row per bucket, in row order — rather than randomly. An
 * exemplar set that changes between two identical calls makes a suspicious agent call again, and calling
 * again with slightly different arguments is how a differencing attack starts. It also makes the reports the
 * human reads reproducible, which matters when they are deciding whether to approve one.
 *
 * `valueAt` is a closure supplied by `lib/guard`; the raw values never leave it. Nothing here retains a
 * value beyond the `mask` call that consumes it.
 */
export function sampleExemplars(
  buckets: readonly { format: string; rowIds: readonly number[] }[],
  valueAt: (rowId: number) => string,
  limit = 10,
): readonly { format: string; masked: string }[] {
  const exemplars: { format: string; masked: string }[] = []
  if (limit <= 0) return exemplars

  // One cursor per bucket, so a bucket that has been drawn from does not repeat its first row on the next
  // round. Rows within a bucket are already in ascending order.
  const cursors = buckets.map(() => 0)
  // Masks already shown, keyed by format: the same shape under two different formats is worth seeing, since
  // it says the classifier split values that look alike.
  const seen = new Set<string>()

  let scanned = 0
  let exhausted = false
  while (exemplars.length < limit && !exhausted && scanned < MAX_EXEMPLAR_SCAN) {
    exhausted = true

    for (let index = 0; index < buckets.length && exemplars.length < limit; index += 1) {
      const bucket = buckets[index]
      const cursor = cursors[index]
      if (bucket === undefined || cursor === undefined) continue
      const rowId = bucket.rowIds[cursor]
      if (rowId === undefined) continue

      cursors[index] = cursor + 1
      exhausted = false
      scanned += 1

      const masked = mask(valueAt(rowId))
      const key = [bucket.format, masked].join('#')
      if (seen.has(key)) continue
      seen.add(key)

      exemplars.push({ format: bucket.format, masked })
    }
  }

  return exemplars
}

/**
 * How many rows may be masked while looking for a shape not already shown.
 *
 * Without it, a million-row column holding one shape would mask every value to fill ten slots it can never
 * fill. Ten distinct shapes inside the first two hundred rows is the case worth optimising for; a column that
 * hides its eleventh shape deeper than that is a column to ask a human about.
 */
const MAX_EXEMPLAR_SCAN = 200
