/**
 * The shared vocabulary of the whole project.
 *
 * Owner: Riko. If you need a new type, ask in the group rather than editing — every module imports
 * this file, so a change here is the one change that can break all three people's work at once.
 *
 * Two rules about what belongs in this file:
 *
 * 1. **Types only, no logic.** No functions, no constants that encode policy. Thresholds live next to
 *    the code that enforces them, where a reader can see them being used.
 * 2. **Nothing here may make a cell value reachable from the tool layer.** `Dataset` below carries
 *    real values and is deliberately *not* something a tool ever receives. See the comment on it.
 */

/* -------------------------------------------------------------------------------------------------
 * Identity and authorship
 * ---------------------------------------------------------------------------------------------- */

/**
 * Who caused a thing to happen. Every mutation and every journal entry carries one.
 *
 * This is two values and not a boolean because `author === 'agent'` reads correctly in a condition
 * and `isAgent === false` does not survive a refactor that adds a third actor.
 */
export type Author = 'human' | 'agent'

/** A column, identified by its header text. Unique within a dataset; `lib/data` de-duplicates. */
export type ColumnId = string

/**
 * A row, identified by its zero-based position in the *original* file.
 *
 * Stable across transforms on purpose: a transform rewrites values in place and never reorders or
 * removes rows, so a row id the agent learned from `find_issues` on Day 1 still names the same record
 * after ten transforms. Sorting in the UI is a view concern and does not touch these.
 */
export type RowId = number

/* -------------------------------------------------------------------------------------------------
 * The dataset
 * ---------------------------------------------------------------------------------------------- */

/**
 * What kind of thing a column appears to hold, inferred from the values by `lib/data/infer-schema`.
 *
 * `mixed` is a real and common answer, not a fallback for "inference failed" — a column that is 80%
 * dates and 20% free text is the single most useful thing a cleaning agent can be told about, so it
 * has to be expressible.
 */
export type ValueType = 'text' | 'integer' | 'decimal' | 'date' | 'boolean' | 'empty' | 'mixed'

/**
 * The closed set of formats a value can be tested against.
 *
 * **This enum is the reason there is no regex anywhere in the tool surface.** An earlier design let
 * the agent supply a pattern. That is a denial-of-service risk through catastrophic backtracking, and
 * far worse, it is a side channel with real bandwidth: `^0812(\d)`, then `^08121(\d)`, and ten legal,
 * k-safe counts later the agent has reconstructed a phone number without ever asking for a reveal.
 *
 * Adding a format here is cheap and is the right way to extend matching. Accepting a pattern from the
 * model is not, however carefully it is validated — see CONTRIBUTING.md § rule 2.
 */
export type NamedFormat =
  // Contact
  | 'emailAddress'
  | 'phoneE164' // +6281234567890
  | 'phoneLocalId' // 081234567890
  | 'phoneDigitsOnly' // 81234567890
  // Dates, one per layout, because "is this a date" is useless and "which layout" is the answer
  | 'dateIso' // 2026-08-27
  | 'dateDmySlash' // 27/08/2026
  | 'dateMdySlash' // 08/27/2026
  | 'dateDmyDot' // 27.08.2026
  | 'dateTextualMonth' // 27 Aug 2026
  | 'timestampIso'
  // Numbers
  | 'integerPlain'
  | 'decimalPoint' // 1234.56
  | 'decimalComma' // 1234,56
  | 'currencyPrefixed' // Rp 1.234.567
  | 'percentSuffixed'
  // Identifiers
  | 'uuid'
  | 'digitsFixedLength'
  | 'alphanumericCode'
  // Text shapes
  | 'singleWord'
  | 'multipleWords'
  | 'titleCase'
  | 'upperCase'
  | 'lowerCase'
  // Fallbacks. `blank` is separate from `unrecognised` because "3% empty" and "3% garbage" call for
  // completely different fixes, and an agent told only "not matched" will propose the wrong one.
  | 'blank'
  | 'unrecognised'

/** A column's header plus what inference concluded about it. No values. */
export type Column = {
  id: ColumnId
  /** Position in the file. Preserved through transforms; `lib/data` never reorders columns. */
  index: number
  type: ValueType
}

/**
 * The parsed file, values included.
 *
 * **A tool must never hold one of these.** It lives in `lib/data` and `lib/guard`, and it reaches the
 * UI through the store because the human is allowed to see their own spreadsheet. The tool layer gets
 * `GuardHandle` instead, which can answer questions but cannot be read.
 *
 * `guard/no-leak.test.ts` greps `lib/webmcp/tools/*` and fails the build if this type, or the accessor
 * that returns cells from it, is imported there. The type system cannot express "this module may not
 * import that symbol", so a grep is doing the work a compiler would do in a better language.
 *
 * Rows are `readonly string[]` and not parsed objects on purpose: the file said `"08/27/2026"` and
 * every claim Veil makes has to be a claim about what the file actually says, not about what a Date
 * constructor decided it meant.
 */
export type Dataset = {
  columns: readonly Column[]
  /** Indexed by `RowId`. Each inner array is indexed by `Column.index`. */
  rows: readonly (readonly string[])[]
  /** File name as chosen by the user, for display and for the export. Never sent to the model. */
  sourceName: string
  rowCount: number
}

/* -------------------------------------------------------------------------------------------------
 * Queries — the only way the tool layer touches data
 * ---------------------------------------------------------------------------------------------- */

/**
 * A single condition.
 *
 * Closed union, one evaluator per variant in `lib/guard/predicate.ts`. There is deliberately no
 * `expression` or `pattern` variant, and a test greps the source for `eval(`, `new Function` and
 * `new RegExp` to keep it that way.
 *
 * Note what `equals` implies: the agent supplies a candidate value and learns how many rows carry it.
 * That is a guessing channel, and it is *intended* to be — asking "how many rows say `active`" is the
 * most ordinary question in data cleaning. What makes it safe is that the answer passes through
 * k-anonymity like every other count, so a guess narrow enough to name one person returns
 * `suppressed` rather than `1`.
 */
export type Condition =
  | { kind: 'equals'; column: ColumnId; value: string }
  | { kind: 'isEmpty'; column: ColumnId }
  | { kind: 'matchesFormat'; column: ColumnId; format: NamedFormat }
  | { kind: 'compare'; column: ColumnId; op: '<' | '<=' | '>' | '>='; value: number }
  | { kind: 'lengthBetween'; column: ColumnId; min: number; max: number }

/**
 * A whole question: up to three conditions joined by *one* operator.
 *
 * Flat rather than a tree, and that is a security decision rather than a simplification. Arbitrary
 * nesting of `all` and `any` can express a predicate that identifies exactly one human being, and
 * validating "is this tree too specific?" is an open-ended problem. Three conditions and one operator
 * is a bound you can check by counting, which means the check cannot be subtly wrong.
 */
export type Query = {
  conditions: readonly Condition[]
  join: 'all' | 'any'
}

/**
 * Why the guard declined to answer.
 *
 * `belowK` is not an error and must not be presented as one — a real answer existed and describing it
 * would have described too few people. The rest are the agent asking something malformed or having
 * spent its allowance, and each one is phrased for the agent to act on.
 */
export type RefusalCode =
  | 'belowK'
  | 'budgetExhausted'
  | 'tooManyConditions'
  | 'unknownColumn'
  | 'unknownFormat'
  | 'noDataset'

/**
 * Every guarded answer, and the reason the tool layer cannot accidentally read past a refusal: there
 * is no shape here that carries both a `value` and a refusal, so `verdict.value` does not typecheck
 * until the caller has narrowed on `status`.
 *
 * `remainingQueries` rides along on both branches because an agent that knows its allowance spends it
 * deliberately, and one that doesn't burns twelve questions on a column it did not need.
 */
export type Verdict<T> =
  | { status: 'answered'; value: T; remainingQueries: number }
  | { status: 'refused'; code: RefusalCode; reason: string; remainingQueries: number }

/**
 * What the tool layer is handed in place of the dataset.
 *
 * Every method is a question, every answer is a `Verdict`, and there is no method that returns a
 * value from a cell. `lib/guard/guard.ts` builds one of these around a `Dataset`; the tools import
 * only this type.
 *
 * Deliberately an object of functions rather than a class: it makes the surface enumerable by reading
 * the type, and it makes a stub for tests three lines long.
 */
export type GuardHandle = {
  describe: () => Verdict<DatasetSummary>
  profile: (column: ColumnId) => Verdict<ColumnProfile>
  shapes: (column: ColumnId, limit: number) => Verdict<readonly string[]>
  count: (query: Query) => Verdict<number>
  aggregate: (spec: AggregateSpec) => Verdict<AggregateResult>
  crosstab: (rows: ColumnId, columns: ColumnId) => Verdict<CrosstabResult>
  issues: (columns: readonly ColumnId[]) => Verdict<readonly Issue[]>
  duplicates: (columns: readonly ColumnId[], threshold: number) => Verdict<readonly DuplicatePair[]>
  dryRun: (spec: TransformSpec) => Verdict<TransformReport>
}

/* -------------------------------------------------------------------------------------------------
 * What the guard is allowed to say
 * ---------------------------------------------------------------------------------------------- */

/** The answer to `describe_dataset`. Shape and counts; no values anywhere. */
export type DatasetSummary = {
  rowCount: number
  columns: readonly ColumnSummary[]
  /** k currently in force. Reported so the agent can explain a suppression to the user itself. */
  minGroupSize: number
}

export type ColumnSummary = {
  id: ColumnId
  type: ValueType
  emptyCount: number
  /**
   * Distinct non-empty values.
   *
   * Itself k-suppressed at the top end: a distinct count equal to the row count says "this column is
   * a unique identifier per person", which is exactly the column an attacker wants named. Reported as
   * `'unique'` in that case rather than as a number that can be differenced against.
   */
  distinctCount: number | 'unique'
}

/** One format bucket in a column profile: this many values look like this. */
export type FormatBucket = {
  format: NamedFormat
  count: number
  /** Share of non-empty values, 0–1, rounded to three places. Convenience for the model. */
  share: number
}

/**
 * The answer to `profile_column`: everything about a column's *shape*.
 *
 * This is the type that decides whether the whole project works. Too little and the agent cannot
 * propose a fix; too much and the profile is a description of individuals. See
 * `docs/privacy-guard.md` for how each field was argued for.
 */
export type ColumnProfile = {
  id: ColumnId
  type: ValueType
  emptyCount: number
  distinctCount: number | 'unique'
  minLength: number
  maxLength: number
  /** At most 8, largest first, remainder folded into an `unrecognised` bucket. */
  formats: readonly FormatBucket[]
  /** True when buckets were folded, so the agent knows the tail exists. */
  truncated: boolean
}

export type AggregateFn = 'count' | 'sum' | 'mean' | 'min' | 'max'

export type AggregateSpec = {
  groupBy: ColumnId
  fn: AggregateFn
  /** Required for everything except `count`, where it is ignored. */
  over?: ColumnId
  filter?: Query
}

/**
 * One group's result. `value` is `'suppressed'` rather than absent so the agent can see that a group
 * exists at this key without learning its size — the existence of a group is usually not identifying,
 * and hiding it makes the agent think the data is cleaner than it is.
 */
export type AggregateGroup = {
  key: string
  count: number | 'suppressed'
  value: number | 'suppressed'
}

export type AggregateResult = {
  groups: readonly AggregateGroup[]
  /**
   * Everything below k, and everything past the 25-group cap, merged.
   *
   * Merged rather than dropped so the totals still add up. An agent whose groups sum to less than the
   * row count concludes it has been given a filtered dataset, and every number it reports after that
   * is wrong in a way nobody can see.
   */
  other: { groupCount: number; rowCount: number } | null
  truncated: boolean
}

export type CrosstabResult = {
  rowKeys: readonly string[]
  columnKeys: readonly string[]
  /** `cells[i][j]` for `rowKeys[i]` × `columnKeys[j]`. Any cell below k is `'suppressed'`. */
  cells: readonly (readonly (number | 'suppressed')[])[]
  suppressedCells: number
  truncated: boolean
}

/* -------------------------------------------------------------------------------------------------
 * Findings
 * ---------------------------------------------------------------------------------------------- */

/**
 * The closed vocabulary of data-quality findings.
 *
 * A code rather than a sentence because the agent branches on these, and free text would have it
 * pattern-matching on our prose. The human-readable sentence is added in the UI, where it can be
 * translated.
 */
export type IssueCode =
  | 'mixedFormat'
  | 'leadingWhitespace'
  | 'trailingWhitespace'
  | 'inconsistentCase'
  | 'impossibleDate'
  | 'futureDate'
  | 'outOfRange'
  | 'nonNumericInNumericColumn'
  | 'placeholderValue' // "N/A", "-", "null", "0000-00-00"
  | 'duplicateKey'
  | 'inconsistentLength'

export type Issue = {
  code: IssueCode
  column: ColumnId
  /** At most 100, ascending. `affectedCount` is the true total. */
  rowIds: readonly RowId[]
  affectedCount: number
  truncated: boolean
}

/**
 * Two rows that look like the same record.
 *
 * `matchedColumns` and `score` and nothing else. Naming the columns that agreed is what lets the agent
 * reason about whether this is a genuine duplicate or two siblings at one address; showing the values
 * that agreed would be showing two people's details side by side, which is the most identifying output
 * this app could possibly produce.
 */
export type DuplicatePair = {
  a: RowId
  b: RowId
  /** 0–1. `lib/dedupe/similarity.ts` defines the metric; it is not a plain string distance. */
  score: number
  matchedColumns: readonly ColumnId[]
}

/* -------------------------------------------------------------------------------------------------
 * Transforms
 * ---------------------------------------------------------------------------------------------- */

/**
 * The closed set of edits Veil can make.
 *
 * Same reasoning as `Condition`: a transform expressed as a model-supplied function or template would
 * be arbitrary code execution over the user's private data. One variant per operation, one
 * implementation each in `lib/transform/`, and a switch that the compiler checks for exhaustiveness.
 *
 * `dropColumn` and `maskColumn` are destructive in a way the others are not — they remove information
 * rather than reshaping it — which is why `apply_transform` requires human approval for those two
 * even though undo exists. See `docs/tools.md`.
 */
export type TransformSpec =
  | { kind: 'trimWhitespace'; column: ColumnId }
  | { kind: 'collapseSpaces'; column: ColumnId }
  | { kind: 'changeCase'; column: ColumnId; to: 'lower' | 'upper' | 'title' }
  | { kind: 'normaliseDate'; column: ColumnId; to: 'dateIso' | 'timestampIso' }
  | { kind: 'normalisePhone'; column: ColumnId; to: 'phoneE164'; defaultCountryCode: string }
  | { kind: 'normaliseNumber'; column: ColumnId; to: 'decimalPoint' | 'integerPlain' }
  | { kind: 'padLeft'; column: ColumnId; length: number; with: string }
  | { kind: 'replacePlaceholderWithEmpty'; column: ColumnId }
  | { kind: 'dropColumn'; column: ColumnId }
  | { kind: 'maskColumn'; column: ColumnId; keep: 'none' | 'lastFour' | 'domain' }

/**
 * The dry-run answer: what would happen, described without showing what is there.
 *
 * `examples` is the interesting field. It is masked before-and-after pairs — `27/08/2026` becomes
 * `99/99/9999 → 9999-99-99` — which is enough for the agent to confirm the transform does what it
 * intended and not enough to read anybody's record. `failedRowIds` are the rows the transform cannot
 * handle, and they are the usual reason an agent decides it needs a reveal.
 */
export type TransformReport = {
  spec: TransformSpec
  unchangedCount: number
  changedCount: number
  failedCount: number
  /** At most 10 failures, ascending. */
  failedRowIds: readonly RowId[]
  /** At most 10 masked pairs. */
  examples: readonly { from: string; to: string }[]
  destructive: boolean
}

/** A transform that was applied, kept so `undo_last` can be exact rather than approximate. */
export type AppliedTransform = {
  id: string
  spec: TransformSpec
  author: Author
  appliedAt: number
  /**
   * The values this transform overwrote, by row.
   *
   * Yes, this is real data held in memory — it is the user's own data, in the user's own tab, and undo
   * is not honest without it. It is never serialised into an export and never reachable from a tool;
   * `AppliedTransform` is one of the types `guard/no-leak.test.ts` bans from the tool layer.
   */
  previousValues: ReadonlyMap<RowId, string>
}

/* -------------------------------------------------------------------------------------------------
 * The human gate
 * ---------------------------------------------------------------------------------------------- */

/**
 * A generic pending human decision.
 *
 * Both blocking tools are built on this: `request_reveal` and `ask_human`. The pattern is that a tool
 * creates a gate, puts it in the store, returns the promise, and the UI resolves it when someone
 * clicks. `lib/webmcp/blocking.ts` owns the mechanics, including the timeout.
 */
export type Gate<T> = {
  id: string
  createdAt: number
  resolve: (value: T) => void
  /** Absolute epoch ms. Past this, the gate resolves itself with its fail-closed default. */
  expiresAt: number
}

/** What the agent is asking to see, and why it says it needs to. */
export type RevealRequest = {
  column: ColumnId
  row: RowId
  /**
   * The agent's written justification, shown verbatim to the human.
   *
   * This is the field the whole feature turns on. The human is not really judging a row and a column —
   * they are judging whether this sentence is a real reason, and a vague one is easy to refuse. Tool
   * validation requires it non-empty for exactly that reason.
   */
  reason: string
}

/**
 * The human's answer.
 *
 * A refusal carries a reason too, and it is passed back to the agent. An agent told *"you don't need a
 * customer's name to fix a date column"* behaves noticeably better than one told only `false` — it
 * looks for a structural route instead of asking again in a different shape.
 */
export type RevealDecision =
  | { granted: true; value: string }
  | { granted: false; reason: string }

/** A question the agent needs answered before it can proceed. Options are closed; free text is not. */
export type HumanQuestion = {
  question: string
  options: readonly string[]
}

/* -------------------------------------------------------------------------------------------------
 * The journal
 * ---------------------------------------------------------------------------------------------- */

export type JournalEventKind =
  | 'datasetLoaded'
  | 'toolCalled'
  | 'answerSuppressed'
  | 'budgetExhausted'
  | 'transformProposed'
  | 'transformApplied'
  | 'transformUndone'
  | 'revealRequested'
  | 'revealGranted'
  | 'revealRefused'
  | 'questionAsked'
  | 'questionAnswered'
  | 'reportSubmitted'

/**
 * One line of the audit trail. Append-only: there is no update and no delete, in the store or in the
 * type — `readonly` fields are the cheapest way to say that to the next person.
 *
 * Six weeks after a file was cleaned, someone will ask why a date column changed. This is the answer,
 * and it is only the answer if nothing can quietly edit it.
 */
export type JournalEntry = {
  readonly id: string
  readonly at: number
  readonly author: Author
  readonly kind: JournalEventKind
  /** Tool name for `toolCalled`, transform id for the transform events, and so on. */
  readonly subject: string
  /** One line for the UI. Never contains a cell value except on `revealGranted`. */
  readonly detail: string
  /**
   * True for the one event class that cannot be undone: a granted reveal.
   *
   * Rendered in `revealed` red and counted in the header for the session. Making the cost visible is
   * what stops "just approve it" becoming a reflex.
   */
  readonly irreversible: boolean
}

/* -------------------------------------------------------------------------------------------------
 * Session state
 * ---------------------------------------------------------------------------------------------- */

/**
 * Everything the UI draws, in one place.
 *
 * Note what is *not* here: the `GuardHandle`. It isn't state — nothing renders from it and it has no
 * meaningful previous value — so it lives as a module-level handle in `lib/guard`, the way the replay
 * engine does in our sister project. The store holds what the UI draws; that holds the thing that does
 * the work.
 */
export type SessionState = {
  dataset: Dataset | null
  /** k in force for this session. The human can raise it; `MIN_K` in the guard floors it. */
  minGroupSize: number
  /** Per-column queries spent. Absent key means none spent yet. */
  queriesUsed: Readonly<Record<ColumnId, number>>
  /** Profiles the agent has been given, so the UI can un-hatch exactly what it knows. */
  knownProfiles: Readonly<Record<ColumnId, ColumnProfile>>
  proposals: readonly TransformReport[]
  applied: readonly AppliedTransform[]
  pendingReveal: (Gate<RevealDecision> & { request: RevealRequest }) | null
  pendingQuestion: (Gate<string> & { question: HumanQuestion }) | null
  revealsGranted: number
  journal: readonly JournalEntry[]
}
