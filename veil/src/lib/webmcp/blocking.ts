import type { Gate } from '@/types/domain'

/**
 * The human-in-the-loop gate.
 *
 * Owner: Vicko. Contract: docs/tools.md § The human gates.
 *
 * Two tools don't return until a person acts — `request_reveal` and `ask_human`. That is the mechanism
 * behind the claim that the human is a tool inside the agent's loop rather than a spectator watching it
 * work.
 *
 * ## Fail closed, and why that differs from the obvious design
 *
 * The hard part isn't waiting, it's the tolerance of whichever host is running the agent. Nobody
 * publishes how long a pending tool call is allowed to stay pending, and the answer differs between an
 * in-app browser, an extension inspector, and a bare Chrome tab. So a gate must never be left
 * unresolved: an abandoned tool call reads to the model as a broken page.
 *
 * The usual way out is a ticket — resolve with "still pending, retry with this id" and let the agent
 * poll. **Veil deliberately does not do that.** A retry loop around a reveal request means an
 * unattended tab gets asked for the same value every few seconds until something gives, and the whole
 * value of the feature is that walking away from Veil is safe. So each gate carries its own *fail-closed
 * default*: the timeout resolves with the answer that discloses least, once, and the call is over.
 *
 * For `request_reveal` that default is `{ granted: false, reason: 'no response' }`. For `ask_human` it
 * is the last option, which is why the last option must always be the one that changes nothing.
 *
 * The cost is real and worth naming: a human who steps away for thirty seconds loses a decision they
 * would have made, and the agent has to carry on without it. That is the correct direction to fail in a
 * tool whose entire premise is that the data stays put.
 */

/**
 * How long a gate waits for a person.
 *
 * TODO(vicko), Day 2: measure this rather than guessing it. Call a blocking tool from each agent host
 * we intend to demo on, increase the wait until the host gives up on the pending call, and set this
 * comfortably under the smallest number you find. 25s is chosen to be survivable, not correct.
 *
 * Two competing pressures, so the measurement matters: too short and a human reading a reveal request
 * carefully gets timed out mid-thought; too long and the host abandons the call, which loses the
 * decision *and* leaves the agent with no answer at all.
 */
export const GATE_TIMEOUT_MS = 25_000

type PendingEntry = {
  resolve: (value: unknown) => void
  createdAt: number
  /**
   * This gate's own fail-closed default — the same value the timeout would have used.
   *
   * Stored per gate rather than derived, because `abandonAllGates` has no idea what kind of gate it is
   * closing and there is no safe generic answer: `request_reveal` needs `{ granted: false }` and
   * `ask_human` needs its last option. `unknown` here for the same reason `resolve` is: the map is
   * heterogeneous, and the type is recovered by the fact that the fallback stored alongside a resolver is
   * the one the resolver's own `createGate<T>` call produced.
   */
  fallback: unknown
}

/** Gates live for the tab's lifetime. There is no server, so there is nothing to expire against. */
const pending = new Map<string, PendingEntry>()

function newGateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Create a gate, and the promise the tool returns to the agent.
 *
 * Resolves once and only once: whichever of the human and the timeout arrives first wins, the timer is
 * cleared, and a late `resolve()` is a no-op rather than a second reply to a model that has already
 * moved on. That guarantee is why `settle` is nulled before use rather than after — a human clicking at
 * the same millisecond the timer fires must not produce two answers.
 *
 * `onTimeout` is a value, not a callback, on purpose. A callback invites computing the fallback at
 * timeout time, which is when the calling tool is no longer on the stack and the safe answer is
 * hardest to reason about. Deciding it up front means the fail-closed default is written next to the
 * request that needs it.
 */
export function createGate<T>(
  prefix: string,
  onTimeout: T,
  timeoutMs = GATE_TIMEOUT_MS,
): { gate: Gate<T>; promise: Promise<T> } {
  const id = newGateId(prefix)
  const createdAt = Date.now()

  let settle: ((value: T) => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const promise = new Promise<T>((resolve) => {
    settle = resolve
    timer = setTimeout(() => {
      if (!settle) return
      const done = settle
      settle = null
      pending.delete(id)
      done(onTimeout)
    }, timeoutMs)
  })

  const resolveWith = (value: T) => {
    if (!settle) return
    if (timer !== null) clearTimeout(timer)
    const done = settle
    settle = null
    pending.delete(id)
    done(value)
  }

  pending.set(id, {
    resolve: resolveWith as (value: unknown) => void,
    createdAt,
    fallback: onTimeout,
  })

  return {
    gate: { id, createdAt, expiresAt: createdAt + timeoutMs, resolve: resolveWith },
    promise,
  }
}

/**
 * Deliver a human's answer to whichever gate is waiting on it.
 *
 * Called from UI code — the reveal request card and the question card. Returns false when the id is
 * unknown, which happens legitimately: the human may answer a question that already timed out, and the
 * UI needs to be able to tell them so instead of pretending the click landed.
 *
 * Two routes exist and both are kept, deliberately. `Gate.resolve` is part of the frozen `domain.ts`
 * contract and the UI cards hold the gate object itself, so it cannot be withdrawn; this id-addressed
 * route is what the console and the inspector can reach without a reference to a live object. They are
 * safe to keep side by side because they are not two mechanisms: `answerGate` looks the gate up and calls
 * the very same `resolveWith` closure that `gate.resolve` is, and that closure nulls `settle` before using
 * it. Double-settling is therefore impossible whichever door the answer comes through, including a human
 * clicking in the same millisecond the timer fires.
 *
 * What the two routes do differ in is the *false* return: `answerGate` can tell a caller the gate is gone,
 * where `gate.resolve()` on a settled gate is a silent no-op. That is why UI that needs to say "too late,
 * this one timed out" should prefer this function.
 */
export function answerGate<T>(id: string, value: T): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  entry.resolve(value)
  return true
}

/** Gates still waiting. What the UI badge counts, and useful in the inspector. */
export function pendingGateIds(): string[] {
  return [...pending.keys()]
}

/**
 * Abandon every open gate with its fail-closed default.
 *
 * Called when the tool surface unmounts (`app/tool-surface.tsx`) and, once the store lands, when a new
 * dataset is loaded. The second call site is the one that matters: a reveal request pointing at row 903 of
 * a file that is no longer open is worse than useless — the row id now addresses somebody else's record,
 * and approving it would disclose a value the agent never asked about. **That call belongs to
 * `lib/store/dataset.ts` and is not wired up here**, because loading a dataset is the store's event to
 * publish, not this module's to observe.
 *
 * Each gate resolves with the fallback `PendingEntry` recorded at creation, never with `undefined`:
 * `undefined` would typecheck through the `unknown` cast on `resolve` and then fail inside whichever tool
 * was waiting, which turns a safe abandonment into a thrown exception in a suspended tool call.
 *
 * Iterates a snapshot because each `resolve` deletes its own entry from the map while we are walking it.
 * The `clear()` afterwards is belt and braces: every settle path already removes its own key, and this
 * makes "no gate survives this call" true by construction rather than by every resolver remembering to.
 */
export function abandonAllGates(): void {
  for (const entry of [...pending.values()]) entry.resolve(entry.fallback)
  pending.clear()
}
