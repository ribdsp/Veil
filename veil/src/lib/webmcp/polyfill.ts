import type { ToolDefinition, ToolResponse } from './tool-types'

/**
 * A minimal stand-in for `document.modelContext` when the origin trial isn't available.
 *
 * Owner: Vicko.
 *
 * Good enough to build against; **not** good enough to judge a schema by. A polyfill will happily accept
 * a description that a real model misreads, so a tool is not "working" until it has been called by an
 * actual agent — see CONTRIBUTING.md, "Testing a tool".
 *
 * It also exposes `window.veilTools` so tools can be called by hand from the devtools console:
 *
 *   await veilTools.call('profile_column', { column: 'phone' })
 *   await veilTools.call('count_where', {
 *     conditions: [{ kind: 'matchesFormat', column: 'phone', format: 'unrecognised' }], join: 'all' })
 *
 * That console handle is how most of this project will actually get debugged, which is worth more than
 * it looks. It is also the fastest way to check a suppression path: craft a predicate you know matches
 * three rows and read the refusal.
 *
 * One thing the polyfill deliberately does **not** simulate: `exposedTo`. It records the option and
 * ignores it, and `list()` shows every tool regardless. Pretending to enforce origin filtering locally
 * would let us ship believing the trusted-tool split works, when the only place that can be verified is
 * a browser with the real implementation. See docs/threat-model.md (T4) — this is exactly why the
 * trusted tools re-check the caller themselves.
 */

export type VeilToolsHandle = {
  list: () => { name: string; description: string; trusted: boolean }[]
  call: (name: string, args?: Record<string, unknown>) => Promise<ToolResponse>
}

declare global {
  interface Window {
    veilTools?: VeilToolsHandle
  }
}

/**
 * TODO(vicko), Day 1:
 *   - if `document.modelContext` exists, install nothing and return 'native' — never shadow the real
 *     implementation, or you will spend an afternoon debugging the polyfill's behaviour on a browser
 *     that had the real thing all along
 *   - otherwise define `document.modelContext` with `registerTool`, honouring `options.signal` by
 *     removing the tool on abort, and dispatching a `toolchange` event on every add and remove
 *   - always install `window.veilTools`, native or not: the console handle is useful either way
 */
export function installWebMcpPolyfill(): 'native' | 'polyfill' {
  throw new Error('installWebMcpPolyfill: not implemented')
}

/** Registry backing the polyfill. Exported so the console handle and the shim share one source. */
export const polyfillRegistry = new Map<string, ToolDefinition>()
