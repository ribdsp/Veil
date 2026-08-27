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

/**
 * One recogniser per `NamedFormat`, in match order.
 *
 * TODO(riko), Day 2: fill in the patterns. Notes on the ones that are not obvious:
 *
 *   - `phoneLocalId` — Indonesian local mobile format, `08` followed by 8 to 11 digits, with optional
 *     spaces or hyphens between groups. This is the messy real-world form that `phoneE164` is the clean
 *     version of, and the pair is the demo: "412 rows are phoneLocalId, 88 are phoneE164, normalise them."
 *   - `dateDmySlash` vs `dateMdySlash` — genuinely ambiguous for day ≤ 12, and no recogniser can settle it.
 *     Match both and let `find_issues` raise `ambiguousDateOrder`, which is what `ask_human` exists for.
 *     Do not guess by locale; the file may have come from anywhere.
 *   - `decimalComma` — `1.234,56`. Common in Indonesian and European exports and the single most damaging
 *     format to misread, because `parseFloat('1.234,56')` is 1.234 and the error looks like a valid number.
 *   - `digitsFixedLength` — digits only, no separators, length 5–20. Deliberately vague: it is the bucket
 *     for national ID numbers and account numbers, which we do **not** want to recognise more precisely.
 *     A recogniser named `nationalIdNumber` would be a re-identification tool shipped as a convenience.
 *   - `blank` — matches empty and whitespace-only. Distinct from `unrecognised`: "this cell is empty" and
 *     "I could not classify this cell" lead to different transforms.
 *
 * TODO(riko), Day 2: anchor every pattern with `^` and `$`. An unanchored recogniser matches a substring,
 * so a name containing a date matches `dateIso`, and the format histogram stops meaning anything.
 *
 * TODO(riko), Day 2: keep every pattern linear — no nested quantifiers, no backreferences. These run once
 * per cell per profile call, so 50k rows × 24 recognisers is 1.2M matches on the thread holding the UI. A
 * pattern that is merely slow is a frozen tab, and a frozen tab is a human who cannot answer a reveal
 * request.
 */
export const RECOGNISERS: readonly { format: NamedFormat; test: (value: string) => boolean }[] = [
  // TODO(riko), Day 2: implement in this order — blank, then structured (email, phone, date, timestamp,
  // uuid), then numeric, then shape-of-text (single word, title case, ...), with `unrecognised` implicit as
  // the fallback rather than an entry here.
]

/**
 * Classify one value.
 *
 * TODO(riko), Day 2: implement — first matching recogniser wins, `unrecognised` when none does.
 */
export function classify(_value: string): NamedFormat {
  throw new Error('classify: not implemented')
}

/**
 * Whether a value matches a named format.
 *
 * Not the same question as `classify(value) === format`, and the difference matters. `+6281234567890` is
 * classified `phoneE164`, but it also genuinely *matches* `digitsFixedLength` if that is what the agent
 * asked about. `count_where(matchesFormat)` uses this; the profile histogram uses `classify`, because a
 * histogram whose buckets overlap does not sum to the row count.
 *
 * TODO(riko), Day 2: implement.
 */
export function matchesFormat(_value: string, _format: NamedFormat): boolean {
  throw new Error('matchesFormat: not implemented')
}

/**
 * Formats a model may name, for the error message when it names something else.
 *
 * TODO(riko), Day 2: derive from `RECOGNISERS` rather than hand-listing, so the list in the error message
 * cannot drift from the list that is actually accepted. A rejection that names a format the parser does not
 * support costs the agent another question to discover the lie.
 */
export function knownFormats(): readonly NamedFormat[] {
  throw new Error('knownFormats: not implemented')
}
