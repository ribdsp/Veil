import type { NamedFormat, TransformSpec } from '@/types/domain'

import { classify, dateParts, isPlaceholder, isRealDate, matchesFormat } from '@/lib/data/patterns'

/**
 * The closed set of cleaning operations.
 *
 * Owner: Riko. Required reading: CONTRIBUTING.md rule 2.
 *
 * Ten kinds, each a hand-written function. The model picks one and supplies arguments; it never supplies
 * behaviour. There is no `custom` kind, no expression field, and no path from a model string to executable
 * code — `no-eval.test.ts` fails the build on `eval`, `new Function`, or a `RegExp` built from a variable.
 *
 * A `custom` transform would be by far the most requested feature here, and it is the one thing that cannot
 * be added. Everything else in Veil is a policy decision that could reasonably go the other way; this is the
 * one that holds the whole structure up.
 *
 * ## The rule every function in this file follows
 *
 * When in doubt, **fail the row**. A failed row is named in `failedRowIds`, shown to a human, and fixed by
 * hand. A guessed row is a plausible file with wrong data in it and no error anywhere, which is the only
 * outcome here with no recovery path — nobody re-checks a column that reported success.
 */

export type TransformFn = (value: string) => { value: string; changed: boolean; failed: boolean }

type Outcome = ReturnType<TransformFn>

/** Redaction glyph for `maskColumn`. ASCII, so it survives every export the human might make. */
const MASK_GLYPH = '*'

/** Characters `normalisePhone` discards before looking at what is left. */
const PHONE_NOISE = /[\s()./-]/g

const KEPT_DIGITS = 4

function unchanged(value: string): Outcome {
  return { value, changed: false, failed: false }
}

function failed(value: string): Outcome {
  return { value, changed: false, failed: true }
}

/** `changed` is computed, never asserted: a transform that writes the same string did not change anything. */
function rewritten(original: string, next: string): Outcome {
  return { value: next, changed: next !== original, failed: false }
}

/**
 * Build the function for a spec.
 *
 * An exhaustive `switch` over `TransformSpec['kind']` with **no `default` branch**, so adding a kind to
 * `domain.ts` fails to compile here — which is exactly the reminder you want, in exactly the file that has to
 * handle it.
 *
 * The three-way return is deliberate. `changed` and `failed` are different outcomes and collapsing them is
 * what makes a transform report lie:
 *
 *   - unchanged: the value was already correct. Fine, and common.
 *   - changed: the value was rewritten.
 *   - failed: the transform did not apply — `normaliseDate` on `not a date`. The value is left alone and the
 *     row is reported as needing a human.
 *
 * A report that counts failures as unchanged tells the human "8,000 rows were already fine" when 200 of them
 * are unreadable, and they will approve it.
 *
 * Blank cells are `unchanged` everywhere rather than `failed`. There is nothing to normalise in an empty
 * cell, and a report claiming 12,000 failures on a half-empty column buries the 40 that are real.
 */
export function buildTransform(spec: TransformSpec): TransformFn {
  switch (spec.kind) {
    case 'trimWhitespace':
      return (value) => (value.trim() === value ? unchanged(value) : rewritten(value, value.trim()))

    case 'collapseSpaces':
      // Runs of whitespace become one space. Deliberately does not trim: `trimWhitespace` is a separate
      // transform, and a human who approved "collapse the double spaces" did not approve losing the
      // leading space that a fixed-width export may depend on.
      return (value) => rewritten(value, value.replace(/\s+/g, ' '))

    case 'changeCase':
      return (value) => (value.trim() === '' ? unchanged(value) : rewritten(value, recase(value, spec.to)))

    case 'normaliseDate':
      return (value) => (value.trim() === '' ? unchanged(value) : normaliseDate(value, spec.to))

    case 'normalisePhone':
      return (value) =>
        value.trim() === '' ? unchanged(value) : normalisePhone(value, spec.defaultCountryCode)

    case 'normaliseNumber':
      return (value) => (value.trim() === '' ? unchanged(value) : normaliseNumber(value, spec.to))

    case 'padLeft':
      return (value) => padLeft(value, spec.length, spec.with)

    case 'replacePlaceholderWithEmpty':
      // The list lives in `lib/data/patterns.ts`, shared with the `placeholderValue` finding. A value the
      // profile calls a placeholder that this transform then leaves alone is a report nobody can act on.
      return (value) => (isPlaceholder(value) ? rewritten(value, '') : unchanged(value))

    case 'dropColumn':
      // Every targeted row loses a cell, so every targeted row is a change. `apply-transform.ts` removes the
      // column itself on commit; this function is what makes the counts and the preview honest.
      return () => ({ value: '', changed: true, failed: false })

    case 'maskColumn':
      return (value) => (value.trim() === '' ? unchanged(value) : maskValue(value, spec.keep))
  }
}

/**
 * Change case without destroying the values that have no case.
 *
 * Title case capitalises the first *letter* of each word rather than its first character, so `(ani)` and
 * `"budi"` come out right. Caseless scripts pass through whatever `toLowerCase`/`toUpperCase` do with them,
 * which is nothing — and `find_issues` is what tells the agent the column is non-Latin before it proposes
 * this at all.
 */
function recase(value: string, to: 'lower' | 'upper' | 'title'): string {
  if (to === 'lower') return value.toLowerCase()
  if (to === 'upper') return value.toUpperCase()

  return value
    .split(/(\s+)/)
    .map((word) => titleCaseWord(word))
    .join('')
}

function titleCaseWord(word: string): string {
  let capitalised = false
  let result = ''

  for (const character of word.toLowerCase()) {
    if (!capitalised && character.toLowerCase() !== character.toUpperCase()) {
      result += character.toUpperCase()
      capitalised = true
      continue
    }
    result += character
  }

  return result
}

/**
 * Normalise a date into a target layout.
 *
 * No `new Date(string)` anywhere in here. `Date` parsing of non-ISO strings is implementation-defined, and in
 * practice `new Date('01/02/2026')` is 1 February in one engine and 2 January in another. Silently reordering
 * somebody's dates by 30 days, differently per browser, is the worst possible transform bug: it produces a
 * plausible file with wrong data and no error anywhere. The recogniser names the field order; `dateParts`
 * reads the fields; this function writes them out.
 *
 * Three failure paths, and all three are refusals to guess:
 *
 *   - **Not a date.** `N/A`, `unknown`, a name. Nothing to reorder.
 *   - **Not a real day.** `31/02/2026` passes the recogniser and does not exist. Which of the two fields is
 *     wrong is not knowable from the cell.
 *   - **Ambiguous.** `03/04/2026` matches both `dateDmySlash` and `dateMdySlash`, and there is no evidence in
 *     the cell for either. `find_issues` raises the ambiguity and `ask_human` settles it once for the whole
 *     column; a transform that guesses removes the human from the only decision they were needed for.
 *
 * `timestampIso` from a date-only value appends `T00:00:00`, which is the one thing in this file that invents
 * information. It is why `dateIso` is the target worth proposing unless the column already has times in it.
 */
export function normaliseDate(value: string, to: NamedFormat): Outcome {
  const format = classify(value)
  const parts = dateParts(value, format)
  if (parts === null) return failed(value)
  if (!isRealDate(parts)) return failed(value)

  if (format === 'dateDmySlash' && matchesFormat(value, 'dateMdySlash')) return failed(value)
  if (format === 'dateMdySlash' && matchesFormat(value, 'dateDmySlash')) return failed(value)

  const iso = `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`
  if (to === 'dateIso') return rewritten(value, iso)

  if (to === 'timestampIso') {
    // Whatever followed the date separator, verbatim: seconds, fractions and the offset are all information
    // the source had and we have no business dropping.
    const time = value.trim().split(/[T ]/)[1] ?? ''
    return rewritten(value, `${iso}T${time === '' ? '00:00:00' : time}`)
  }

  return failed(value)
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/**
 * Normalise a phone number to E.164.
 *
 * Strips spaces, hyphens, dots and parentheses, then reads what is left:
 *
 *   `+62812…` → already international, kept.
 *   `0062812…` → the `00` international prefix, rewritten to `+`.
 *   `0812…`   → a local number, the leading `0` replaced by the country code.
 *   `812…`    → the same number after a spreadsheet decided it was a number and ate the zero.
 *
 * Anything else fails rather than being prefixed hopefully. A number that is not recognisable is a row for a
 * human, not a row to guess at.
 *
 * `defaultCountryCode` is a spec field rather than a hardcoded `+62`, because the hardcoded version turns a
 * French number in the file into `+620…` — wrong, and looks right, which is the worst combination. The caller
 * supplies it; the tool layer defaults it to `+62` and says so in the proposal the human approves.
 */
export function normalisePhone(value: string, defaultCountryCode = '+62'): Outcome {
  const code = defaultCountryCode.startsWith('+') ? defaultCountryCode : `+${defaultCountryCode}`
  if (!/^\+\d{1,4}$/.test(code)) return failed(value)

  const digits = value.trim().replace(PHONE_NOISE, '')

  const candidate = (() => {
    if (digits.startsWith('+')) return digits
    if (digits.startsWith('00')) return `+${digits.slice(2)}`
    if (digits.startsWith('0')) return `${code}${digits.slice(1)}`
    if (/^[1-9]\d{7,12}$/.test(digits)) return `${code}${digits}`
    return null
  })()

  if (candidate === null) return failed(value)
  // Validated against the same recogniser the profile reports, so a "successful" normalisation cannot
  // produce a value that `sample_shapes` then calls unrecognised.
  if (!matchesFormat(candidate, 'phoneE164')) return failed(value)

  return rewritten(value, candidate)
}

/**
 * Parse a number written in any of the layouts a spreadsheet export produces, and write it out plainly.
 *
 * The separators are decided by the recognised format, not guessed from the string: `decimalComma`
 * (`1.234,56`) has its dots removed and its comma promoted, `decimalPoint` (`1,234.56`) has its commas
 * removed. `parseFloat('1.234,56')` is 1.234 — not an error, just wrong by a factor of a thousand, in a
 * column of amounts.
 *
 * Done as string surgery rather than via `Number`, because a round trip through a float silently rewrites a
 * 19-digit account number and there is no warning when it does.
 *
 * Two refusals:
 *
 *   - **Leading zeros.** `007` is a code, not the number 7. The transform fails the row rather than
 *     destroying it, and `nonNumericInNumericColumn` does not fire on a column of codes in the first place —
 *     see `profile-column.ts`.
 *   - **A fractional part, when the target is `integerPlain`.** `1234.56` could be rounded or truncated and
 *     both are a silent change to somebody's amount. A fraction of zeros is dropped, because `1234.00` and
 *     `1234` are the same number.
 */
export function normaliseNumber(value: string, to: 'decimalPoint' | 'integerPlain' = 'decimalPoint'): Outcome {
  const trimmed = value.trim()
  const format = classify(trimmed)

  const negative = trimmed.startsWith('-')
  const body = negative ? trimmed.slice(1) : trimmed

  const plain = (() => {
    if (format === 'decimalComma') return body.replace(/\./g, '').replace(',', '.')
    if (format === 'decimalPoint') return body.replace(/,/g, '')
    if (format === 'integerPlain') return body.replace(/,/g, '')
    return null
  })()

  if (plain === null) return failed(value)

  const [whole = '', fraction = ''] = plain.split('.')
  if (whole.length > 1 && whole.startsWith('0')) return failed(value)

  if (to === 'integerPlain') {
    if (fraction !== '' && /[1-9]/.test(fraction)) return failed(value)
    return rewritten(value, `${negative ? '-' : ''}${whole}`)
  }

  return rewritten(value, `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`)
}

/**
 * Pad a value on the left to a fixed width.
 *
 * The transform for a column of codes that lost its leading zeros — `padLeft(6, '0')` turns `1234` back into
 * `001234`. Lengths are counted in code points for the same reason as everywhere else.
 *
 * Values already at or above the width are unchanged rather than truncated: this transform adds, and a
 * `padLeft` that shortened a value would be a data loss nobody asked for. A blank cell is left blank —
 * padding an empty cell to `000000` invents a code that was never in the file.
 */
function padLeft(value: string, length: number, fill: string): Outcome {
  if (value.trim() === '') return unchanged(value)
  if (fill.length === 0 || !Number.isInteger(length) || length <= 0) return failed(value)

  const characters = [...value]
  if (characters.length >= length) return unchanged(value)

  const missing = length - characters.length
  const filler = [...fill.repeat(Math.ceil(missing / [...fill].length))].slice(0, missing).join('')

  return rewritten(value, `${filler}${value}`)
}

/**
 * Redact a column in place, keeping as much structure as the human asked to keep.
 *
 * Distinct from `guard/redact.ts`, which masks a value on its way into a *report*. This one edits the file:
 * after it commits, the original is gone from the dataset, and `dropColumn`/`maskColumn` are the two
 * transforms `undo_last` refuses for exactly that reason.
 *
 *   `none`     → every character replaced, length preserved. `081210000001` → `************`
 *   `lastFour` → the last four characters survive. `081210000001` → `********0001`
 *   `domain`   → an email's domain survives. `a.wijaya@example.co.id` → `********@example.co.id`
 *
 * `domain` fails on a value with no `@` rather than falling back to a full mask. The human approved "keep the
 * domain" for a column of email addresses; the rows that are not email addresses are exactly the rows they
 * would want to know about.
 */
function maskValue(value: string, keep: 'none' | 'lastFour' | 'domain'): Outcome {
  const characters = [...value]

  if (keep === 'none') return rewritten(value, MASK_GLYPH.repeat(characters.length))

  if (keep === 'lastFour') {
    if (characters.length <= KEPT_DIGITS) return failed(value)
    const hidden = characters.length - KEPT_DIGITS
    return rewritten(value, `${MASK_GLYPH.repeat(hidden)}${characters.slice(hidden).join('')}`)
  }

  const at = value.lastIndexOf('@')
  if (at <= 0) return failed(value)
  return rewritten(value, `${MASK_GLYPH.repeat([...value.slice(0, at)].length)}${value.slice(at)}`)
}
