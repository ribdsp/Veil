import { create } from 'zustand'

import { append, entry } from '@/lib/journal/journal'
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
  TransformSpec,
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

/**
 * Why a gate closed without anybody answering it.
 *
 * `timeout` is `blocking.ts` reaching `GATE_TIMEOUT_MS`; `abandoned` is `abandonAllGates()` — the surface
 * unmounting, or a different file being opened underneath a pending question. Two words rather than one
 * because they call for different reactions from the human reading the journal afterwards: the first says
 * they were away from the keyboard, the second says the session moved on without them.
 */
export type GateExpiry = 'timeout' | 'abandoned'

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
  /**
   * Close a question nobody answered, and say so in the record.
   *
   * Not a variant of `settleQuestion`, because `settleQuestion` writes the answer as the human's. On a
   * timeout the human is not at the keyboard; `blocking.ts` resolved the gate with the change-nothing
   * option and the agent has already carried on. Without this action the card stays on screen for the rest
   * of the session and the journal shows a question that was asked and never resolved — or, worse, gets
   * routed through `settleQuestion` and shows a decision somebody never made.
   */
  expireQuestion: (gateId: string, optionUsed: string, cause: GateExpiry) => void

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
 * Fold a journal line into a state update.
 *
 * Exists so every action below can journal *inside the same `set`* as the change it is journalling. Two `set`
 * calls means a render can happen between them, and the UI briefly shows a transform that the journal has no
 * line for — which is precisely the state a screenshot gets taken in.
 */
function withEntry(
  journal: readonly JournalEntry[],
  kind: JournalEventKind,
  author: Author,
  subject: string,
  detail: string,
  options?: { irreversible?: boolean },
): { journal: readonly JournalEntry[] } {
  return { journal: append(journal, entry(kind, author, subject, detail, options)) }
}

/** One line naming a transform, for a journal `detail`. The spec's shape only — never a value. */
function describeSpec(spec: TransformSpec): string {
  return `${spec.kind} on column "${spec.column}"`
}

/** How a reveal is addressed in the journal, so the request and the decision line up under one subject. */
function revealSubject(request: RevealRequest): string {
  return `${request.column} row ${request.row}`
}

/**
 * The store.
 *
 * No middleware, and both omissions are deliberate. No `persist`: see the header — a remembered dataset is a
 * dataset that outlives the human's attention. No `devtools`: the extension receives every action payload, and
 * one of those payloads is a granted cell value, so wiring it up would quietly route the most sensitive event
 * in the product to a third-party listener.
 *
 * Select narrowly at the call site — `useSession((s) => s.journal)`, not `useSession()`. The whole-store
 * selector re-renders the 50,000-row table every time a journal line lands, and journal lines land on every
 * tool call.
 */
export const useSession = create<SessionStore>()((set, get) => ({
  ...EMPTY_SESSION,

  /* -- Dataset ------------------------------------------------------------------------------------ */

  /**
   * Author is `'human'` rather than a parameter: loading a file is something only a person can do here — no
   * tool opens a file, and there is no server that could hand one over.
   *
   * Everything dataset-scoped resets, because a budget or a profile carried over from the previous file is an
   * answer about data that is no longer loaded. `minGroupSize` is the exception and survives: resetting it to
   * the default would silently *lower* k for someone who had raised it, which is the one move
   * `raiseMinGroupSize` exists to prevent.
   */
  loadDataset: (dataset, profiles) =>
    set((state) => ({
      ...EMPTY_SESSION,
      minGroupSize: state.minGroupSize,
      dataset,
      knownProfiles: profiles,
      ...withEntry(
        state.journal,
        'datasetLoaded',
        'human',
        dataset.sourceName,
        `Loaded ${dataset.rowCount} rows and ${dataset.columns.length} columns. ` +
          `k in force: ${state.minGroupSize}.`,
      ),
    })),

  /**
   * Resets to `EMPTY_SESSION` **except** the journal and k, both of which carry on into the next file.
   *
   * Wiping the journal on file change means a human who loads the wrong file, notices, and loads the right one
   * has silently destroyed the record of what the agent asked for in between. The journal outlives the dataset;
   * only the tab ends it.
   *
   * The line it writes is a `datasetLoaded`: the frozen `JournalEventKind` has no `datasetCleared`, and
   * `datasetLoaded` is the only session-scope kind that no export summary counter reads, so borrowing it
   * distorts no number. The `detail` says what actually happened.
   *
   * A pending gate is dropped rather than resolved. `blocking.ts` fails closed on its own timeout, so the agent
   * gets a refusal a few seconds later; that is the correct direction to fail, and resolving a gate here would
   * be answering on the human's behalf.
   */
  clearDataset: () =>
    set((state) => ({
      ...EMPTY_SESSION,
      // k survives, for the same reason it survives `loadDataset`: the session is the tab, not the file —
      // the journal says so itself by carrying on across a clear. Letting k fall back to the default here
      // would be the one path in the app where it silently drops, and `raiseMinGroupSize` exists to make
      // that impossible. Someone who raised k to 12, cleared a wrong file and opened the right one must not
      // be answered at 5 without being told.
      minGroupSize: state.minGroupSize,
      ...withEntry(
        state.journal,
        'datasetLoaded',
        'human',
        state.dataset?.sourceName ?? '(no dataset)',
        'Dataset cleared. The journal is kept and continues into the next file.',
      ),
    })),

  /**
   * Rejects a lower value rather than clamping it silently — returns early and journals the attempt.
   *
   * k going down is the one setting change that retroactively widens everything already answered, so an agent
   * that can talk the human into "just try 3" gets the whole session re-answerable at 3. Only the human's own
   * control raises it; nothing in `lib/webmcp` may call this at all.
   *
   * The rejected attempt is journalled precisely because it is the interesting event: a session containing three
   * refused attempts to lower k is a session somebody should look at.
   */
  raiseMinGroupSize: (k) => {
    const current = get().minGroupSize
    if (!Number.isInteger(k) || k <= current) {
      set((state) => ({
        ...withEntry(
          state.journal,
          'datasetLoaded',
          'human',
          'minGroupSize',
          `Rejected a change of k from ${state.minGroupSize} to ${k}: k is only ever raised.`,
        ),
      }))
      return
    }
    set((state) => ({
      minGroupSize: k,
      ...withEntry(
        state.journal,
        'datasetLoaded',
        'human',
        'minGroupSize',
        `k raised from ${state.minGroupSize} to ${k}.`,
      ),
    }))
  },

  /* -- Guard bookkeeping -------------------------------------------------------------------------- */

  /**
   * Mirror of the guard's per-column accounting, for the budget meter.
   *
   * Deliberately silent in the journal: the tool that spent the query writes its own `toolCalled` line, and the
   * guard writes `budgetExhausted` when a column closes. A third line per call would double-count the session
   * and bury the events that matter under bookkeeping.
   */
  recordQueries: (columns) =>
    set((state) => {
      const queriesUsed: Record<ColumnId, number> = { ...state.queriesUsed }
      for (const column of columns) queriesUsed[column] = (queriesUsed[column] ?? 0) + 1
      return { queriesUsed }
    }),

  /** Also silent, and for the same reason: this records what the agent has been told, not a new event. */
  recordProfile: (column, profile) =>
    set((state) => ({ knownProfiles: { ...state.knownProfiles, [column]: profile } })),

  /* -- Transforms ---------------------------------------------------------------------------------- */

  /**
   * Author is `'agent'` rather than a parameter: a proposal is a dry run, and the dry run is the agent's move.
   * A human editing their own spreadsheet does not propose to themselves.
   */
  addProposal: (report) =>
    set((state) => ({
      proposals: [...state.proposals, report],
      ...withEntry(
        state.journal,
        'transformProposed',
        'agent',
        report.spec.kind,
        `${describeSpec(report.spec)} would change ${report.changedCount} rows, ` +
          `leave ${report.unchangedCount} unchanged and fail on ${report.failedCount}.`,
      ),
    })),

  /** New objects, never a mutation: undo needs the previous `applied` array intact. */
  commitTransform: (dataset, applied, author) =>
    set((state) => ({
      dataset,
      applied: [...state.applied, applied],
      ...withEntry(
        state.journal,
        'transformApplied',
        author,
        applied.id,
        `Applied ${describeSpec(applied.spec)} to ${applied.previousValues.size} rows.`,
      ),
    })),

  /**
   * Pops `applied` and does **not** refund `queriesUsed`.
   *
   * The budget is spent attention, not a resource — undoing a change does not un-ask the questions that led to
   * it, and refunding turns undo into a way to buy more queries.
   *
   * A no-op with nothing to undo, and silent about it: unlike a rejected k change, an undo against an empty
   * stack reveals no intent worth recording. The caller already knows from `snapshot().applied` whether there
   * was anything there, and `undo_last` is the thing that tells the agent so.
   */
  undoTransform: (dataset, author) => {
    const last = get().applied.at(-1)
    if (!last) return
    set((state) => ({
      dataset,
      applied: state.applied.slice(0, -1),
      ...withEntry(
        state.journal,
        'transformUndone',
        author,
        last.id,
        `Reverted ${describeSpec(last.spec)}; ${last.previousValues.size} rows restored. ` +
          'The query budget is not refunded.',
      ),
    }))
  },

  /* -- Gates --------------------------------------------------------------------------------------- */

  /** The `detail` is the agent's own sentence, which is safe to keep: it is the thing the human judged. */
  openReveal: (gate, request) =>
    set((state) => ({
      pendingReveal: { ...gate, request },
      ...withEntry(
        state.journal,
        'revealRequested',
        'agent',
        revealSubject(request),
        `The agent asked to see this cell. Its reason: ${request.reason}`,
      ),
    })),

  /**
   * Settle the reveal gate exactly once.
   *
   * A no-op when `pendingReveal` is already null. A double-click on Approve calls this twice; `blocking.ts`
   * makes the second `resolve` harmless, but the second journal line is not — a journal showing two granted
   * reveals for one decision overstates the cost, and a journal nobody trusts the numbers in is decoration.
   *
   * `revealsGranted` increments only when `decision.granted`, and a grant writes `revealGranted` with
   * `irreversible: true`. That flag is what makes the line red and what the header counts.
   *
   * This is also the one journal `detail` in the app that carries a cell value, and it does so on purpose: the
   * human chose to show the agent this value, and the record of *what* was shown is the entire point of the
   * line. Everything else in the journal is a decision about data, never data.
   *
   * The state update lands before `resolve` runs. The observable order is the same either way — a promise
   * continuation is a microtask, so the agent resumes after this function returns — but clearing first means a
   * throw from the resolver cannot leave a settled gate sitting in the store as still pending.
   */
  settleReveal: (decision) => {
    const pending = get().pendingReveal
    if (!pending) return
    const subject = revealSubject(pending.request)
    set((state) => ({
      pendingReveal: null,
      revealsGranted: state.revealsGranted + (decision.granted ? 1 : 0),
      ...(decision.granted
        ? withEntry(
            state.journal,
            'revealGranted',
            'human',
            subject,
            `Granted. The agent has seen this value and cannot unsee it: ${decision.value}. ` +
              `It asked because: ${pending.request.reason}`,
            { irreversible: true },
          )
        : withEntry(
            state.journal,
            'revealRefused',
            'human',
            subject,
            `Refused. The reason passed back to the agent: ${decision.reason}`,
          )),
    }))
    pending.resolve(decision)
  },

  openQuestion: (gate, question) =>
    set((state) => ({
      pendingQuestion: { ...gate, question },
      ...withEntry(
        state.journal,
        'questionAsked',
        'agent',
        gate.id,
        `${question.question} Options offered: ${question.options.join(' / ')}`,
      ),
    })),

  /** Same single-settle discipline as `settleReveal`, for the same reason: one click, one line. */
  settleQuestion: (answer) => {
    const pending = get().pendingQuestion
    if (!pending) return
    set((state) => ({
      pendingQuestion: null,
      ...withEntry(
        state.journal,
        'questionAnswered',
        'human',
        pending.id,
        `"${pending.question.question}" answered: ${answer}`,
      ),
    }))
    pending.resolve(answer)
  },

  /**
   * Clear a question nobody answered, and journal the truth about it.
   *
   * Two honesty problems, and this is the least-bad answer to both.
   *
   * The first is the card: `blocking.ts` resolves its own gate on timeout, so the agent is unblocked, but
   * nothing has told the store — `pendingQuestion` would sit there until the tab closed, showing the human
   * a decision that is no longer theirs to make.
   *
   * The second is attribution, and it is the reason this is not a call to `settleQuestion`. That action
   * records the answer as `human`, and here no human chose anything: the change-nothing option stood
   * because the timer ran out. `JournalEntry.author` is `'human' | 'agent'` and `domain.ts` is frozen, so
   * there is no third value to write. `agent` is the closer of the two lies — the human demonstrably did
   * not act — and the `detail` carries what actually happened, in words, because that is the only field
   * that can. A reader scanning the author column will read this line as the agent's; a reader who reads
   * the line gets it right.
   *
   * Tolerant of a gate that is no longer the pending one, and still journals in that case. A question wiped
   * by `loadDataset` deserves a line too, and the alternative — journalling only when the state matches —
   * loses the record exactly when the session got confusing.
   *
   * `resolve` is called last and is a no-op on the normal path, where `blocking.ts` settled the gate before
   * this was reached. It is here for the caller that expires a gate that is somehow still open: a suspended
   * tool call left waiting forever is worse than one told the safe answer twice.
   */
  expireQuestion: (gateId, optionUsed, cause) => {
    const pending = get().pendingQuestion
    const how =
      cause === 'timeout'
        ? 'nobody answered before the gate timed out'
        : 'the gate was closed when the session changed'

    if (!pending || pending.id !== gateId) {
      set((state) => ({
        ...withEntry(
          state.journal,
          'questionAnswered',
          'agent',
          gateId,
          `Question closed without a human answer: ${how}, so the change-nothing option stood by ` +
            `default: ${optionUsed}. Nobody chose it.`,
        ),
      }))
      return
    }

    set((state) => ({
      pendingQuestion: null,
      ...withEntry(
        state.journal,
        'questionAnswered',
        'agent',
        pending.id,
        `"${pending.question.question}" was not answered: ${how}, so the change-nothing option stood ` +
          `by default: ${optionUsed}. Nobody chose it.`,
      ),
    }))
    pending.resolve(optionUsed)
  },

  /* -- Journal ------------------------------------------------------------------------------------- */

  /**
   * The route for events that are not a state change — `toolCalled`, `answerSuppressed`, `budgetExhausted`,
   * `reportSubmitted`. Everything that *is* a state change journals inside its own `set` instead, so there is
   * no window in which the state and the record disagree.
   */
  record: (kind, author, subject, detail, options) =>
    set((state) => withEntry(state.journal, kind, author, subject, detail, options)),
}))

/**
 * Read the current state outside React.
 *
 * The tools need this: a tool is called from the agent, not from a component, so there is no hook context — and
 * a tool that closes over a snapshot taken at registration time reads a dataset that was replaced ten minutes
 * ago. Call it at the top of every tool invocation, not once at module load.
 */
export function snapshot(): SessionState {
  return useSession.getState()
}

/** Kept so the journal type is imported where the next person expects to find it used. */
export type JournalView = readonly JournalEntry[]
