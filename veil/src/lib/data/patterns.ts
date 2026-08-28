import type { NamedFormat } from '@/types/domain'

/**
 * The closed vocabulary of formats Veil can recognise.
 *
 * Owner: Riko. Required reading: docs/privacy-guard.md § Predicate limits.
 *
 * This file is the alternative to accepting a regex from the model, and that is the reason it exists rather
 * than a two-line `new RegExp(pattern)`. Adding a format here is a two-line PR and is the correct way to
 * extend matching. Accepting a pattern from a model is not, however carefully it is validated — the
 * vulnerability is the arbitrary granularity, not the regex engine.
 *
 * Every pattern below is a **literal** written by us. `no-eval.test.ts` fails the build on
 * `new RegExp(variable)` anywhere in `src/`.
 *
 * ## Ordering matters
 *
 * A value is tested against recognisers in order and gets the first match, so specific formats must come
 * before general ones. `+6281234567890` matches `phoneE164` and also `digitsFixedLength` if you strip the
 * `+`; the first is the useful answer. `unrecognised` is the terminal fallback and is the most interesting
 * bucket in practice — it is what the agent asks about.
 */

/* -------------------------------------------------------------------------------------------------
 * Pattern literals
 *
 * Anchored with `^` and `$`, every one of them. An unanchored recogniser matches a substring, so a name
 * containing a date matches `dateIso` and the format histogram stops meaning anything.
 *
 * Linear, every one of them: no nested quantifiers, no backreferences. These run once per cell per profile
 * call, so 50k rows × 24 recognisers is 1.2M matches on the thread holding the UI. A pattern that is merely
 * slow is a frozen tab, and a frozen tab is a human who cannot answer a reveal request. Where an
 * alternation appears — `(?:\d+|\d{1,3}(?:[.,]\d{3})+)` — the branches are mutually exclusive after the
 * first separator, so the engine backtracks once and not exponentially.
 * ---------------------------------------------------------------------------------------------- */

const BLANK = /^\s*$/

/** Local part, `@`, then at least two dot-separated labels. The classes exclude `@` and `.`, so linear. */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `2026-08-27T14:30`, with optional seconds, fraction and zone. */
const TIMESTAMP_ISO =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[T ][01]\d:[0-5]\d(?::[0-5]\d)?(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?$/i

const DATE_ISO = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/

const DATE_DMY_SLASH = /^(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/\d{4}$/
const DATE_MDY_SLASH = /^(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4}$/
const DATE_DMY_DOT = /^(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.\d{4}$/

/**
 * `27 Aug 2026`, `27 Agustus 2026`, `27-Des-2026`.
 *
 * English and Indonesian month names, matched on the first three letters plus whatever follows, because a
 * file exported in Indonesia routinely says `Agustus` and a recogniser that only speaks English reports it
 * as unrecognised — which sends the agent looking for garbage instead of for a date layout.
 */
const DATE_TEXTUAL_MONTH =
  /^\d{1,2}[ -](?:jan|feb|mar|apr|may|mei|jun|jul|aug|agu|agt|sep|oct|okt|nov|nop|dec|des)[a-z]*[ -]\d{4}$/i

const PHONE_E164 = /^\+[1-9]\d{6,14}$/
/** `08` then 8–11 more digits, in groups optionally separated by a space or hyphen. */
const PHONE_LOCAL_ID = /^08\d{1,2}[ -]?\d{3,4}[ -]?\d{4,5}$/
/** The same number with the leading zero dropped by a spreadsheet that decided it was a number. */
const PHONE_DIGITS_ONLY = /^8\d{9,12}$/

const CURRENCY_PREFIXED =
  /^(?:rp|idr|usd|\$|€|£)\s*-?(?:\d+|\d{1,3}(?:[.,]\d{3})+)(?:[.,]\d{1,2})?$/i
const PERCENT_SUFFIXED = /^-?\d+(?:[.,]\d+)?\s*%$/

/** `1234.56` and `1,234.56`. */
const DECIMAL_POINT = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d+$/
/** `1234,56` and `1.234,56` — the one that `parseFloat` reads as 1.234 without complaining. */
const DECIMAL_COMMA = /^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/

const INTEGER_PLAIN = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/
const DIGITS_FIXED_LENGTH = /^\d{5,20}$/

/** `INV-2026-001`, `AB/1234`. Segments of letters and digits joined by `-`, `_`, `/` or `.`. */
const ALPHANUMERIC_SEGMENTS = /^[A-Za-z0-9]+(?:[-_/.][A-Za-z0-9]+)*$/

const ANY_LETTER = /\p{L}/u
const ANY_DIGIT = /\d/
const ANY_UPPER = /\p{Lu}/u
const ANY_LOWER = /\p{Ll}/u
const NO_WHITESPACE = /^\S+$/
const HAS_WHITESPACE = /\s/

/**
 * A code rather than a number or a word: contains both a letter and a digit.
 *
 * The letter-and-digit requirement is what keeps `MATARAM` out of this bucket and in `upperCase`, where a
 * case transform can find it.
 */
function isAlphanumericCode(value: string): boolean {
  return ALPHANUMERIC_SEGMENTS.test(value) && ANY_LETTER.test(value) && ANY_DIGIT.test(value)
}

/**
 * Every word starts with an uppercase letter and continues in lowercase.
 *
 * Written as a loop rather than a pattern because "the first letter of the word" is not the first character
 * of the word — `(Ani)` and `"Budi"` are title-cased in every sense a human means it. Caseless scripts have
 * no uppercase form of a letter, so a Han or Arabic word is not reported as title case; it falls through to
 * `singleWord`, and `guard/redact.ts` is what tells the agent the column is non-Latin.
 */
function isTitleCasedWord(word: string): boolean {
  let seenLetter = false
  for (const character of word) {
    if (!ANY_LETTER.test(character)) continue
    if (!seenLetter) {
      seenLetter = true
      if (character.toLowerCase() === character.toUpperCase()) continue
      if (character !== character.toUpperCase()) return false
      continue
    }
    if (character !== character.toLowerCase()) return false
  }
  return seenLetter
}

function isTitleCase(value: string): boolean {
  const words = value.split(/\s+/).filter((word) => word.length > 0)
  if (words.length === 0) return false
  return words.every((word) => isTitleCasedWord(word))
}

/**
 * One recogniser per `NamedFormat`, in match order.
 *
 * Notes on the ones that are not obvious:
 *
 *   - `phoneLocalId` — Indonesian local mobile format, `08` followed by 8 to 11 digits, with optional
 *     spaces or hyphens between groups. This is the messy real-world form that `phoneE164` is the clean
 *     version of, and the pair is the demo: "412 rows are phoneLocalId, 88 are phoneE164, normalise them."
 *   - `dateDmySlash` vs `dateMdySlash` — genuinely ambiguous for day ≤ 12, and no recogniser can settle it.
 *     Both are listed and `dateDmySlash` is first, so an ambiguous value lands in one bucket rather than
 *     being split across two by accident; `find_issues` raises the ambiguity, which is what `ask_human`
 *     exists for. Do not guess by locale; the file may have come from anywhere.
 *   - `decimalComma` — `1.234,56`. Common in Indonesian and European exports and the single most damaging
 *     format to misread, because `parseFloat('1.234,56')` is 1.234 and the error looks like a valid number.
 *   - `digitsFixedLength` — digits only, no separators, length 5–20. Deliberately vague: it is the bucket
 *     for national ID numbers and account numbers, which we do **not** want to recognise more precisely.
 *     A recogniser named `nationalIdNumber` would be a re-identification tool shipped as a convenience.
 *     It sits *before* `integerPlain` on purpose: an identifier classified as a number invites
 *     `normaliseNumber`, which is the transform that turns `007` into `7` and destroys a code.
 *   - `blank` — matches empty and whitespace-only. Distinct from `unrecognised`: "this cell is empty" and
 *     "I could not classify this cell" lead to different transforms.
 */
export const RECOGNISERS: readonly { format: NamedFormat; test: (value: string) => boolean }[] = [
  // Empty first: nothing below should have to think about the empty string.
  { format: 'blank', test: (value) => BLANK.test(value) },

  // Structured — a value that matches one of these has a shape no other format explains as well.
  { format: 'emailAddress', test: (value) => EMAIL.test(value) },
  { format: 'uuid', test: (value) => UUID.test(value) },
  { format: 'timestampIso', test: (value) => TIMESTAMP_ISO.test(value) },
  { format: 'dateIso', test: (value) => DATE_ISO.test(value) },
  { format: 'dateDmySlash', test: (value) => DATE_DMY_SLASH.test(value) },
  { format: 'dateMdySlash', test: (value) => DATE_MDY_SLASH.test(value) },
  { format: 'dateDmyDot', test: (value) => DATE_DMY_DOT.test(value) },
  { format: 'dateTextualMonth', test: (value) => DATE_TEXTUAL_MONTH.test(value) },
  { format: 'phoneE164', test: (value) => PHONE_E164.test(value) },
  { format: 'phoneLocalId', test: (value) => PHONE_LOCAL_ID.test(value) },
  { format: 'phoneDigitsOnly', test: (value) => PHONE_DIGITS_ONLY.test(value) },

  // Numeric.
  { format: 'currencyPrefixed', test: (value) => CURRENCY_PREFIXED.test(value) },
  { format: 'percentSuffixed', test: (value) => PERCENT_SUFFIXED.test(value) },
  { format: 'decimalPoint', test: (value) => DECIMAL_POINT.test(value) },
  { format: 'decimalComma', test: (value) => DECIMAL_COMMA.test(value) },
  { format: 'digitsFixedLength', test: (value) => DIGITS_FIXED_LENGTH.test(value) },
  { format: 'integerPlain', test: (value) => INTEGER_PLAIN.test(value) },

  // Codes, then the shape of text. `unrecognised` is implicit: it is what `classify` returns when nothing
  // here matches, so it has no entry and cannot be tested for directly.
  { format: 'alphanumericCode', test: isAlphanumericCode },
  { format: 'upperCase', test: (value) => ANY_UPPER.test(value) && !ANY_LOWER.test(value) },
  { format: 'lowerCase', test: (value) => ANY_LOWER.test(value) && !ANY_UPPER.test(value) },
  { format: 'titleCase', test: isTitleCase },
  {
    format: 'singleWord',
    test: (value) => NO_WHITESPACE.test(value) && ANY_LETTER.test(value),
  },
  {
    format: 'multipleWords',
    test: (value) => HAS_WHITESPACE.test(value.trim()) && ANY_LETTER.test(value),
  },
]

/** Lookup for `matchesFormat`, built once. Order-independent, unlike `RECOGNISERS` itself. */
const BY_FORMAT: ReadonlyMap<NamedFormat, (value: string) => boolean> = new Map(
  RECOGNISERS.map((recogniser) => [recogniser.format, recogniser.test]),
)

/** Classify one value: the first matching recogniser wins, `unrecognised` when none does. */
export function classify(value: string): NamedFormat {
  for (const recogniser of RECOGNISERS) {
    if (recogniser.test(value)) return recogniser.format
  }
  return 'unrecognised'
}

/**
 * Whether a value matches a named format.
 *
 * Not the same question as `classify(value) === format`, and the difference matters. `+6281234567890` is
 * classified `phoneE164`, but it also genuinely *matches* `digitsFixedLength` if that is what the agent
 * asked about. `count_where(matchesFormat)` uses this; the profile histogram uses `classify`, because a
 * histogram whose buckets overlap does not sum to the row count.
 *
 * `unrecognised` is the one format that can only be answered by classifying, since it is defined as the
 * absence of every other match.
 */
export function matchesFormat(value: string, format: NamedFormat): boolean {
  if (format === 'unrecognised') return classify(value) === 'unrecognised'
  const test = BY_FORMAT.get(format)
  return test === undefined ? false : test(value)
}

/* -------------------------------------------------------------------------------------------------
 * Reading a date, once
 *
 * Two callers need to take a date apart: `profile-column.ts`, to find the impossible and the
 * future-dated ones, and `transform/transforms.ts`, to rewrite them. Written here because this is the file
 * that knows what each date format means, and a second parser elsewhere is a second set of opinions about
 * whether `03/04/2026` is April or March.
 * ---------------------------------------------------------------------------------------------- */

export type DateParts = { readonly year: number; readonly month: number; readonly day: number }

/**
 * Month names as written in the files this tool sees: English and Indonesian, first three letters.
 *
 * `mar` is March and Maret, `mei` is May, `agu`/`agt` are Agustus, `okt` Oktober, `nop` November, `des`
 * Desember. Matching on a prefix rather than the whole word is what makes `Agustus` and `Aug` the same
 * month without listing every spelling anybody has ever used.
 */
const MONTH_BY_PREFIX: ReadonlyMap<string, number> = new Map([
  ['jan', 1],
  ['feb', 2],
  ['mar', 3],
  ['apr', 4],
  ['may', 5],
  ['mei', 5],
  ['jun', 6],
  ['jul', 7],
  ['aug', 8],
  ['agu', 8],
  ['agt', 8],
  ['sep', 9],
  ['oct', 10],
  ['okt', 10],
  ['nov', 11],
  ['nop', 11],
  ['dec', 12],
  ['des', 12],
])

/** Three whole numbers, or nothing. Anything else is a value the recogniser should not have accepted. */
function threeNumbers(fields: readonly string[]): readonly [number, number, number] | null {
  if (fields.length !== 3) return null
  const [first, second, third] = fields
  if (first === undefined || second === undefined || third === undefined) return null
  const numbers = [Number(first), Number(second), Number(third)] as const
  return numbers.every((value) => Number.isInteger(value)) ? numbers : null
}

/**
 * Take a date apart according to the format it was recognised as.
 *
 * Takes the format rather than classifying, because every caller has already classified the value and
 * because the caller's format is the one whose reading the rest of its report is based on. Returns `null`
 * for any format that is not a date, which is how "this cell is not a date" reaches the caller without a
 * thrown error in the middle of a 50k-row loop.
 *
 * No `Date` constructor anywhere near this. `new Date('31/02/2026')` is `Invalid Date` in one engine and
 * 2 March in another, and `new Date('2026-08-27')` is midnight UTC — which is the 26th for the user whose
 * file this is. Fields in, fields out, no timezone in the middle.
 */
export function dateParts(value: string, format: NamedFormat): DateParts | null {
  const trimmed = value.trim()

  switch (format) {
    case 'dateIso': {
      const fields = threeNumbers(trimmed.split('-'))
      return fields === null ? null : { year: fields[0], month: fields[1], day: fields[2] }
    }
    case 'timestampIso': {
      const datePart = trimmed.split(/[T ]/)[0] ?? ''
      const fields = threeNumbers(datePart.split('-'))
      return fields === null ? null : { year: fields[0], month: fields[1], day: fields[2] }
    }
    case 'dateDmySlash': {
      const fields = threeNumbers(trimmed.split('/'))
      return fields === null ? null : { year: fields[2], month: fields[1], day: fields[0] }
    }
    case 'dateMdySlash': {
      const fields = threeNumbers(trimmed.split('/'))
      return fields === null ? null : { year: fields[2], month: fields[0], day: fields[1] }
    }
    case 'dateDmyDot': {
      const fields = threeNumbers(trimmed.split('.'))
      return fields === null ? null : { year: fields[2], month: fields[1], day: fields[0] }
    }
    case 'dateTextualMonth': {
      const fields = trimmed.split(/[ -]+/)
      const day = Number(fields[0])
      const month = MONTH_BY_PREFIX.get((fields[1] ?? '').slice(0, 3).toLowerCase())
      const year = Number(fields[2])
      if (!Number.isInteger(day) || month === undefined || !Number.isInteger(year)) return null
      return { year, month, day }
    }
    default:
      return null
  }
}

const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Whether these fields name a day that exists.
 *
 * `31/02/2026` passes the recogniser — day 31 and month 02 are both in range on their own — and is caught
 * here. This is the whole reason `impossibleDate` is a finding rather than a parse failure: the file
 * contains it, so Veil has to be able to say so.
 */
export function isRealDate(parts: DateParts): boolean {
  if (parts.month < 1 || parts.month > 12) return false
  if (parts.day < 1) return false
  const monthLength = DAYS_IN_MONTH[parts.month - 1] ?? 0
  const allowed = parts.month === 2 && isLeapYear(parts.year) ? monthLength + 1 : monthLength
  return parts.day <= allowed
}

/**
 * The number a cell holds, or `null` when it does not hold one.
 *
 * The single definition of "this cell is a number" in the codebase: `predicate.ts` uses it for `compare`,
 * `profile-column.ts` for outliers, `transform/transforms.ts` for `normaliseNumber`. Three definitions
 * would mean a column the profile calls numeric and `compare` silently matches nothing in.
 *
 * Two deliberate refusals:
 *
 *   - **No leading `+`.** `+6281234567890` would otherwise read as 6.28 × 10¹², so a phone column would
 *     answer numeric comparisons with real numbers about nobody.
 *   - **Currency and percentages are not numbers here.** `Rp 1.234` and `$1,234` disagree about which
 *     separator is the decimal one, and picking wrong is an error of a factor of a thousand that looks
 *     like an answer. `normaliseNumber` is the tool for that column, and it asks first.
 *
 * `1.234` remains genuinely ambiguous — 1234 under the Indonesian convention, 1.234 under the English one —
 * and is read as 1.234, matching `decimalPoint`. Nothing in a single cell can settle it; `find_issues`
 * raises the mixed-format column and the human decides.
 */
export function numericValue(value: string): number | null {
  const trimmed = value.trim()

  if (DECIMAL_COMMA.test(trimmed)) {
    return finite(Number(trimmed.replace(/\./g, '').replace(',', '.')))
  }
  if (DECIMAL_POINT.test(trimmed) || INTEGER_PLAIN.test(trimmed)) {
    return finite(Number(trimmed.replace(/,/g, '')))
  }
  return null
}

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

/**
 * Formats a model may name, for the error message when it names something else.
 *
 * Derived from `RECOGNISERS` rather than hand-listed, so the list in the error message cannot drift from
 * the list that is actually accepted. A rejection that names a format the parser does not support costs the
 * agent another question to discover the lie. `unrecognised` is appended because it is answerable — "how
 * many cells in this column match nothing I know" is a legitimate and frequently useful question.
 */
export function knownFormats(): readonly NamedFormat[] {
  return [...RECOGNISERS.map((recogniser) => recogniser.format), 'unrecognised']
}

/**
 * The conventions a spreadsheet uses to write "nothing here".
 *
 * One list, because `profile-column.ts` reports these as `placeholderValue` and
 * `transform/transforms.ts` replaces them — and a value the profile calls a placeholder that the transform
 * then leaves alone is a report the human cannot act on.
 *
 * `0000-00-00` is on the list because MySQL exports write it, and because it is the one placeholder that also
 * looks like a date: left alone it sorts between 1899 and 1970 in whatever tool opens the file next.
 */
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  'n/a',
  'n.a.',
  '-',
  '--',
  'null',
  'nil',
  'none',
  '#n/a',
  '#value!',
  'tbd',
  'tba',
  '?',
  '??',
  '0000-00-00',
])

/**
 * Whether a cell is one of the conventions for "nothing here".
 *
 * Trimmed and case-folded, so `N/A` and `n/a ` are the same finding. Blank is deliberately **not** a
 * placeholder: an empty cell is already `emptyCount`, and counting it twice makes the two numbers in the
 * profile add up to more than the column.
 */
export function isPlaceholder(value: string): boolean {
  const trimmed = value.trim()
  return trimmed !== '' && PLACEHOLDERS.has(trimmed.toLowerCase())
}
