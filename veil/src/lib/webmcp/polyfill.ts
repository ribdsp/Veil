import { allTools } from './tools'
import {
  toolError,
  type JsonSchemaNode,
  type ToolDefinition,
  type ToolInputSchema,
  type ToolResponse,
} from './tool-types'

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

/** The event both the shim and the native implementation use to say "the tool list changed". */
const TOOL_CHANGE = 'toolchange'

/**
 * What each tool was registered with, recorded and then ignored.
 *
 * Kept out of `polyfillRegistry` because it is not part of a tool's definition — it is a fact about one
 * registration. Reading it back from the console is the only way to check *locally* that
 * `register-tools.ts` decided the exposure we expected. Whether a host then honours it is a different
 * question, and one this file is explicitly not in a position to answer.
 */
const recordedExposure = new Map<string, readonly string[]>()

/** What `exposedTo` was recorded for a tool, or `undefined` if it was registered for everyone. */
export function recordedExposureOf(name: string): readonly string[] | undefined {
  return recordedExposure.get(name)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the `trusted` flag off a descriptor the WebMCP types do not know about.
 *
 * `trusted` is Veil's own field, not the spec's: `register-tools.ts` translates it into `exposedTo` before
 * handing the descriptor over. The shim reads it anyway when it is present, so `list()` can label the four
 * gated tools even in development, where `TRUSTED_ORIGINS` is empty and no `exposedTo` is passed at all.
 */
function readTrustedFlag(descriptor: unknown): boolean {
  if (!isRecord(descriptor)) return false
  return descriptor.trusted === true
}

/**
 * Narrow a host-shaped JSON Schema back into the subset `ToolDefinition` declares.
 *
 * The schema is data rather than a contract we own — the same reason `webmcp.d.ts` types it as
 * `Record<string, unknown>` — so this keeps the shape it can vouch for and passes each property node
 * through. `additionalProperties` is forced to `false` rather than copied: every Veil tool sets it, and a
 * registry entry claiming otherwise would misreport the one schema property `registry.test.ts` exists to
 * protect.
 */
function narrowInputSchema(schema: Record<string, unknown>): ToolInputSchema {
  const properties: Record<string, JsonSchemaNode> = {}
  if (isRecord(schema.properties)) {
    for (const [key, node] of Object.entries(schema.properties)) {
      // The one cast in this file: the node came from outside, every field of `JsonSchemaNode` is
      // optional, and there is nothing left to check that `isRecord` has not already established.
      properties[key] = isRecord(node) ? (node as JsonSchemaNode) : {}
    }
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : undefined
  return { type: 'object', properties, required, additionalProperties: false }
}

function toRegistryEntry(
  descriptor: ModelContextToolDescriptor,
  exposedTo: readonly string[] | undefined,
): ToolDefinition {
  return {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: narrowInputSchema(descriptor.inputSchema),
    trusted: readTrustedFlag(descriptor) || exposedTo !== undefined,
    execute: descriptor.execute,
  }
}

/**
 * The shim itself.
 *
 * An `EventTarget` subclass rather than an object literal with a hand-rolled listener list, because
 * `register-tools.ts` subscribes to `toolchange` with `addEventListener(..., { signal })`, and that only
 * works against a real `EventTarget`. Hand-rolling it produces a listener nothing ever removes, which
 * after a few hot reloads is a console full of stale tool lists from dead registrations.
 */
class VeilModelContext extends EventTarget implements ModelContext {
  registerTool(
    descriptor: ModelContextToolDescriptor,
    options?: ModelContextRegisterOptions,
  ): void {
    const exposedTo = options?.exposedTo === undefined ? undefined : [...options.exposedTo]
    const entry = toRegistryEntry(descriptor, exposedTo)

    /*
     * Identity, not name, decides whether an abort still applies. Registering the same name twice
     * replaces the entry, and the losing registration's signal may abort long afterwards — an abort keyed
     * on the name alone would then deregister the *live* tool. That is exactly the bug this file exists to
     * avoid: an agent holding a tool list the page no longer agrees with.
     */
    const removeIfCurrent = () => {
      if (polyfillRegistry.get(entry.name) !== entry) return
      polyfillRegistry.delete(entry.name)
      recordedExposure.delete(entry.name)
      this.dispatchEvent(new Event(TOOL_CHANGE))
    }

    polyfillRegistry.set(entry.name, entry)
    if (exposedTo === undefined) recordedExposure.delete(entry.name)
    else recordedExposure.set(entry.name, exposedTo)

    const signal = options?.signal
    if (signal !== undefined) {
      if (signal.aborted) {
        // An already-aborted signal must not leave the tool registered, and `addEventListener` would
        // never fire for it. Removing here — after the add — also keeps `toolchange` firing both ways.
        removeIfCurrent()
        return
      }
      signal.addEventListener('abort', removeIfCurrent, { once: true })
    }

    this.dispatchEvent(new Event(TOOL_CHANGE))
  }
}

/**
 * Every tool the console handle can reach, registry entries winning.
 *
 * The registry holds what was actually registered; `allTools` is what Veil defines. Merging them is what
 * makes `window.veilTools` work in all three modes, and native is the case that matters: with the origin
 * trial active, `registerTool` goes to the browser's implementation and this registry stays empty, so a
 * registry-only handle would report "no tools" on the one browser where everything works. The merge is
 * also what makes the `unavailable` message in `tool-surface.tsx` truthful — driving the tools by hand has
 * to be possible precisely when registration was not.
 *
 * Insertion order puts `allTools` first, which keeps `list()` in the order a model should meet them;
 * `tools/index.ts` explains why that order is not cosmetic.
 */
function knownTools(): ToolDefinition[] {
  const merged = new Map<string, ToolDefinition>()
  for (const tool of allTools) merged.set(tool.name, tool)
  for (const [name, registered] of polyfillRegistry) {
    const declared = merged.get(name)
    if (declared === undefined) {
      merged.set(name, registered)
      continue
    }
    /*
     * The registered entry wins on everything except `trusted`, which is OR-ed with what the definition
     * declared. `register-tools.ts` translates `trusted` into `exposedTo` and passes nothing when
     * `TRUSTED_ORIGINS` is empty, so in development the registered descriptor carries no trust marking at
     * all — and a console handle that then reported `request_reveal` as an ordinary open tool would be
     * describing the exact distinction a person opened the console to check.
     */
    merged.set(name, {
      ...registered,
      trusted: registered.trusted === true || declared.trusted === true,
    })
  }
  return [...merged.values()]
}

/**
 * Install `window.veilTools`, native or not.
 *
 * `PRD.md`'s definition of done depends on this working for a judge whose browser has no origin trial, so
 * it is not a development convenience — it is the fallback interface to the entire product.
 */
function installConsoleHandle(): void {
  if (typeof window === 'undefined') return

  window.veilTools = {
    list: () =>
      knownTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        trusted: tool.trusted === true,
      })),
    call: async (name, args = {}) => {
      const tools = knownTools()
      const tool = tools.find((candidate) => candidate.name === name)
      if (!tool) {
        // A readable answer rather than a throw, for the same reason a tool never throws: the next thing
        // that happens is a person reading this string and correcting the call.
        return toolError(
          `Unknown tool '${name}'. Registered tools: ${tools
            .map((candidate) => candidate.name)
            .join(', ')}.`,
        )
      }
      try {
        return await tool.execute(args)
      } catch (error) {
        /*
         * The console handle is the one caller that has to survive a throw. Tools are not allowed to
         * throw, but several are stubs today and the `lib/` functions under them throw `not implemented` —
         * letting that become an unhandled rejection would hide which tool it came from.
         */
        const detail = error instanceof Error ? error.message : String(error)
        return toolError(`Tool '${name}' threw instead of returning an error response: ${detail}`)
      }
    },
  }
}

/**
 * Install the shim unless the browser already has the real thing.
 *
 * Returns which implementation is in play. `'native'` means no shim was installed at all: shadowing a real
 * `document.modelContext` means debugging the polyfill's behaviour on a browser that had the real
 * implementation the whole time, and the symptom — tools that work locally and not in front of a judge —
 * shows up far too late to be cheap.
 *
 * Under SSR there is no `document` to install onto, so nothing is installed. `'polyfill'` remains the
 * honest answer to "is the native implementation present", and `register-tools.ts` re-reads
 * `document.modelContext` afterwards, so a no-op here is reported as `unavailable` rather than mistaken
 * for a working surface.
 *
 * Calling it twice is safe and, in development, guaranteed: React Strict Mode runs the mounting effect
 * twice. The second call finds a `modelContext` already in place, and it has to recognise its *own* shim —
 * otherwise it reports `'native'`, the status line says `native`, and the next hour goes into wondering why
 * the origin trial appears to be working when it isn't.
 */
export function installWebMcpPolyfill(): 'native' | 'polyfill' {
  if (typeof document === 'undefined') {
    installConsoleHandle()
    return 'polyfill'
  }

  const existing = document.modelContext
  if (existing) {
    installConsoleHandle()
    return existing instanceof VeilModelContext ? 'polyfill' : 'native'
  }

  document.modelContext = new VeilModelContext()
  installConsoleHandle()
  return 'polyfill'
}

/** Registry backing the polyfill. Exported so the console handle and the shim share one source. */
export const polyfillRegistry = new Map<string, ToolDefinition>()
