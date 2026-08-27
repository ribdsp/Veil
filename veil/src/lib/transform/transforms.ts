import type { NamedFormat, TransformSpec } from '@/types/domain'

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
 */

export type TransformFn = (value: string) => { value: string; changed: boolean; failed: boolean }

/**
 * Build the function for a spec.
 *
 * TODO(riko), Day 5: implement with an exhaustive `switch` over `TransformSpec['kind']` and **no `default`
 * branch**. Without a default, adding a kind to `domain.ts` fails to compile here — which is exactly the
 * reminder you want, in exactly the file that has to handle it.
 *
 * TODO(riko), Day 5: the three-way return is deliberate. `changed` and `failed` are different outcomes and
 * collapsing them is what makes a transform report lie:
 *   - unchanged: the value was already correct. Fine, and common.
 *   - changed: the value was rewritten.
 *   - failed: the transform did not apply — `normaliseDate` on `not a date`. The value is left alone and the
 *     row is reported as needing a human.
 * A report that counts failures as unchanged tells the human "8,000 rows were already fine" when 200 of them
 * are unreadable, and they will approve it.
 */
export function buildTransform(_spec: TransformSpec): TransformFn {
  throw new Error('buildTransform: not implemented')
}

/**
 * Normalise a date into a target layout.
 *
 * TODO(riko), Day 5: implement without `new Date(string)`. `Date` parsing of non-ISO strings is
 * implementation-defined, and in practice `new Date('01/02/2026')` is 1 February in one engine and 2 January
 * in another. Silently reordering somebody's dates by 30 days, differently per browser, is the worst possible
 * transform bug: it produces a plausible file with wrong data and no error anywhere.
 *
 * Parse with the recognisers in `lib/data/patterns.ts` — the format tells you the field order — then format
 * the components directly.
 *
 * TODO(riko), Day 5: `fail`, do not guess, when the recognised format is ambiguous (`dateDmySlash` and
 * `dateMdySlash` both match and the day is ≤ 12). `find_issues` raises `ambiguousDateOrder` and `ask_human`
 * settles it; a transform that guesses removes the human from the only decision they were needed for.
 */
export function normaliseDate(_value: string, _to: NamedFormat): ReturnType<TransformFn> {
  throw new Error('normaliseDate: not implemented')
}

/**
 * Normalise a phone number to E.164.
 *
 * TODO(riko), Day 5: implement for Indonesian numbers: strip spaces, hyphens and parentheses, convert a
 * leading `0` to `+62`, accept an existing `+62`, and **fail** on anything else rather than prefixing hopefully.
 * A number that is not recognisable is a row for a human, not a row to guess at.
 *
 * TODO(riko), Day 6: the country assumption is hardcoded and should be a spec field with `+62` as the
 * default. Right now a French number in the file becomes `+620...`, which is wrong and looks right — the
 * worst combination. Worth doing before anyone uses this on a file they care about.
 */
export function normalisePhone(_value: string): ReturnType<TransformFn> {
  throw new Error('normalisePhone: not implemented')
}

/**
 * Parse a number written in any of the layouts a spreadsheet export produces.
 *
 * TODO(riko), Day 5: implement, handling `decimalComma` (`1.234,56`) explicitly. `parseFloat('1.234,56')` is
 * 1.234 — not an error, just wrong by a factor of a thousand, in a column of amounts. Use the recognised
 * format to decide which separator is which rather than guessing from the string.
 *
 * TODO(riko), Day 5: preserve leading zeros by failing on values that have them. `007` is a code, not the
 * number 7, and `numberStoredAsText` must not fire on a column of codes — check for leading zeros before
 * proposing the transform at all.
 */
export function normaliseNumber(_value: string): ReturnType<TransformFn> {
  throw new Error('normaliseNumber: not implemented')
}
