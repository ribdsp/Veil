import { refusals, REFUSAL_KINDS, revealsGranted } from '@/lib/journal/journal'
import { useSession, type GateExpiry } from '@/lib/store/dataset'
import type { HumanQuestion, JournalEventKind } from '@/types/domain'

import { abandonAllGates, createGate, GATE_TIMEOUT_MS } from './blocking'
import type { TrustedCallerNotice } from './register-tools'

/**
 * The one place the tool layer reaches session state.
 *
 * Owner: Vicko. Required reading before you extend it: CONTRIBUTING.md rule 1 and
 * `lib/guard/no-leak.test.ts`.
 *
 * That test greps every file in `lib/webmcp/tools/` and fails the build if one imports
 * `@/lib/store/dataset` — reaching the parsed file through React state is the same read as reaching it
 * through `lib/data`, with more steps. Two tools nonetheless have to touch the session: `ask_human` puts a
 * question into it and `submit_cleanup_report` reads the record back out. This module is the route, and it
 * sits outside `tools/` precisely so the grep keeps meaning what it says.
 *
 * ## Why this is a set of verbs and not an accessor
 *
 * A bridge that exported `getState()` would satisfy the grep and defeat its own purpose: every tool would
 * hold the dataset again, one property access away. So there is deliberately no function here that returns
 * `SessionState`, none that returns a `Dataset`, and none that returns a `JournalEntry` — entries are
 * summarised into `kind` and `subject` before they leave, because a `revealGranted` line's `detail` is the
 * one place in the journal that carries a cell value.
 *
 * `dataset.sourceName` never leaves this module either. `domain.ts` marks it *"Never sent to the model"*,
 * and it is a name the human typed — often a person's name, a client's, or a date they would not have
 * chosen to hand to a remote service. `hasDataset()` answers the only question a tool actually has.
 *
 * ## What else lives here
 *
 * Two wirings that `register-tools.ts` and `lib/store/dataset.ts` each decline to make, because making
 * them would point a dependency the wrong way:
 *
 *  - **Origin decisions reach the journal.** `register-tools.ts` publishes a `TrustedCallerNotice` and does
 *    not import the journal; this is the subscriber it documents.
 *  - **A dataset change abandons every open gate.** A pending reveal for row 903 of a file that is no
 *    longer open addresses a different person's record. The store publishes the change; this observes it,
 *    so `lib/store` stays free of the tool surface.
 */

/* -------------------------------------------------------------------------------------------------
 * Installation
 * ---------------------------------------------------------------------------------------------- */

let installed = false
let unsubscribe: (() => void) | null = null
let unwireObserver: (() => void) | null = null

/**
 * Subscribe to the store, so a change of file abandons every open gate.
 *
 * Idempotent, and called by every exported function below rather than at module scope. Lazy on purpose:
 * see `wireOriginObserver` for the load-order trap that makes eager wiring unsafe here.
 */
export function installSessionBridge(): void {
  if (installed) return
  installed = true

  unsubscribe = useSession.subscribe((state, previous) => {
    /*
     * A change of *file*, not of the `dataset` object. `commitTransform` and `undoTransform` both install a
     * new `Dataset` for the same open file, and abandoning a human's pending decision because a transform
     * landed would fail closed for no reason at all. A transform never renames the file and never changes
     * the row count, so this pair identifies a load or a clear rather than a rewrite.
     *
     * Residual case, stated rather than hidden: re-opening a *different* file that happens to share the
     * name and the row count does not trip this. By then the store has already dropped `pendingReveal` and
     * `pendingQuestion`, so the card is off the screen and the gate fails closed on its own timeout seconds
     * later. The agent is told no; nothing is disclosed.
     */
    const sameFile =
      state.dataset?.sourceName === previous.dataset?.sourceName &&
      state.dataset?.rowCount === previous.dataset?.rowCount
    if (!sameFile) abandonAllGates()
  })
}

/** What an origin decision looks like in the record. One line, and the notice's own sentence. */
function journalOriginNotice(notice: TrustedCallerNotice): void {
  /*
   * The kind is `datasetLoaded`, and it is a borrow rather than a fit. The frozen `JournalEventKind` has
   * nothing for an access decision, and the two candidates each cost something: `toolCalled` would inflate
   * the `toolCalls` figure in the export summary — a wrong number in the artefact somebody keeps — while
   * `datasetLoaded` is the one session-scope kind no export counter reads, which is why `dataset.ts` already
   * borrows it for a cleared file and for a rejected change of k. A misfiled label a reader can see beats a
   * plausible number they cannot check. The subject says what it really is.
   *
   * The author is `agent`: an agent's call is what triggered the check, and nobody clicked anything.
   */
  useSession.getState().record('datasetLoaded', 'agent', 'origin check', notice.detail)
}

/**
 * Wire the journal to `register-tools.ts`'s origin decisions — the call site that module documents and
 * deliberately does not make itself.
 *
 * `register-tools` is reached by a dynamic `import` with a literal specifier, and both halves of that are
 * deliberate.
 *
 * *Dynamic*, because a static import here closes a cycle: `register-tools` imports `polyfill`, which imports
 * `tools/index`, which imports every tool, and the tools import this module. ESM tolerates a cycle only as
 * long as nothing runs at module scope that needs the other side to be finished — and `tools/index` builds
 * `trustedToolNames` at module scope. Load any single tool file first and `index` is re-entered mid-way,
 * `submitCleanupReport` is still uninitialised, and the whole surface fails to load with an error that names
 * neither cause. Keeping the edge out of load time removes the trap rather than documenting it.
 *
 * *A literal specifier*, because CONTRIBUTING.md rule 2 bans a dynamic import of a model-supplied string.
 * This one is a constant written here; nothing from the agent reaches it.
 */
async function wireOriginObserver(): Promise<void> {
  if (unwireObserver !== null) return
  const { setTrustedCallerObserver } = await import('./register-tools')
  setTrustedCallerObserver(journalOriginNotice)
  unwireObserver = () => setTrustedCallerObserver(null)
}

/** Undo both wirings. For an unmounting surface, and for a test that wants a clean module. */
export function stopSessionBridge(): void {
  installed = false
  unsubscribe?.()
  unsubscribe = null
  unwireObserver?.()
  unwireObserver = null
}

/* -------------------------------------------------------------------------------------------------
 * The origin check, with its journalling attached
 * ---------------------------------------------------------------------------------------------- */

/**
 * Whether this call may reach a trusted tool, and the sentence explaining why.
 *
 * A thin wrapper over `register-tools.ts`, and the reason a trusted tool comes through here instead of
 * calling that module directly is ordering. `isTrustedCaller` is the call that notifies the observer, and
 * the observer is wired by `wireOriginObserver`, which cannot be wired at module scope. A tool that called
 * `isTrustedCaller` as its first statement would lose the notice on the *first* call of the session — the
 * one most likely to be the interesting one. Going through here makes that impossible to forget, and keeps
 * the tool layer's only runtime dependency this module.
 *
 * `checkTrustedCaller` is then called for the sentence. It is the same pure decision a second time and
 * deliberately does not notify, so this produces one journal line rather than two.
 *
 * On WebMCP as it stands, `origin` is always `undefined`: `execute(args)` is the entire signature a tool
 * gets and no caller identity rides along, so every call lands on the "the host did not report an origin"
 * branch. That is docs/threat-model.md (T4) rather than a gap here, and it is why the human gates are the
 * control that does not depend on the spec.
 */
export async function checkTrustedCall(
  origin?: string,
): Promise<{ readonly allowed: boolean; readonly detail: string }> {
  installSessionBridge()
  await wireOriginObserver()
  const { checkTrustedCaller, isTrustedCaller } = await import('./register-tools')
  const allowed = isTrustedCaller(origin)
  return { allowed, detail: checkTrustedCaller(origin).detail }
}

/* -------------------------------------------------------------------------------------------------
 * Asking a person
 * ---------------------------------------------------------------------------------------------- */

/**
 * What became of a question.
 *
 * `answered` and `unanswered` carry the same `answer` field on purpose — the fail-closed default *is* the
 * answer the agent has to work with, and a shape that made the timeout case answerless would push every
 * caller into inventing its own fallback. What differs is the attribution, and the attribution is the whole
 * reason this is a union: a tool that cannot tell the two apart tells the model "the human chose this", and
 * that sentence then turns up in a report over somebody's name.
 *
 * `busy` is not an error either. It means a question is already on screen and unanswered, and a second card
 * would overwrite the first — orphaning a suspended tool call until its own timeout.
 */
export type QuestionOutcome =
  | { readonly status: 'answered'; readonly answer: string }
  | { readonly status: 'unanswered'; readonly answer: string; readonly cause: GateExpiry }
  | { readonly status: 'busy' }

/**
 * Put a question on screen and block until somebody answers it or the gate closes.
 *
 * `failClosedTo` is passed in rather than derived from `question.options` here, following `createGate`'s own
 * reasoning: the safe answer belongs next to the request that needs it, where a reader can see it is the
 * change-nothing option. `ask_human` guarantees it is the last one.
 *
 * `timeoutMs` exists for the same reason `GATE_TIMEOUT_MS` still carries a TODO — the tolerable wait is a
 * property of the agent host and has not been measured yet. Tools pass nothing and get the default.
 */
export async function askHumanQuestion(
  question: HumanQuestion,
  failClosedTo: string,
  timing?: { timeoutMs?: number },
): Promise<QuestionOutcome> {
  installSessionBridge()

  if (useSession.getState().pendingQuestion !== null) return { status: 'busy' }

  const { gate, promise } = createGate<string>(
    'ask',
    failClosedTo,
    timing?.timeoutMs ?? GATE_TIMEOUT_MS,
  )
  useSession.getState().openQuestion(gate, question)

  const answer = await promise

  /*
   * Who answered, decided from the record rather than from the absence of a pending gate.
   *
   * `settleQuestion` is the only thing in the app that writes a `questionAnswered` line as `human`, and it
   * writes the gate id as the subject. Looking for that line is exact, where looking at `pendingQuestion`
   * is not: `loadDataset` clears that too, and a question wiped by a file change would then be reported
   * back to the model as a human's considered choice.
   */
  const answeredByHuman = useSession
    .getState()
    .journal.some(
      (line) =>
        line.kind === 'questionAnswered' && line.subject === gate.id && line.author === 'human',
    )
  if (answeredByHuman) return { status: 'answered', answer }

  /*
   * Nobody answered. `blocking.ts` has already resolved the promise with the fail-closed default, so the
   * agent is unblocked — but the store still holds the pending question, the card would sit on screen for
   * the rest of the session, and the journal says only that the question was asked. Routing this through
   * `settleQuestion` would clear the card and record a *human* answer, which is a lie in the one artefact
   * whose entire value is attribution.
   */
  const cause: GateExpiry = Date.now() >= gate.expiresAt ? 'timeout' : 'abandoned'
  useSession.getState().expireQuestion(gate.id, answer, cause)
  return { status: 'unanswered', answer, cause }
}

/* -------------------------------------------------------------------------------------------------
 * Journalling on a tool's behalf
 * ---------------------------------------------------------------------------------------------- */

/**
 * One line per tool call, for tools whose work is not itself a state change.
 *
 * Kind-specific rather than a `record` passthrough: a bridge forwarding an arbitrary
 * `(kind, author, subject, detail)` would let any tool file any event as `human`, and the journal's author
 * column is load-bearing — it is how somebody answers "did I do that or did it?" six weeks later. Every
 * helper here fixes the author at `agent`, because a tool call is by definition the agent acting.
 */
export function journalToolCall(tool: string, detail: string): void {
  installSessionBridge()
  useSession.getState().record('toolCalled', 'agent', tool, detail)
}

/** The report the agent files at the end. `SessionState` has no field for one, so this is where it lives. */
export function journalReportSubmitted(detail: string): void {
  installSessionBridge()
  useSession.getState().record('reportSubmitted', 'agent', 'cleanup report', detail)
}

/**
 * The report disagrees with the record.
 *
 * Its own line rather than a sentence appended to the report's, because the point is that it has to be
 * visible to somebody scanning the journal who never reads the report. Filed under the same kind and
 * subject as the report it is about, so the pair reads as one event in two lines.
 */
export function journalReportDiscrepancy(detail: string): void {
  installSessionBridge()
  useSession.getState().record('reportSubmitted', 'agent', 'cleanup report', detail)
}

/* -------------------------------------------------------------------------------------------------
 * Reading the session's own facts
 * ---------------------------------------------------------------------------------------------- */

/** Whether a file is open. The only question about the dataset a tool may ask through here. */
export function hasDataset(): boolean {
  installSessionBridge()
  return useSession.getState().dataset !== null
}

/**
 * One thing the agent asked for and did not get.
 *
 * `kind` and `subject` only — no `detail`. The detail on a refusal is safe today, but a summary carrying it
 * would be one edit away from carrying a `revealGranted` detail, and that field holds the cell value the
 * human agreed to show. Kind and subject are enough to name what was left out, which is all
 * `submit_cleanup_report` needs.
 */
export type OpenRefusal = {
  readonly kind: JournalEventKind
  readonly subject: string
}

/**
 * Everything the record says was refused, suppressed, or ran out of budget, in the order it happened.
 *
 * Membership is `REFUSAL_KINDS` from `lib/journal/journal.ts` and is not re-derived here: it is a product
 * decision about what an agent may not silently drop from its report, and two copies of that list is one
 * copy nobody updates.
 */
export function sessionRefusals(): readonly OpenRefusal[] {
  installSessionBridge()
  return refusals(useSession.getState().journal).map((line) => ({
    kind: line.kind,
    subject: line.subject,
  }))
}

/** The kinds `sessionRefusals` counts, so a tool can tell the model what it is measured against. */
export const REFUSAL_KIND_NAMES: readonly string[] = [...REFUSAL_KINDS]

/**
 * Reveals asked for and reveals granted, derived from the journal.
 *
 * Derived rather than read from the store's `revealsGranted` counter, for the reason `lib/journal` gives: a
 * counter can drift from the record, and when it does the record is the thing that is true.
 */
export function revealTally(): { readonly requested: number; readonly granted: number } {
  installSessionBridge()
  const journal = useSession.getState().journal
  return {
    requested: journal.filter((line) => line.kind === 'revealRequested').length,
    granted: revealsGranted(journal),
  }
}
