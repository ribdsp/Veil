import type {
  AppliedTransform,
  Author,
  ColumnId,
  ColumnProfile,
  Dataset,
  Gate,
  HumanQuestion,
  JournalEntry,
  JournalEventKind,
  RevealDecision,
  RevealRequest,
  SessionState,
  TransformReport,
} from '@/types/domain'

/**
 * The one place session state lives.
 *
 * Owner: Vicko.
 *
 * Zustand, one store, no persistence. Nothing here survives a refresh and that is deliberate: a dataset in
 * `localStorage` is a dataset that outlives the human's attention, sitting in a browser profile that gets
 * synced, backed up and inherited by whoever uses the machine next. Veil's promise is "your data stays in this
 * tab", and a tab that remembers is not that.
 *
 * **Every mutating action takes an `author`.** Not for symmetry — because the journal entry it writes is
 * worthless without it. "The date column was normalised" answers nothing; "the agent normalised the date
 * column, and the human approved it" is the sentence somebody needs six weeks later. An action that defaults
 * `author` to `'agent'` for convenience will eventually record a human's own edit as the agent's, and the whole
 * audit trail becomes something you have to caveat.
 */

export type SessionActions = {
  /* -- Dataset ------------------------------------------------------------------------------------ */
  loadDataset: (dataset: Dataset, profiles: Readonly<Record<ColumnId, ColumnProfile>>) => void
  clearDataset: () => void
  /** Only ever upward; the guard floors it at `MIN_K`. */
  raiseMinGroupSize: (k: number) => void

  /* -- Guard bookkeeping -------------------------------------------------------------------------- */
  recordQueries: (columns: readonly ColumnId[]) => void
  recordProfile: (column: ColumnId, profile: ColumnProfile) => void

  /* -- Transforms ---------------------------------------------------------------------------------- */
  addProposal: (report: TransformReport) => void
  commitTransform: (dataset: Dataset, applied: AppliedTransform, author: Author) => void
  undoTransform: (dataset: Dataset, author: Author) => void

  /* -- Gates --------------------------------------------------------------------------------------- */
  openReveal: (gate: Gate<RevealDecision>, request: RevealRequest) => void
  settleReveal: (decision: RevealDecision) => void
  openQuestion: (gate: Gate<string>, question: HumanQuestion) => void
  settleQuestion: (answer: string) => void

  /* -- Journal ------------------------------------------------------------------------------------- */
  record: (
    kind: JournalEventKind,
    author: Author,
    subject: string,
    detail: string,
    options?: { irreversible?: boolean },
  ) => void
}

export type SessionStore = SessionState & SessionActions

export const EMPTY_SESSION: SessionState = {
  dataset: null,
  minGroupSize: 5,
  queriesUsed: {},
  knownProfiles: {},
  proposals: [],
  applied: [],
  pendingReveal: null,
  pendingQuestion: null,
  revealsGranted: 0,
  journal: [],
}

/**
 * Create the store.
 *
 * TODO(vicko), Day 2: implement with `create<SessionStore>()((set, get) => ({ ...EMPTY_SESSION, ...actions }))`
 * from zustand. No middleware: no `persist` (see the header), and no `devtools` in the production bundle —
 * the devtools extension receives every action payload, and one of those payloads is a granted cell value.
 *
 * TODO(vicko), Day 2: every action that changes something calls `record(...)` in the same `set`. Two `set`
 * calls means a render can happen between them, and the UI briefly shows a transform that the journal has no
 * line for — which is precisely the state a screenshot gets taken in.
 *
 * TODO(vicko), Day 3: `clearDataset` resets to `EMPTY_SESSION` **except** the journal, which is preserved and
 * gets a `datasetLoaded` line for the next file. Wiping the journal on file change means a human who loads the
 * wrong file, notices, and loads the right one has silently destroyed the record of what the agent asked for in
 * between. The journal outlives the dataset; only the tab ends it.
 *
 * TODO(vicko), Day 3: `raiseMinGroupSize` must reject a lower value rather than clamp it silently — return
 * early and journal the attempt. k going down is the one setting change that retroactively widens everything
 * already answered, so an agent that can talk the human into "just try 3" gets the whole session re-answerable
 * at 3. Only the human's own control raises it; nothing in `lib/webmcp` may call this at all.
 *
 * TODO(vicko), Day 4: `settleReveal` calls `gate.resolve(decision)` and then clears `pendingReveal`, and must be
 * a no-op when `pendingReveal` is already null. Double-click on Approve calls this twice; `blocking.ts` makes
 * the second `resolve` harmless, but the second journal line is not — a journal showing two granted reveals for
 * one decision overstates the cost, and a journal nobody trusts the numbers in is decoration.
 *
 * TODO(vicko), Day 4: `settleReveal` increments `revealsGranted` only when `decision.granted`, and writes
 * `revealGranted` with `irreversible: true`. That flag is what makes the line red and what the header counts.
 *
 * TODO(vicko), Day 5: `undoTransform` pops `applied`, does **not** refund `queriesUsed`, and journals
 * `transformUndone`. The budget is spent attention, not a resource — undoing a change does not un-ask the
 * questions that led to it, and refunding turns undo into a way to buy more queries.
 */
export function createSessionStore(): never {
  throw new Error('createSessionStore: not implemented')
}

/**
 * TODO(vicko), Day 2: the hook the components use is `useSession`, and it does not exist yet — it is
 * `export const useSession = create<SessionStore>()(…)`, replacing `createSessionStore` above once zustand is
 * installed. It is described here rather than declared because `export declare const useSession` would
 * typecheck for every importer and be `undefined` at runtime, which is a worse failure than a missing export.
 *
 * Select narrowly at the call site — `useSession((s) => s.journal)`, not `useSession()`. The whole-store
 * selector re-renders the 50,000-row table every time a journal line lands, and journal lines land on every
 * tool call.
 */

/**
 * Read the current state outside React.
 *
 * TODO(vicko), Day 3: implement as `useSession.getState()`. The tools need this: a tool is called from the
 * agent, not from a component, so there is no hook context — and a tool that closes over a snapshot taken at
 * registration time reads a dataset that was replaced ten minutes ago.
 */
export function snapshot(): SessionState {
  throw new Error('snapshot: not implemented')
}

/** Kept so the journal type is imported where the next person expects to find it used. */
export type JournalView = readonly JournalEntry[]
