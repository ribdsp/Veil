import type {
  AggregateResult,
  AggregateSpec,
  AppliedTransform,
  Column,
  ColumnId,
  ColumnProfile,
  CrosstabResult,
  Dataset,
  DatasetSummary,
  DuplicatePair,
  GuardHandle,
  Issue,
  JournalEventKind,
  NamedFormat,
  Query,
  RefusalCode,
  RevealRequest,
  RowId,
  TransformReport,
  TransformSpec,
  Verdict,
} from '@/types/domain'

import { columnIssues, formatSamples, profileColumn } from '@/lib/data/profile-column'
import { MAX_PAIRS, findPairs } from '@/lib/dedupe/find-pairs'
import { applyTransform, revertTransform } from '@/lib/transform/apply-transform'

import {
  MAX_CROSSTAB_CELLS,
  MAX_CROSSTAB_KEYS,
  computeAggregate,
  computeCrosstab,
  distinctAtMost,
  summarise,
} from './answers'
import { host, hostInstalled } from './host'
import { validateK } from './k-anonymity'
import { evaluate, isComparableType } from './predicate'
import { type BudgetState, charge, exhaustedColumns, remainingAcross } from './query-budget'
import { sampleExemplars, scriptNote } from './redact'

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
 *
 * ## What is here besides the nine methods
 *
 * `GuardHandle` in `types/domain.ts` is frozen, and it carries nine read methods. A session also has to be able
 * to *write* — commit a transform, undo one, hand over a revealed cell — and none of that can live anywhere
 * else: the dataset is in this closure, a tool may not hold one, and `lib/` may not import the store. So
 * `createGuard` returns a `Guard`, which **is** a `GuardHandle` plus those entry points. The frozen type is
 * untouched and every signature on it still means exactly what it said.
 *
 * Each write asks a human through `host.ts`, which refuses when nothing is listening. There is no path from a
 * tool call to a modified file that does not pass through a human decision.
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
 * The refused half of a `Verdict`, on its own.
 *
 * `Verdict<T>`'s refusal arm mentions no `T`, so this type is assignable to `Verdict<anything>`. Every
 * rejection helper below returns it, which means a refusal can be returned from any method without a type
 * argument and without a cast — and, more to the point, without any code path that builds an object holding
 * both a `value` and a `code` on the way there.
 */
type Refusal = {
  status: 'refused'
  code: RefusalCode
  reason: string
  remainingQueries: number
}

/** Everything a tool may know about the session without asking a question about the data. */
export type GuardSettings = {
  k: number
  queriesPerColumn: number
  rowCount: number
  columnCount: number
  /** Columns with no questions left. `find_issues` refuses the whole file when one of these is in scope. */
  exhausted: readonly ColumnId[]
  revealsGranted: number
  /** Entries on the undo stack, top last. */
  undoDepth: number
  /** False when nothing is listening for approvals — every write will refuse, and it is worth saying so. */
  hostInstalled: boolean
}

/** What `shapes()` would return if the frozen signature had room for it. */
export type ShapeSample = {
  shapes: readonly { format: NamedFormat; masked: string }[]
  /** The histogram the exemplars were drawn from: counts and shares, already k-folded. */
  buckets: readonly { format: NamedFormat; count: number; share: number }[]
  /** `redact.ts`'s note about caseless scripts, or null. */
  note: string | null
  truncated: boolean
}

/** What `profile_column` returns: the frozen profile, plus the exemplars it has no field for. */
export type ProfileReport = {
  profile: ColumnProfile
  shapes: readonly { format: NamedFormat; masked: string }[]
  note: string | null
  /** True when every format bucket sat below k, so the profile arrived without exemplars. */
  exemplarsSuppressed: boolean
}

export type DuplicateReport = {
  pairs: readonly DuplicatePair[]
  truncated: boolean
  /** Sentences about blocks too large to compare. Counts only — see `find-pairs.ts`. */
  skippedBlocks: readonly string[]
  cap: number
}

export type CommitOutcome =
  | { status: 'applied'; id: string; report: TransformReport; irreversible: boolean }
  | { status: 'refused'; code: 'notApproved' | 'invalidSpec' | 'datasetChanged'; reason: string }

export type UndoOutcome =
  | { status: 'undone'; id: string; kind: TransformSpec['kind']; column: ColumnId; restoredCount: number }
  | { status: 'empty' }
  | { status: 'irreversible'; kind: TransformSpec['kind']; column: ColumnId }
  | { status: 'failed'; reason: string }

export type RevealOutcome =
  | { status: 'granted'; value: string }
  | { status: 'refused'; reason: string }
  | { status: 'alreadyRefused'; reason: string }
  | { status: 'invalid'; reason: string }

/** The undo stack seen from outside. No `previousValues`: those are cells. */
export type AppliedSummary = {
  id: string
  kind: TransformSpec['kind']
  column: ColumnId
  appliedAt: number
  reversible: boolean
}

export type Guard = GuardHandle & {
  settings: () => GuardSettings
  /** Column names, indexes and inferred types. Metadata, so `predicate.ts` can parse a model's query. */
  columns: () => readonly Column[]
  /**
   * Questions left across a set of columns: the smallest, not the sum.
   *
   * For the one case a tool cannot get from a `Verdict`: a predicate that fails to parse is refused before any
   * method is called, and a refusal still has to report the budget honestly. Charges nothing.
   */
  remainingFor: (columns: readonly ColumnId[]) => number
  raiseMinGroupSize: (k: number) => { ok: true; k: number } | { ok: false; reason: string }
  profileWithExemplars: (column: ColumnId, exemplars: number) => Verdict<ProfileReport>
  shapeSample: (column: ColumnId, limit: number, onlyUnrecognised: boolean) => Verdict<ShapeSample>
  duplicatePairs: (columns: readonly ColumnId[], threshold: number) => Verdict<DuplicateReport>
  preview: (spec: TransformSpec, rows?: readonly RowId[]) => Verdict<TransformReport>
  commit: (spec: TransformSpec, rows: readonly RowId[] | undefined, reason: string) => Promise<CommitOutcome>
  undo: () => UndoOutcome
  history: () => readonly AppliedSummary[]
  reveal: (request: RevealRequest) => Promise<RevealOutcome>
}

/** Masked exemplars per `shapes` call. docs/privacy-guard.md § Masking. */
const MAX_EXEMPLARS = 10

/** Compared columns per `duplicates` call. Past this, every pair matches on something. */
const MAX_DEDUPE_COLUMNS = 4

/**
 * A caller-supplied bound, floored at 1, with a value that is not a number treated as absent.
 *
 * `Math.max(1, Math.trunc(NaN))` is `NaN`, and every comparison against `NaN` is false — so a bound that
 * arrived malformed would not produce a small allowance, it would produce an unlimited one, and the budget
 * would stop being a budget without anything looking wrong. `session.ts` passes the constants and nothing else
 * builds a guard, so this is not reachable today; it is here so that stays a fact about the code rather than a
 * fact about the current callers. `validateK` does the same job for k, and for the same reason.
 */
function bound(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}

/**
 * Build the handle the tools hold.
 *
 * Takes the dataset by closure and returns an object of methods — deliberately, rather than exporting
 * free functions that take a dataset. A free function taking a `Dataset` is a function any tool could
 * call with any dataset it got hold of; a handle is a capability, and the only way to get one is from
 * here.
 *
 * The binding in that closure is a `let`, because a commit produces a new dataset rather than editing one. It
 * is still the dataset by closure in the sense that matters: there is one reference, nothing returns it, and
 * rebinding it is reachable only from `commit` and `undo`, each of which needs a human first.
 *
 * Built in the order the three foundations were built, because each is the foundation of the next:
 * `query-budget.ts` charges before anything computes, `k-anonymity.ts` owns every suppress-or-merge decision,
 * `predicate.ts` validates and evaluates a `Query`, and the methods below are mostly composition over those
 * three plus `lib/data`, `lib/dedupe` and `lib/transform`.
 */
export function createGuard(
  dataset: Dataset,
  config: GuardConfig = {
    k: DEFAULT_K,
    queriesPerColumn: QUERIES_PER_COLUMN,
  },
): Guard {
  const requested = validateK(config.k)

  let live = dataset
  let k = requested.ok ? requested.k : DEFAULT_K
  let budget: BudgetState = new Map()
  let revealsGranted = 0

  const undoStack: AppliedTransform[] = []
  /** `${row}:${column}` for every reveal that was not granted. Asked once, refused for the session. */
  const refusedReveals = new Set<string>()

  const limit = bound(config.queriesPerColumn, QUERIES_PER_COLUMN)

  /* ---------------------------------------------------------------------------------------------
   * The plumbing every method shares
   * ------------------------------------------------------------------------------------------ */

  const columnFor = (id: ColumnId): Column | undefined => live.columns.find((column) => column.id === id)

  const allColumnIds = (): readonly ColumnId[] => live.columns.map((column) => column.id)

  /** Budget left across the columns an answer touched: the smallest, never the sum. */
  const left = (columns: readonly ColumnId[]): number =>
    remainingAcross(budget, columns.length === 0 ? allColumnIds() : columns, limit)

  const answered = <T,>(value: T, columns: readonly ColumnId[]): Verdict<T> => ({
    status: 'answered',
    value,
    remainingQueries: left(columns),
  })

  const refuse = (code: RefusalCode, reason: string, columns: readonly ColumnId[] = []): Refusal => ({
    status: 'refused',
    code,
    reason,
    remainingQueries: left(columns),
  })

  /**
   * Naming the columns that do exist costs nothing and saves a call.
   *
   * A rejection that says only "unknown column" sends the agent guessing, and every guess is another tool
   * call against a budget. The names are metadata it can have free from `describe_dataset` anyway.
   */
  const unknownColumn = (name: string): Refusal =>
    refuse('unknownColumn', `This file has no column called "${name}". The columns are: ${quoted(allColumnIds())}.`)

  /** Charge, or refuse naming the exhausted columns. All-or-nothing across the list. */
  const spend = (columns: readonly ColumnId[]): { ok: true } | { ok: false; verdict: Refusal } => {
    const result = charge(budget, columns, limit)
    if (!result.ok) return { ok: false, verdict: refuse('budgetExhausted', result.reason, columns) }

    budget = result.state
    return { ok: true }
  }

  /**
   * Whether a row subset is usable for this spec, as a sentence or `null`.
   *
   * Two checks, and both callers below need both. Row ids are checked against the file rather than trusted:
   * `applyTransform` throws on one out of range, and a throw reaches the agent as a tool crash instead of as an
   * answer it can act on.
   *
   * **`dropColumn` cannot take a subset.** Dropping is a change to `dataset.columns`, which has no per-row
   * meaning — the transform layer would blank the named rows *and* remove the column from the whole file. The
   * dry run would then report `changedCount: 1`, the approval dialog would say "1 row", and the human would
   * approve blanking one cell and lose the column, irreversibly, since `undo_last` refuses destructive kinds.
   * A preview that understates the scope of a destructive write is the one failure this design exists to
   * prevent, so the combination is refused rather than reinterpreted as "you meant the whole column".
   * `maskColumn` is different and still allowed: masking rewrites cells, so a subset of them is coherent.
   */
  const badRows = (spec: TransformSpec, rows: readonly RowId[] | undefined): string | null => {
    if (rows === undefined) return null
    if (rows.length === 0) {
      return 'The row list is empty. Omit it to target every row; an empty list would change nothing.'
    }

    if (spec.kind === 'dropColumn') {
      return (
        `A dropColumn removes "${spec.column}" from the file, so it cannot be limited to ${rows.length} row(s) ` +
        `— there is no such thing as dropping a column for some rows. Omit the row list to drop it, or use ` +
        `maskColumn with the rows if what you want is to empty those cells and keep the column.`
      )
    }

    for (const rowId of rows) {
      if (!Number.isInteger(rowId) || rowId < 0 || rowId >= live.rows.length) {
        return (
          `Row ${rowId} is not in this file, which has rows 0 to ${live.rows.length - 1}. Row ids come from ` +
          `find_issues or find_duplicates — they are not something to construct.`
        )
      }
    }

    return null
  }

  const record = (kind: JournalEventKind, subject: string, detail: string, irreversible = false): void => {
    host().record({ kind, subject, detail, irreversible, author: 'agent' })
  }

  /* ---------------------------------------------------------------------------------------------
   * The nine read methods
   * ------------------------------------------------------------------------------------------ */

  const describe = (): Verdict<DatasetSummary> => answered(summarise(live, k), [])

  /**
   * The shape sample itself: no budget charged, and no refusal. `null` when no bucket reaches k.
   *
   * Split out because `profile` and `shapeSample` both need it and neither should pay for it twice.
   * docs/tools.md § profile_column promises the profile *and* masked exemplars from one call, so the two
   * computations share a single charge — the refusal policy around them differs, and that lives in the callers.
   */
  const sampleFor = (target: Column, exemplarLimit: number, onlyUnrecognised: boolean): ShapeSample | null => {
    const sampled = formatSamples(live, target, k)
    const buckets = onlyUnrecognised
      ? sampled.buckets.filter((bucket) => bucket.format === 'unrecognised')
      : sampled.buckets

    if (buckets.length === 0) return null

    const exemplars = sampleExemplars(
      buckets.map((bucket) => ({ format: bucket.format, rowIds: bucket.rowIds })),
      // The one raw read in this file, and it never leaves the call: `sampleExemplars` masks each value
      // immediately and retains nothing. `lib/guard` and `lib/data` are the two modules allowed to look.
      (rowId) => live.rows[rowId]?.[target.index] ?? '',
      Math.min(bound(exemplarLimit, MAX_EXEMPLARS), MAX_EXEMPLARS),
    )

    return {
      shapes: exemplars.map((exemplar) => ({
        format: exemplar.format as NamedFormat,
        masked: exemplar.masked,
      })),
      buckets: buckets.map(({ format, count, share }) => ({ format, count, share })),
      note: scriptNote(exemplars.map((exemplar) => exemplar.masked)),
      truncated: sampled.truncated || buckets.length < sampled.buckets.length,
    }
  }

  const profile = (column: ColumnId): Verdict<ColumnProfile> => {
    const target = columnFor(column)
    if (target === undefined) return unknownColumn(column)

    const charged = spend([column])
    if (!charged.ok) return charged.verdict

    return answered(profileColumn(live, target, k), [column])
  }

  /**
   * The profile and its masked exemplars, for one charge.
   *
   * `ColumnProfile` is frozen and has nowhere to put exemplars, but docs/tools.md § profile_column promises
   * them and the densest answer in the surface is the one worth keeping whole: a histogram saying 43 values are
   * unrecognised, with no example of what one looks like, sends the agent straight back for a second call it
   * already paid for.
   *
   * `shapes` being `null` is not a refusal here. The profile is a real answer on its own, and a column whose
   * every format bucket sits below k is precisely the column whose counts and length range matter most.
   */
  const profileWithExemplars = (column: ColumnId, exemplarLimit: number): Verdict<ProfileReport> => {
    const target = columnFor(column)
    if (target === undefined) return unknownColumn(column)

    const charged = spend([column])
    if (!charged.ok) return charged.verdict

    const sample = sampleFor(target, exemplarLimit, false)

    return answered(
      {
        profile: profileColumn(live, target, k),
        shapes: sample === null ? [] : sample.shapes,
        note: sample === null ? null : sample.note,
        exemplarsSuppressed: sample === null,
      },
      [column],
    )
  }

  /**
   * Masked exemplars grouped by format, plus the histogram they came from.
   *
   * The richer entry point, and the one `sample_shapes` calls. A list of strings — which is what the frozen
   * `shapes` returns — has nowhere to put the counts, the caseless-script note or `truncated`, and an agent that
   * cannot see a count does not know whether a shape is the column or one outlier in it.
   *
   * Buckets below k are never shown: `formatSamples` has already folded them into `unrecognised` or dropped
   * them. If that leaves nothing, this refuses rather than answering with an empty list — an empty list reads
   * as "this column is clean", which is the opposite of what a column of all-below-k shapes means.
   */
  const shapeSample = (
    column: ColumnId,
    exemplarLimit: number,
    onlyUnrecognised: boolean,
  ): Verdict<ShapeSample> => {
    const target = columnFor(column)
    if (target === undefined) return unknownColumn(column)

    const charged = spend([column])
    if (!charged.ok) return charged.verdict

    const sample = sampleFor(target, exemplarLimit, onlyUnrecognised)
    if (sample === null) {
      return refuse(
        'belowK',
        onlyUnrecognised
          ? `No unrecognised shapes in "${column}" reach the minimum group size of ${k}, so there is nothing ` +
              `to show. Either every value matches a known format, or the ones that do not are too few to ` +
              `describe without describing a person. profile_column reports the counts.`
          : `Every format bucket in "${column}" holds fewer than ${k} rows, so any shape would point at the ` +
              `rows it came from. That usually means the column is unique per row — an id, a full name, a ` +
              `free-text note. profile_column gives its length range and distinct count without exemplars.`,
        [column],
      )
    }

    return answered(sample, [column])
  }

  const shapes = (column: ColumnId, exemplarLimit: number): Verdict<readonly string[]> => {
    const sample = shapeSample(column, exemplarLimit, false)
    if (sample.status === 'refused') return sample

    return {
      status: 'answered',
      value: sample.value.shapes.map((shape) => `${shape.format}: ${shape.masked}`),
      remainingQueries: sample.remainingQueries,
    }
  }

  /**
   * How many rows match a predicate.
   *
   * The predicate arrives already parsed by `predicate.ts` — arity, vocabulary and column names all checked
   * before anything here runs. What is left is the second decision: a count below k is withheld, because a
   * predicate matching four rows is a description of the four people in them with a number attached.
   *
   * Zero is reported. "No rows match" is the answer that stops the agent asking again, and it names nobody.
   */
  const count = (query: Query): Verdict<number> => {
    const named = [...new Set(query.conditions.map((condition) => condition.column))]
    for (const column of named) {
      if (columnFor(column) === undefined) return unknownColumn(column)
    }

    const charged = spend(named)
    if (!charged.ok) return charged.verdict

    // `evaluate` returns row ids; they are counted and dropped here. Returning them from `count_where` would
    // be a bulk read with a number on top of it.
    const matched = evaluate(query, live.rows, live.columns).length

    if (matched > 0 && matched < k) {
      return refuse(
        'belowK',
        `Between 1 and ${k - 1} rows match, so the count is withheld: a predicate matching that few rows is ` +
          `a description of the people in them. Widen it, or ask about the column instead.`,
        named,
      )
    }

    return answered(matched, named)
  }

  const aggregate = (spec: AggregateSpec): Verdict<AggregateResult> => {
    const groupBy = columnFor(spec.groupBy)
    if (groupBy === undefined) return unknownColumn(spec.groupBy)

    if (spec.fn !== 'count' && spec.over === undefined) {
      return refuse(
        'unknownColumn',
        `A ${spec.fn} needs a column to compute over. "groupBy" is the column whose values become the ` +
          `groups; pass the column being summed or averaged as "over".`,
      )
    }

    const over = spec.over === undefined ? undefined : columnFor(spec.over)
    if (spec.over !== undefined && over === undefined) return unknownColumn(spec.over)

    if (over !== undefined && spec.fn !== 'count' && !isComparableType(over.type)) {
      return refuse(
        'unknownColumn',
        `"${over.id}" holds ${over.type} values, so a ${spec.fn} over it has nothing to add up: every cell ` +
          `parses as not-a-number and the answer would be a real-looking zero. Use count, or normalise the ` +
          `column first and ask again.`,
      )
    }

    const filterColumns =
      spec.filter === undefined ? [] : [...new Set(spec.filter.conditions.map((condition) => condition.column))]

    for (const column of filterColumns) {
      if (columnFor(column) === undefined) return unknownColumn(column)
    }

    const named = [...new Set([spec.groupBy, ...(spec.over === undefined ? [] : [spec.over]), ...filterColumns])]

    const charged = spend(named)
    if (!charged.ok) return charged.verdict

    const result = computeAggregate(live, spec, k)

    // The `__other__` tail is free arithmetic only while the total is knowable: without a filter it is
    // `rowCount` from `describe_dataset` minus the named groups, so printing it hides nothing. A filter takes
    // that total away — no tool reports how many rows a predicate matched — and a tail below k becomes a fresh
    // count of a subpopulation, which is the disclosure `count` refuses one method above, reached by
    // subtraction instead. Refused here rather than blanked in `computeAggregate`, because `AggregateResult`
    // has nowhere to say "there is a tail and its size is withheld" and a `null` tail alongside
    // `truncated: true` would have the tool layer reporting that nothing was merged.
    const tail = result.other
    if (spec.filter !== undefined && tail !== null && tail.rowCount > 0 && tail.rowCount < k) {
      return refuse(
        'belowK',
        `The groups that survive suppression leave a remainder of fewer than ${k} filtered rows, and reporting ` +
          `its size would be a below-k count of the people in it — the same answer count_where withholds. ` +
          `Widen the filter, or drop it and group the whole column.`,
        named,
      )
    }

    return answered(result, named)
  }

  /**
   * A contingency table, or a refusal naming the column that was too wide.
   *
   * The width check reads the data, so it happens *after* the charge rather than before. That is deliberate:
   * "this column has more than 12 distinct values" is a real fact about the file, learned from the refusal,
   * and a question that teaches the agent something is a question that costs. The refusal says which column
   * and points at `aggregate`, so the next call is the right one rather than a retry.
   */
  const crosstab = (rows: ColumnId, columns: ColumnId): Verdict<CrosstabResult> => {
    const rowColumn = columnFor(rows)
    if (rowColumn === undefined) return unknownColumn(rows)

    const columnColumn = columnFor(columns)
    if (columnColumn === undefined) return unknownColumn(columns)

    if (rows === columns) {
      return refuse(
        'unknownColumn',
        `Cross-tabulating "${rows}" against itself produces a diagonal and nothing else. Name two different ` +
          `columns, or use aggregate for one.`,
      )
    }

    const named = [rows, columns]
    const charged = spend(named)
    if (!charged.ok) return charged.verdict

    const rowWidth = distinctAtMost(live, rowColumn, MAX_CROSSTAB_KEYS)
    if (rowWidth === 'more') return tooWide(rows, named)

    const columnWidth = distinctAtMost(live, columnColumn, MAX_CROSSTAB_KEYS)
    if (columnWidth === 'more') return tooWide(columns, named)

    if (rowWidth * columnWidth > MAX_CROSSTAB_CELLS) {
      return refuse(
        'belowK',
        `${rowWidth} × ${columnWidth} is ${rowWidth * columnWidth} cells, past the limit of ` +
          `${MAX_CROSSTAB_CELLS}. Spreading the file that thin puts most cells below ${k}, so most of the ` +
          `table would come back suppressed. Aggregate one column, then the other.`,
        named,
      )
    }

    return answered(computeCrosstab(live, rowColumn, columnColumn, k), named)
  }

  const tooWide = (column: ColumnId, named: readonly ColumnId[]): Refusal =>
    refuse(
      'belowK',
      `"${column}" has more than ${MAX_CROSSTAB_KEYS} distinct values, so a crosstab on it would be a grid ` +
        `of mostly-empty cells with a handful of rows in each — every one below ${k}, and the axis labels ` +
        `alone would list the values. Use aggregate to group by one column at a time.`,
      named,
    )

  /**
   * Data-quality findings, with row ids.
   *
   * An empty column list means the whole file, and then the charge covers every column — all of it or none of
   * it, so a file with one exhausted column refuses the call rather than quietly answering about the rest. A
   * partial answer to "what is wrong with this file" is the one answer nobody would think to check.
   *
   * Findings are not k-suppressed, and that is a documented decision rather than an omission.
   * docs/privacy-guard.md § Row ids publishes row ids on purpose, because a row id is a position in a file the
   * human already has open. `Issue.affectedCount` is the length of that published list whenever it is not
   * truncated, so suppressing the number while printing the ids would be a suppression in name only.
   */
  const issues = (columns: readonly ColumnId[]): Verdict<readonly Issue[]> => {
    for (const column of columns) {
      if (columnFor(column) === undefined) return unknownColumn(column)
    }

    const named = columns.length === 0 ? allColumnIds() : [...new Set(columns)]
    const charged = spend(named)
    if (!charged.ok) return charged.verdict

    const found = named
      .map((id) => columnFor(id))
      .filter((column): column is Column => column !== undefined)
      .flatMap((column) => columnIssues(live, column, k))
      .sort((a, b) => b.affectedCount - a.affectedCount || a.column.localeCompare(b.column))

    return answered(found, named)
  }

  /**
   * Near-duplicate row pairs.
   *
   * A pair is two rows and so always below k. What protects the data is that a pair carries nothing to
   * suppress: two row ids, a score, and the names of the columns that matched. The human opens their own file
   * to see the values, which is the whole design.
   */
  const duplicatePairs = (columns: readonly ColumnId[], threshold: number): Verdict<DuplicateReport> => {
    if (columns.length === 0) {
      return refuse('unknownColumn', 'Name at least one column to compare rows on.')
    }

    if (columns.length > MAX_DEDUPE_COLUMNS) {
      return refuse(
        'tooManyConditions',
        `${columns.length} columns is past the limit of ${MAX_DEDUPE_COLUMNS}. Comparing on that many makes ` +
          `every pair match on something and the score stops meaning anything. Pick the columns that identify ` +
          `a record — a name and an email, or a phone.`,
      )
    }

    const targets: Column[] = []
    for (const id of columns) {
      const target = columnFor(id)
      if (target === undefined) return unknownColumn(id)
      targets.push(target)
    }

    const named = [...new Set(columns)]
    const charged = spend(named)
    if (!charged.ok) return charged.verdict

    return answered({ ...findPairs(live, targets, threshold), cap: MAX_PAIRS }, named)
  }

  const duplicates = (columns: readonly ColumnId[], threshold: number): Verdict<readonly DuplicatePair[]> => {
    const report = duplicatePairs(columns, threshold)
    if (report.status === 'refused') return report

    return { status: 'answered', value: report.value.pairs, remainingQueries: report.remainingQueries }
  }

  /**
   * What a transform would do. No charge, and the same code path the commit uses.
   *
   * Free because a preview is the one call that makes the agent's next move safer rather than making the agent
   * better informed about the data: it returns counts and masked before/after shapes of the change *it* is
   * proposing. An agent that has to pay for a preview is an agent that proposes writes it has not checked.
   */
  const preview = (spec: TransformSpec, rows?: readonly RowId[]): Verdict<TransformReport> => {
    if (columnFor(spec.column) === undefined) return unknownColumn(spec.column)

    const bad = badRows(spec, rows)
    if (bad !== null) return refuse('unknownColumn', bad)

    // Charged nothing, but reported against the column the spec names rather than against the whole file: with
    // an empty list `left` falls back to every column and answers with the global minimum, which reads as "you
    // have 3 questions left here" about a column that still has twelve.
    return answered(applyTransform(live, spec, { rows, commit: false }).report, [spec.column])
  }

  const dryRun = (spec: TransformSpec): Verdict<TransformReport> => preview(spec)

  /* ---------------------------------------------------------------------------------------------
   * The writes, each behind a human
   * ------------------------------------------------------------------------------------------ */

  /**
   * Commit a transform: dry-run it, show *that* to the human, write it if they approve.
   *
   * The ordering is the point. The report the human approves is computed from the current dataset immediately
   * before the question, so what they see is what gets written — not a report from a proposal made twenty tool
   * calls ago against a file that has been transformed twice since.
   *
   * The dataset is re-checked after the await. A human can load a different file while an approval dialog is
   * open, and applying an approved diff to a file nobody approved it for is exactly the class of silent
   * corruption `revertTransform` refuses for the same reason.
   */
  const commit = async (
    spec: TransformSpec,
    rows: readonly RowId[] | undefined,
    reason: string,
  ): Promise<CommitOutcome> => {
    if (columnFor(spec.column) === undefined) {
      return {
        status: 'refused',
        code: 'invalidSpec',
        reason: `This file has no column called "${spec.column}". The columns are: ${quoted(allColumnIds())}.`,
      }
    }

    const bad = badRows(spec, rows)
    if (bad !== null) return { status: 'refused', code: 'invalidSpec', reason: bad }

    const before = live
    const dry = applyTransform(before, spec, { rows, commit: false })

    const decision = await host().askApproval({
      spec,
      report: dry.report,
      reason,
      rows: rows === undefined ? 'all' : rows.length,
    })

    if (!decision.approved) {
      record('transformProposed', spec.column, `${spec.kind} was not approved: ${decision.reason}`)
      return { status: 'refused', code: 'notApproved', reason: decision.reason }
    }

    if (live !== before) {
      return {
        status: 'refused',
        code: 'datasetChanged',
        reason:
          'The dataset changed while this was waiting for approval, so the approved preview no longer ' +
          'describes what would be written. Propose it again against the current file.',
      }
    }

    const outcome = applyTransform(live, spec, { rows, commit: true, author: 'agent' })
    if (outcome.applied === undefined || outcome.dataset === undefined) {
      return { status: 'refused', code: 'invalidSpec', reason: 'The transform produced no dataset to keep.' }
    }

    live = outcome.dataset
    undoStack.push(outcome.applied)
    host().datasetChanged(live)

    record(
      'transformApplied',
      spec.column,
      `${spec.kind}: ${outcome.report.changedCount} rows changed, ${outcome.report.failedCount} failed. ` +
        `Reason given: ${reason}`,
      outcome.report.destructive,
    )

    return {
      status: 'applied',
      id: outcome.applied.id,
      report: outcome.report,
      irreversible: outcome.report.destructive,
    }
  }

  /**
   * Put back the last transform.
   *
   * A destructive kind is refused and **left on the stack**. `dropColumn` and `maskColumn` record no previous
   * values by design, so an undo of one would walk an empty map and report a cheerful success; and popping it
   * would hide the irreversible thing that happened from every later undo. The entry stays, named, on top.
   *
   * No budget is refunded. The questions were asked and answered, and the answers are in the model's context
   * whatever the file now says. A refund would make undo a way to ask one column twelve questions repeatedly.
   */
  const undo = (): UndoOutcome => {
    const top = undoStack[undoStack.length - 1]
    if (top === undefined) return { status: 'empty' }

    if (top.spec.kind === 'dropColumn' || top.spec.kind === 'maskColumn') {
      return { status: 'irreversible', kind: top.spec.kind, column: top.spec.column }
    }

    try {
      const restored = revertTransform(live, top)
      undoStack.pop()
      live = restored
      host().datasetChanged(live)
      record(
        'transformUndone',
        top.spec.column,
        `${top.spec.kind} undone, ${top.previousValues.size} cells restored`,
      )

      return {
        status: 'undone',
        id: top.id,
        kind: top.spec.kind,
        column: top.spec.column,
        restoredCount: top.previousValues.size,
      }
    } catch (error: unknown) {
      return { status: 'failed', reason: error instanceof Error ? error.message : 'The undo failed.' }
    }
  }

  const history = (): readonly AppliedSummary[] =>
    undoStack.map((entry) => ({
      id: entry.id,
      kind: entry.spec.kind,
      column: entry.spec.column,
      appliedAt: entry.appliedAt,
      reversible: entry.spec.kind !== 'dropColumn' && entry.spec.kind !== 'maskColumn',
    }))

  /**
   * Ask the human to hand over one cell.
   *
   * The guard does not read the cell. It checks that the row and the column exist — both metadata — and asks;
   * the value inside a granted decision comes from the human, who is looking at their own spreadsheet. So "no
   * tool may read a cell" stays literally true even for the tool whose entire purpose is to obtain one, and
   * the only path from a cell to the model runs through a person.
   *
   * **Any outcome that is not a grant is remembered, a timeout included.** Asking again after a refusal is how
   * an agent turns one "no" into a dialog the human clicks through, and a tab left open overnight would
   * otherwise collect one prompt per attempt. Once refused, refused for the session.
   */
  const reveal = async (request: RevealRequest): Promise<RevealOutcome> => {
    if (columnFor(request.column) === undefined) {
      return {
        status: 'invalid',
        reason: `This file has no column called "${request.column}". The columns are: ${quoted(allColumnIds())}.`,
      }
    }

    if (!Number.isInteger(request.row) || request.row < 0 || request.row >= live.rows.length) {
      return {
        status: 'invalid',
        reason: `Row ${request.row} is not in this file, which has rows 0 to ${live.rows.length - 1}.`,
      }
    }

    const key = `${request.row}:${request.column}`
    if (refusedReveals.has(key)) {
      return {
        status: 'alreadyRefused',
        reason:
          `Row ${request.row} of "${request.column}" was already refused this session and will not be asked ` +
          `again. Work from the shape of the column instead: profile_column and sample_shapes describe it ` +
          `without naming anybody.`,
      }
    }

    record('revealRequested', request.column, `row ${request.row}, reason given: ${request.reason}`)

    const decision = await host().askReveal(request)

    if (!decision.granted) {
      refusedReveals.add(key)
      record('revealRefused', request.column, `row ${request.row}: ${decision.reason}`)
      return { status: 'refused', reason: decision.reason }
    }

    revealsGranted += 1
    // The detail carries no value, deliberately: the journal is exportable, and a granted reveal would
    // otherwise put a cell into a file the human might well share.
    record('revealGranted', request.column, `row ${request.row} was disclosed to the agent`, true)

    return { status: 'granted', value: decision.value }
  }

  /* ---------------------------------------------------------------------------------------------
   * Settings
   * ------------------------------------------------------------------------------------------ */

  const settings = (): GuardSettings => ({
    k,
    queriesPerColumn: limit,
    rowCount: live.rows.length,
    columnCount: live.columns.length,
    exhausted: exhaustedColumns(budget, limit),
    revealsGranted,
    undoDepth: undoStack.length,
    hostInstalled: hostInstalled(),
  })

  /**
   * Raise k. Never lower it.
   *
   * `k` is fixed at construction and has to be adjustable while a session is live, because the human can raise
   * it in the UI — and *only* raise it. Lowering it mid-session retroactively widens every answer already
   * given, which means an agent that keeps hitting suppressions could walk a human down from 12 to 3 one
   * helpful suggestion at a time. A rejection says why, because a human who asked for 3 deserves the reason
   * rather than a control that quietly does nothing.
   *
   * Called by the UI through the host. Nothing in `lib/webmcp` reaches it.
   */
  const raiseMinGroupSize = (next: number): { ok: true; k: number } | { ok: false; reason: string } => {
    const valid = validateK(next)
    if (!valid.ok) return valid

    if (valid.k < k) {
      return {
        ok: false,
        reason:
          `k is ${k} and can only go up. Lowering it would retroactively widen every answer already given ` +
          `this session — the suppressed ones included, since the agent can simply ask again.`,
      }
    }

    k = valid.k
    return { ok: true, k }
  }

  return {
    describe,
    profile,
    shapes,
    count,
    aggregate,
    crosstab,
    issues,
    duplicates,
    dryRun,
    settings,
    columns: () => live.columns,
    remainingFor: (columns) => left(columns),
    raiseMinGroupSize,
    profileWithExemplars,
    shapeSample,
    duplicatePairs,
    preview,
    commit,
    undo,
    history,
    reveal,
  }
}

/** Names, quoted, for a refusal that has to teach. */
function quoted(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ')
}

/*
 * The nine methods, and what each one costs. Signatures live on `GuardHandle` in `types/domain.ts`;
 * this is the note about behaviour that a signature cannot carry.
 *
 * They are intentionally *not* exported as free functions here. A free function taking a `Dataset` is
 * callable by anything that gets hold of a dataset, which is precisely the boundary this file exists to
 * be. Everything above is reachable only through a handle returned by `createGuard`.
 *
 *   describe()
 *     Row count, column names and types, missing counts, distinct counts, and the k in force. Free — see
 *     `describe-dataset.ts` for why orientation is not billed. Built from `columnSummary` rather than a
 *     full profile per column: the format histogram is two dozen recognisers per cell, and paying that on
 *     the free call would block the tab holding the user's only copy of their data.
 *     `distinctCount` reports `'unique'` rather than a number when every value differs. The number would
 *     be `rowCount`, which the agent already knows; the word is what it actually needs, because a column
 *     of unique values is an identifier, and an identifier is a column to normalise rather than analyse.
 *
 *   profile(column)
 *     Type, missing count, distinct count, format histogram, length range. One charge. The densest answer
 *     in the surface, which is why it costs despite looking like metadata. Masked exemplars come from
 *     `shapeSample`: `ColumnProfile` is frozen and has nowhere to put them.
 *
 *   shapes(column, limit) / shapeSample(column, limit, onlyUnrecognised)
 *     Masked exemplars grouped by format. One charge. Buckets below k are not shown at all; if every
 *     bucket is below k, refuse rather than return an empty list — an empty list reads as "clean".
 *
 *   count(query)
 *     Rows matching a predicate, or a suppression. Charges every column the predicate names, so a
 *     three-column predicate costs three of that column's twelve questions. Zero is reported.
 *
 *   aggregate(spec)
 *     Group-by with small groups merged into `__other__`, never dropped. Charges the grouped column, the
 *     valued column when there is one, and every column the filter names. `min`/`max` carry the extra rule
 *     in `answers.ts`: for a group of exactly k rows the extreme *is* one row's value.
 *
 *   crosstab(rowColumn, columnColumn)
 *     Contingency table, each cell k-checked independently rather than the response as a whole. Charges
 *     both columns. Refuses wide pairs before computing anything but the two distinct counts.
 *
 *   issues(columns)
 *     Data-quality findings with row ids. Charges the named columns, or every column when the list is
 *     empty. Counts and row ids are both reported: docs/privacy-guard.md § Row ids.
 *
 *   duplicates(columns, threshold) / duplicatePairs(...)
 *     Near-duplicate row pairs with scores and no values. Charges each compared column. A pair is 2 rows
 *     and so always below k; what protects the data is that a pair carries nothing to suppress.
 *
 *   dryRun(spec) / preview(spec, rows)
 *     What a transform would do: exact counts, masked before/after examples. No charge, and the same code
 *     path the commit uses.
 */

// Imported for the doc comments above and the signatures in `GuardHandle`. Kept as a single block so that
// adding a method to the handle fails here first, in the file that has to implement it.
export type GuardResultTypes = {
  describe: Verdict<DatasetSummary>
  profile: Verdict<ColumnProfile>
  /** `readonly string[]`, matching the frozen handle. `shapeSample` is the one that carries the counts. */
  shapes: Verdict<readonly string[]>
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
