import type { Column, Condition, NamedFormat, Query, RefusalCode } from '@/types/domain'

import { MAX_CONDITIONS } from './guard'

/**
 * Parse and validate a predicate that arrived from a model.
 *
 * Owner: Riko. Required reading: docs/privacy-guard.md § Predicate limits.
 *
 * Two jobs, in this order, and the order is the point:
 *
 *  1. **Validate.** Arity, known columns, closed format enum, well-formed condition objects. Runs before a
 *     single row is read, so a predicate specific enough to describe one human being is rejected rather
 *     than evaluated-then-suppressed.
 *  2. **Evaluate.** Turn a validated `Query` into a row-id set.
 *
 * ## Nothing from the model is executed, ever
 *
 * There is no `pattern` field, no `expression` field, and no path from a model string to `new RegExp`,
 * `eval`, or `new Function`. `no-eval.test.ts` greps `src/` and fails the build if the last two appear.
 *
 * The reason is not that regexes are hard to sanitise. It is that arbitrary granularity is itself the
 * vulnerability: `^0812(\d)` → `^08121(\d)` → `^081213(\d)` extracts a phone number one digit at a time
 * through counts that are every one of them above the suppression threshold. k-anonymity cannot see it.
 * A hostile pattern is also a denial of service against the tab holding the user's only copy of their data.
 *
 * So matching is a closed `NamedFormat` enum, recognised by hand-written functions in
 * `lib/data/patterns.ts`. Adding a format is a two-line PR and is the right way to extend this.
 */

export type ParseResult =
  | { ok: true; query: Query }
  | { ok: false; code: RefusalCode; reason: string }

/**
 * Turn raw tool arguments into a `Query`, or say exactly why not.
 *
 * Takes the column list so an unknown column can be reported *with the available names*. A bare "unknown
 * column" costs the agent a question to rediscover something we already knew.
 *
 * TODO(riko), Day 2: implement. Every rejection carries a `RefusalCode` and a sentence a model can act on:
 *   - more than MAX_CONDITIONS      → `tooManyConditions`, and say how many are allowed
 *   - zero conditions               → `tooManyConditions` with a reason naming the minimum (a predicate
 *                                     matching every row is a row count, which describe_dataset gives free)
 *   - a column not in `columns`     → `unknownColumn`, listing the real names
 *   - a format not in NamedFormat   → `unknownFormat`, listing the valid ones — this is the branch a model
 *                                     hits when it tries to pass a regex, so the message has to teach
 *   - `join` neither all nor any    → `tooManyConditions` is wrong here; return a plain argument error
 *   - a nested condition object     → reject. Flat, not a tree: deciding whether a *tree* is too specific
 *                                     is open-ended, and a subtly wrong check is worse than a crude exact
 *                                     one. Counting to three cannot be subtly wrong
 */
export function parseQuery(_raw: unknown, _columns: readonly Column[]): ParseResult {
  throw new Error(`parseQuery: not implemented (max ${MAX_CONDITIONS} conditions)`)
}

/**
 * Which columns a query touches — what the budget charges.
 *
 * TODO(riko), Day 2: implement. De-duplicate: `lengthBetween(name, 1, 3) AND isEmpty(name)` is one question
 * about one column, and charging it twice punishes a precise predicate. An agent punished for precision
 * asks two vaguer questions instead, which discloses more.
 */
export function columnsInQuery(_query: Query): readonly string[] {
  throw new Error('columnsInQuery: not implemented')
}

/**
 * Evaluate a validated query against the rows.
 *
 * Returns row ids, not values, and that signature is load-bearing: it is what lets `find_issues` be useful
 * without being a read. Callers inside `lib/guard` may hold row ids freely; nothing in `lib/webmcp/tools`
 * may turn one into a cell.
 *
 * TODO(riko), Day 3: implement. Evaluate `all` and `any` in one pass rather than intersecting per-condition
 * sets — a 50k-row file scanned three times is three times the main-thread block, and this runs on the
 * thread holding the UI.
 *
 * TODO(riko), Day 3: `compare` needs a number, and the cell is a string. Parse per cell and treat an
 * unparseable value as *not matching* rather than as zero. Zero is a value that will sit inside somebody's
 * `<` predicate and silently join their group.
 */
export function evaluate(
  _query: Query,
  _rows: readonly (readonly string[])[],
  _columns: readonly Column[],
): readonly number[] {
  throw new Error('evaluate: not implemented')
}

/**
 * Whether a single condition holds for a single cell.
 *
 * Split out because it is the one function here small enough to reason about exhaustively, and because
 * `evaluate` gets long. Exported for the tests only.
 *
 * TODO(riko), Day 3: implement, with an exhaustive switch over `Condition['kind']` and no `default` branch —
 * that way adding a condition kind to `domain.ts` fails to compile here, which is the correct place to be
 * reminded.
 */
export function conditionHolds(
  _condition: Condition,
  _cell: string,
  _matchesFormat: (value: string, format: NamedFormat) => boolean,
): boolean {
  throw new Error('conditionHolds: not implemented')
}
