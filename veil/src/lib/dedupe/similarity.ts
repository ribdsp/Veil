/**
 * String similarity for near-duplicate detection.
 *
 * Owner: Riko.
 *
 * Runs entirely inside the guard. The agent receives a pair of row ids and a score; it never learns which
 * characters differed, which is what makes `find_duplicates` the clearest demonstration of the whole
 * premise — genuinely useful work that genuinely needs to compare values, where the agent never sees one.
 */

/** Letters of any script, digits, and the single space that survives folding. */
const KEEPABLE = /[\p{L}\p{N} ]/u
const WHITESPACE_RUN = /\s+/g

/**
 * Normalised Levenshtein similarity in [0, 1].
 *
 * Normalised by the **longer** string. Dividing by the shorter one makes every prefix a perfect match, so
 * `Ani` would score 1 against `Ani Wijaya Kusuma` and a first name would match half the file.
 *
 * Two implementation notes that are about the UI thread rather than about correctness:
 *
 *   - Two rows of the dynamic-programming matrix, not the full matrix. Full-matrix Levenshtein on
 *     40-character strings across thousands of candidate pairs allocates enough to matter on the thread
 *     holding the UI, and the two-row form is the same algorithm in O(min(a,b)) memory.
 *   - `floor` is the score the caller cares about, and passing it lets most comparisons stop early. At 0.85,
 *     two strings differing in length by more than 15% cannot possibly score high enough, and a row whose
 *     cheapest cell already exceeds the distance budget cannot recover. Both cases return 0 rather than a
 *     real score, which is correct for a caller that was going to discard anything below `floor` anyway —
 *     and `find-pairs.ts` is the only caller that passes it.
 *
 * Code points, not UTF-16 units. A surrogate pair counted as two characters makes an emoji a 50% difference
 * against itself, and a name in a script outside the BMP scores against another name by how its bytes fell.
 */
export function similarity(a: string, b: string, floor = 0): number {
  // Covers both "identical" and "both empty": two empty cells are the same cell. Doing it here also avoids
  // the 0/0 that the naive `1 - distance / maxLength` produces, which is NaN — and NaN compares false
  // against every threshold, so every pair of empty cells would be silently *not* a duplicate, in the
  // column where duplicates are most likely.
  if (a === b) return 1

  const left = [...a]
  const right = [...b]
  if (left.length === 0 || right.length === 0) return 0

  const longest = Math.max(left.length, right.length)
  const budget = floor <= 0 ? longest : Math.floor(longest * (1 - floor))
  if (Math.abs(left.length - right.length) > budget) return 0

  const distance = editDistance(left, right, budget)
  if (distance === null) return 0

  return Math.round((1 - distance / longest) * 1000) / 1000
}

/**
 * Levenshtein distance, or `null` when it provably exceeds `budget`.
 *
 * The shorter string indexes the rows so the two buffers are O(min(a,b)). The buffers are swapped rather
 * than reallocated per row: every cell of the new row is written before it is read, so a stale value from
 * two rows ago cannot survive.
 */
function editDistance(
  a: readonly string[],
  b: readonly string[],
  budget: number,
): number | null {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]

  let previous: number[] = Array.from({ length: short.length + 1 }, (_, index) => index)
  let current: number[] = new Array<number>(short.length + 1).fill(0)

  for (let i = 1; i <= long.length; i += 1) {
    current[0] = i
    let best = i

    for (let j = 1; j <= short.length; j += 1) {
      const cost = long[i - 1] === short[j - 1] ? 0 : 1
      const value = Math.min(
        (previous[j] ?? 0) + 1, // deletion
        (current[j - 1] ?? 0) + 1, // insertion
        (previous[j - 1] ?? 0) + cost, // substitution
      )
      current[j] = value
      if (value < best) best = value
    }

    // Every remaining row can only add to the cheapest cell in this one, so once the cheapest exceeds the
    // budget the final distance does too.
    if (best > budget) return null

    const swap = previous
    previous = current
    current = swap
  }

  return previous[short.length] ?? 0
}

/**
 * Fold a value for comparison: lowercase, collapse whitespace, strip punctuation.
 *
 * The reason `find_duplicates` catches `PT. Sumber Jaya` and `pt sumber jaya`, which is the case people
 * actually have in their files. Punctuation is **removed** rather than replaced with a space, so
 * `0812-1000-0002` folds to `081210000002` and matches the same number written without the hyphens.
 *
 * ## What is kept, and why it is not `[a-z0-9 ]`
 *
 * The naive strip is `replace(/[^a-z0-9 ]/g, '')`, and on a Javanese, Arabic or Han name it deletes every
 * character and returns the empty string — after which that name matches every other such name at
 * similarity 1. A false duplicate, on exactly the records least likely to be checked by hand. So the class
 * is `\p{L}` and `\p{N}`: letters and digits of every script survive, punctuation and symbols do not.
 *
 * Digits are left alone for the same reason in reverse. Folding them — to a placeholder, or by stripping
 * them — makes `0812` and `0813` identical, and a phone column is where duplicates matter most.
 *
 * `normalize('NFC')` before lowercasing is what the note about `localeCompare`-safe folding was after: `é`
 * written as one code point and `é` written as `e` + U+0301 are the same letter to the person who typed it
 * and two different strings to `===`. Composing first makes them fold identically. Diacritics are otherwise
 * preserved — stripping combining marks would fold `José` and `Jose` together, but it would also strip the
 * vowel signs that carry the sound in Devanagari and Thai, which changes the word rather than normalising
 * it. Levenshtein is the part of this that is allowed to be fuzzy.
 *
 * `toLowerCase` rather than `toLocaleLowerCase`: the locale-aware form maps `I` to `ı` under a Turkish
 * locale, so the same file would fold differently on two machines and produce two different duplicate lists.
 */
export function fold(value: string): string {
  const normalised = value.normalize('NFC').toLowerCase()

  let kept = ''
  for (const character of normalised) {
    if (KEEPABLE.test(character)) kept += character
    else if (/\s/.test(character)) kept += ' '
  }

  return kept.replace(WHITESPACE_RUN, ' ').trim()
}
