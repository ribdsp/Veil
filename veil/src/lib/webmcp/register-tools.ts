import { installWebMcpPolyfill } from './polyfill'
import { allTools } from './tools'

/**
 * The one place every tool is registered.
 *
 * Owner: Vicko.
 *
 * Everything goes through a single `AbortController`, so unmounting deregisters the entire surface in
 * one line. Scattering `registerTool` calls across components is the version of this that leaves stale
 * tools registered after a hot reload — and the symptom is a model calling a tool whose closure points
 * at a dataset that is no longer open, which in this project means a row id addressing somebody else's
 * record.
 *
 * Called exactly once, from app/tool-surface.tsx. If you find yourself calling it from a second place,
 * that's the bug.
 */

let controller: AbortController | null = null

export type RegistrationResult = {
  mode: 'native' | 'polyfill' | 'unavailable'
  /** Registered for everyone. */
  open: string[]
  /** Registered with `exposedTo`, or with a warning if no trusted origins are configured. */
  trusted: string[]
}

/**
 * Origins allowed to see the four trusted tools.
 *
 * Read at module scope because `NEXT_PUBLIC_*` is inlined at build time — reading it inside the function
 * would look dynamic and mislead the next reader into thinking it can change at runtime.
 *
 * An empty list means every tool is exposed to everyone. That is correct for local development and
 * wrong for a deployment whose URL has been shared, so `registerTools` returns it in the result and the
 * UI says so out loud rather than leaving it to whoever reads the env file.
 */
export const TRUSTED_ORIGINS: readonly string[] = (
  process.env.NEXT_PUBLIC_VEIL_TRUSTED_ORIGINS ?? ''
)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

/**
 * Register the whole surface, replacing any previous registration.
 *
 * Idempotent by construction: the first thing it does is abort the previous controller. React Strict Mode
 * runs the mounting effect twice in development, and two copies of fourteen tools is worse than none — an
 * agent shown two `count_where` entries picks one arbitrarily, and the loser holds a closure over the
 * dataset that was open when it was registered.
 *
 * `exposedTo` is passed only when `TRUSTED_ORIGINS` is non-empty. `exposedTo: []` is not "expose to
 * nobody" in any implementation we have checked; it is undefined behaviour, and guessing which way a host
 * resolves it is how a privacy control becomes a coin flip. With no list configured, the trusted tools are
 * registered for everyone and defend themselves through `isTrustedCaller` and the human gates instead —
 * see docs/threat-model.md (T4).
 *
 * Tools stay registered when no dataset is loaded. They reply with the readable error from
 * `noDataset()`; a tool that vanishes while the app is idle teaches the agent the capability does not
 * exist, and it does not come back to check.
 */
export function registerTools(): RegistrationResult {
  // Before anything else, so a second Strict Mode pass replaces the surface rather than doubling it.
  unregisterTools()

  const mode = installWebMcpPolyfill()
  const modelContext = typeof document === 'undefined' ? undefined : document.modelContext

  if (!modelContext) {
    /*
     * No origin trial and no polyfill — which in practice means no `document` at all, since the polyfill
     * installs itself unconditionally otherwise. The UI says this plainly instead of rendering a page that
     * looks fine and does nothing: a banner naming the missing origin trial is recoverable, a silent
     * no-op is a product that reads as broken.
     */
    return { mode: 'unavailable', open: [], trusted: [] }
  }

  const active = new AbortController()
  controller = active

  const open: string[] = []
  const trusted: string[] = []

  for (const tool of allTools) {
    const isTrusted = tool.trusted === true
    const options: ModelContextRegisterOptions = { signal: active.signal }
    if (isTrusted && TRUSTED_ORIGINS.length > 0) options.exposedTo = [...TRUSTED_ORIGINS]

    modelContext.registerTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: tool.execute,
      },
      options,
    )

    if (isTrusted) trusted.push(tool.name)
    else open.push(tool.name)
  }

  /*
   * The only feedback available on whether the host actually honoured `exposedTo`. Reading a list out of
   * the console beats inferring it from an agent's behaviour, which is what the alternative amounts to:
   * noticing that a tool you thought was gated got called.
   *
   * Coalesced to one line per batch, and subscribed *after* the loop above, so the fourteen registrations
   * do not print fourteen times. Fourteen identical lines is the kind of debug output people turn off, and
   * then it is not there on the day it matters. The listener carries the same signal as the tools, so it
   * dies with the registration it describes.
   */
  const logSurface = () => {
    console.debug('[veil] tool surface', {
      mode,
      open,
      trusted,
      exposedTo:
        TRUSTED_ORIGINS.length > 0 ? [...TRUSTED_ORIGINS] : 'everyone (no trusted origins set)',
      visible:
        typeof window === 'undefined'
          ? []
          : (window.veilTools?.list() ?? []).map((tool) => tool.name),
    })
  }

  let logQueued = false
  const onToolChange = () => {
    if (logQueued) return
    logQueued = true
    queueMicrotask(() => {
      logQueued = false
      logSurface()
    })
  }
  modelContext.addEventListener('toolchange', onToolChange, { signal: active.signal })
  logSurface()

  return { mode, open, trusted }
}

/** Deregisters everything. Idempotent. */
export function unregisterTools(): void {
  controller?.abort()
  controller = null
}

/**
 * What `isTrustedCaller` decided, and why.
 *
 * Separate from the boolean because two of the three outcomes are things a human needs to know about
 * afterwards, and a `boolean` cannot carry them. Trusted tools can use `detail` verbatim as the sentence
 * they append to their response, so nobody mistakes a permissive development setup for an enforced one.
 */
export type TrustedCallerNotice = {
  /** What the host told us, if it told us anything. */
  readonly origin: string | undefined
  readonly trusted: boolean
  /** One line, written to be usable as both a `JournalEntry.detail` and a note to the model. */
  readonly detail: string
  /**
   * True when the decision was reached without an enforced list or without a caller identity — the two
   * cases a reader of the journal has to be able to find later.
   */
  readonly needsJournalling: boolean
}

let noticeObserver: ((notice: TrustedCallerNotice) => void) | null = null

/**
 * Wire up journalling for origin decisions, without this module importing the journal.
 *
 * `lib/webmcp` must not depend on `lib/journal` or `lib/store` — `register-tools.ts` is loaded during
 * registration, before either exists, and the dependency would point the wrong way besides. So the fact
 * that *something needs journalling* is published here and whoever owns the journal subscribes to it,
 * once, at start-up. Passing `null` unsubscribes.
 *
 * Only notices with `needsJournalling` reach the observer. An ordinary allow against a configured list is
 * routine and journalling every one of them would bury the two cases that are not.
 */
export function setTrustedCallerObserver(
  observer: ((notice: TrustedCallerNotice) => void) | null,
): void {
  noticeObserver = observer
}

/**
 * Whether a caller is allowed to reach a trusted tool, with the reasoning attached.
 *
 * Trusted tools that want to explain themselves to the model should call this and use `detail`;
 * `isTrustedCaller` is the same decision when only the boolean is wanted.
 */
export function checkTrustedCaller(origin: string | undefined): TrustedCallerNotice {
  if (TRUSTED_ORIGINS.length === 0) {
    /*
     * `needsJournalling` is false here on purpose. This is a build-time configuration fact, not an event:
     * it is identical on every call, and a journal line per trusted-tool call would bury the two cases
     * that genuinely are events. It is surfaced instead through `detail` — which the tool appends to its
     * response — and through `RegistrationResult.trusted`, which the header line renders.
     */
    return {
      origin,
      trusted: true,
      detail:
        'No trusted origins are configured (NEXT_PUBLIC_VEIL_TRUSTED_ORIGINS is empty), so every tool is ' +
        'exposed to every agent. This is the development default and it is not an enforced restriction.',
      needsJournalling: false,
    }
  }

  if (origin === undefined || origin.length === 0) {
    /*
     * Allow, and journal it. Failing closed here would make Veil unusable on every host that has not
     * implemented origin reporting — and it would fail closed against the honest hosts while doing nothing
     * about a dishonest one, since the origin arrives from the same host that would have filtered by it.
     * What actually protects the user at this point is not the spec: it is the reveal gate and the
     * approval a destructive transform needs. A human still has to click for anything a trusted tool can
     * do. docs/threat-model.md (T4).
     */
    return {
      origin,
      trusted: true,
      detail:
        'The agent host did not report a calling origin, so the trusted-tool origin check could not be ' +
        'applied. Allowed, and recorded here: any action this call goes on to take still needs a human ' +
        'to approve it.',
      needsJournalling: true,
    }
  }

  const trusted = TRUSTED_ORIGINS.includes(origin)
  return {
    origin,
    trusted,
    detail: trusted
      ? `Caller origin ${origin} is on the trusted list.`
      : `Caller origin ${origin} is not on the trusted list, so tools that can change data, uncover a ` +
        'value, or end the run are refused.',
    needsJournalling: !trusted,
  }
}

/**
 * Whether a caller is allowed to reach a trusted tool.
 *
 * Defence in depth, and the reason it exists is written out in docs/threat-model.md (T4): `exposedTo` is
 * a young part of a young spec, and where it is unimplemented the behaviour degrades to *exposed to
 * everyone* — silently, with no error and nothing in the console. A trusted tool that assumes the
 * browser filtered its audience is a trusted tool with no protection at all on those hosts.
 */
export function isTrustedCaller(origin: string | undefined): boolean {
  const notice = checkTrustedCaller(origin)
  if (notice.needsJournalling) noticeObserver?.(notice)
  return notice.trusted
}

export { allTools }
