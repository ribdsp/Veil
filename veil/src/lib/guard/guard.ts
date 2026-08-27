import type {
  AggregateResult,
  AggregateSpec,
  ColumnId,
  ColumnProfile,
  CrosstabResult,
  DatasetSummary,
  DuplicatePair,
  FormatBucket,
  GuardHandle,
  Issue,
  Query,
  RowId,
  TransformReport,
  TransformSpec,
  Verdict,
} from '@/types/domain'

/**
 * The chokepoint.
 *
 * Owner: Riko. Required reading: docs/privacy-guard.md. Architecture: docs/architecture.md.
 *
 * Every question about the data goes through here, and every answer comes back as a `Verdict` — either an
 * answer or a refusal, never both. That is the entire security model, and it is enforced three ways,
 * because one way is never enough:
 *
 *  1. **The type.** `Verdict<T>` has no variant carrying a value *and* a refusal, so `verdict.value` does
 *     not compile until `status` has been narrowed. A tool cannot accidentally format a suppressed answer
 *     as a number.
 *  2. **The module boundary.** The raw cell accessor is private to `lib/data`. Nothing here re-exports it.
 *  3. **A grep.** `no-leak.test.ts` reads every file in `lib/webmcp/tools/` and fails the build if one
 *     reaches past this module. TypeScript cannot express "this module may not import that symbol", so
 *     the check is crude and exact rather than elegant and partial.
 *
 * ## Two decisions, not one
 *
 * Each method below makes two separate decisions, in order, and collapsing them is the classic way to
 * build a guard with a hole in it:
 *
 *  - **Was this a legitimate question?** Predicate arity, known columns, closed format enum, budget
 *    remaining. Rejected *before* a single row is read.
 *  - **Is this a legitimate answer?** k-suppression on the computed result.
 *
 * A question can be perfectly formed and still produce an answer that describes three people. A question
 * can also be malformed in a way that would be harmless to answer. Different checks, different failure
 * modes, different codes.
 */

/** The conventional disclosure-control floor. docs/privacy-guard.md § k-anonymity. */
export const DEFAULT_K = 5

/** Below this, k-anonymity stops meaning anything, so the guard refuses to be configured lower. */
export const MIN_K = 3

/** Questions per column per session. docs/privacy-guard.md § The query budget. */
export const QUERIES_PER_COLUMN = 12

/** Predicate conditions. Three is where "a cleaning question" and "a description of a person" separate. */
export const MAX_CONDITIONS = 3

export type GuardConfig = {
  k: number
  queriesPerColumn: number
}

/**
 * Build the handle the tools hold.
 *
 * Takes the dataset by closure and returns an object of methods — deliberately, rather than exporting
 * free functions that take a dataset. A free function taking a `Dataset` is a function any tool could
 * call with any dataset it got hold of; a handle is a capability, and the only way to get one is from
 * here.
 *
 * TODO(riko), Day 2: the whole file. Implement in this order, because each one is the foundation of the
 * next:
 *   1. `query-budget.ts` — a Map<ColumnId, number>, charge before computing, never after
 *   2. `k-anonymity.ts` — the suppress/merge decision, in one place, used by everything
 *   3. `predicate.ts` — validate and evaluate a `Query`
 *   4. then the methods below, which are mostly composition once those three are right
 *
 * TODO(riko), Day 2: `k` is fixed at construction. It must be adjustable while a session is live, since
 * the human can raise it in the UI — and *only* raise it. Lowering k mid-session retroactively widens
 * every answer already given, which means the human could be walked down from 12 to 3 one click at a
 * time by an agent that keeps hitting suppressions. Reject any change below the current value and say why.
 */
export function createGuard(_config: GuardConfig = {
  k: DEFAULT_K,
  queriesPerColumn: QUERIES_PER_COLUMN,
}): GuardHandle {
  throw new Error('createGuard: not implemented')
}

/*
 * The nine methods, and what each one costs. Signatures live on `GuardHandle` in `types/domain.ts`;
 * this is the note about behaviour that a signature cannot carry.
 *
 * They are intentionally *not* exported as free functions here. A free function taking a `Dataset` is
 * callable by anything that gets hold of a dataset, which is precisely the boundary this file exists to
 * be. Everything below is reachable only through a handle returned by `createGuard`.
 *
 *   describe()
 *     Row count, column names and types, missing counts, distinct counts, and the guard's own settings.
 *     Free — see `describe-dataset.ts` for why orientation is not billed.
 *     `distinctCount` reports `'unique'` rather than a number when every value differs. The number would
 *     be `rowCount`, which the agent already knows; the word is what it actually needs, because a column
 *     of unique values is an identifier, and an identifier is a column to normalise rather than analyse.
 *
 *   profile(column)
 *     Type, missing count, distinct count, format histogram, length range, masked exemplars. One charge.
 *     The densest answer in the surface, which is why it costs despite looking like metadata.
 *
 *   shapes(column, { onlyUnrecognised })
 *     Masked exemplars grouped by format. One charge. Buckets below k are not shown at all; if every
 *     bucket is below k, refuse rather than return an empty list — an empty list reads as "clean".
 *
 *   count(query)
 *     Rows matching a predicate, or a suppression. Charges every column the predicate names, so a
 *     three-column predicate costs three questions.
 *
 *   aggregate(spec)
 *     Group-by with small groups merged into `__other__`, never dropped. Charges the grouped column and
 *     the valued column when there is one. `min`/`max` need the extra rule in `aggregate.ts`: for a group
 *     of exactly k rows the extreme *is* one row's value.
 *
 *   crosstab(rowColumn, columnColumn)
 *     Contingency table, each cell k-checked independently rather than the response as a whole. Charges
 *     both columns. Refuses wide pairs before computing anything.
 *
 *   issues(column?)
 *     Data-quality findings with row ids. Charges the named column, or every column when none is named.
 *     Counts are suppressed; row ids are not (docs/privacy-guard.md § Row ids).
 *
 *   duplicates(columns, threshold)
 *     Near-duplicate row pairs with scores and no values. Charges each compared column. A pair is 2 rows
 *     and so always below k; what protects the data is that a pair carries nothing to suppress.
 *
 *   dryRun(spec, rows?)
 *     What a transform would do: exact counts, masked before/after examples. No charge, and the same code
 *     path the commit uses.
 */

// Imported for the doc comments above and the signatures in `GuardHandle`. Kept as a single import so
// that adding a method to the handle fails here first, in the file that has to implement it.
export type GuardResultTypes = {
  describe: Verdict<DatasetSummary>
  profile: Verdict<ColumnProfile>
  shapes: Verdict<readonly FormatBucket[]>
  count: Verdict<number>
  aggregate: Verdict<AggregateResult>
  crosstab: Verdict<CrosstabResult>
  issues: Verdict<readonly Issue[]>
  duplicates: Verdict<readonly DuplicatePair[]>
  dryRun: Verdict<TransformReport>
}

export type GuardQueryInputs = {
  column: ColumnId
  query: Query
  aggregate: AggregateSpec
  transform: TransformSpec
  rows: readonly RowId[]
}
