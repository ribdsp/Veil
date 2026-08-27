/**
 * Ambient declarations for the WebMCP draft API.
 *
 * Hand-written because the spec is a W3C draft and there is no stable `@types` package yet. Keep this
 * narrow: only what we actually call. A speculative surface here would be TypeScript telling us that
 * something works when the browser disagrees.
 *
 * Spec: `document.modelContext.registerTool()`. Available behind an origin trial in Chrome 149+ and
 * Edge 150+, and via the polyfill in src/lib/webmcp/polyfill.ts everywhere else.
 */

interface ModelContextToolResponseContent {
  /**
   * Only `'text'` is specified today.
   *
   * Worth stating because it is a live constraint on Veil rather than a footnote: there is no image
   * channel, so a column profile has to be legible as prose and a masked exemplar has to be a string.
   * Everything in `lib/guard` that formats an answer is shaped by this one word.
   */
  type: 'text'
  text: string
}

interface ModelContextToolResponse {
  content: ModelContextToolResponseContent[]
  isError?: boolean
}

interface ModelContextToolDescriptor {
  name: string
  description: string
  /** JSON Schema. `unknown` rather than a modelled schema type: it is data, not a contract we own. */
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<ModelContextToolResponse>
}

interface ModelContextRegisterOptions {
  /** Deregisters the tool when aborted. Veil uses one controller for the whole surface. */
  signal?: AbortSignal
  /**
   * Which agent origins may see the tool. Omitted means the host default, which is everyone.
   *
   * Veil's privacy boundary partly rests on this: the four tools that can uncover a value, mutate the
   * dataset or end the run are registered with an explicit list, so an untrusted agent cannot call
   * them because it cannot see that they exist.
   *
   * Treat it as advisory in code. It is a young part of a young spec, and where it is unimplemented the
   * behaviour degrades to "exposed to everyone" — silently. `register-tools.ts` therefore also checks
   * the calling origin inside the trusted tools themselves, rather than trusting the browser to have
   * filtered them out. See docs/threat-model.md (T4).
   */
  exposedTo?: string[]
}

interface ModelContext extends EventTarget {
  registerTool: (
    descriptor: ModelContextToolDescriptor,
    options?: ModelContextRegisterOptions,
  ) => void
}

interface Document {
  /** Absent unless the origin trial is active or the polyfill has installed itself. */
  modelContext?: ModelContext
}
