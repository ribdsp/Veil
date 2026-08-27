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
 * TODO(vicko), Day 3:
 *   - install the polyfill first, then read `document.modelContext`
 *   - if it is still absent, return `unavailable` with empty lists and let the UI say so plainly — a
 *     banner naming the missing origin trial beats a page that looks fine and does nothing
 *   - register every entry in `allTools` with `{ signal: controller.signal }`
 *   - for entries with `trusted: true`, add `exposedTo: TRUSTED_ORIGINS` — but only when the list is
 *     non-empty. Passing `exposedTo: []` is not "expose to nobody" in any implementation we have
 *     checked; it is undefined behaviour, and guessing which way a host resolves it is how a privacy
 *     control becomes a coin flip
 *   - keep tools registered when no dataset is loaded. They reply with a readable error instead; a tool
 *     that vanishes when idle makes the agent believe the capability doesn't exist
 *
 * TODO(vicko), Day 3: subscribe to `toolchange` and log the resulting tool list once, at debug level.
 * It is the only feedback available on whether the host actually honoured `exposedTo`, and reading it
 * from the console beats inferring it from an agent's behaviour.
 */
export function registerTools(): RegistrationResult {
  throw new Error('registerTools: not implemented')
}

/** Deregisters everything. Idempotent. */
export function unregisterTools(): void {
  controller?.abort()
  controller = null
}

/**
 * Whether a caller is allowed to reach a trusted tool.
 *
 * Defence in depth, and the reason it exists is written out in docs/threat-model.md (T4): `exposedTo` is
 * a young part of a young spec, and where it is unimplemented the behaviour degrades to *exposed to
 * everyone* — silently, with no error and nothing in the console. A trusted tool that assumes the
 * browser filtered its audience is a trusted tool with no protection at all on those hosts.
 *
 * TODO(vicko), Day 4:
 *   - return true when TRUSTED_ORIGINS is empty (development), and say so in the tool's response so
 *     nobody mistakes a permissive dev setup for an enforced one
 *   - otherwise compare against the calling agent's origin
 *   - if the host does not tell us the origin, **allow and journal it**. Failing closed here would make
 *     Veil unusable on every host that hasn't implemented the field, and the human still has to click
 *     for anything a trusted tool can actually do — the reveal gate and destructive-transform approval
 *     are the controls that do not depend on the spec
 */
export function isTrustedCaller(_origin: string | undefined): boolean {
  throw new Error('isTrustedCaller: not implemented')
}

export { allTools }
