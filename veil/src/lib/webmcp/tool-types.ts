/**
 * Shared shapes and response helpers for the tool surface.
 *
 * Owner: Vicko.
 *
 * The single most consequential fact about WebMCP tool responses: `content` accepts `"text"` and, as of
 * the current draft, nothing else. An `"image"` content type is an open question. That is the constraint
 * that shaped this whole project — a column profile has to be legible as prose, and a masked exemplar
 * has to be a string a model can read and reason about.
 *
 * The second most consequential fact is local to Veil: **a refusal is a normal response, not an error.**
 * `toolError` is for a malformed call. Being told "that answer would describe three people, so here is
 * why you can't have it" is the tool working exactly as designed, and marking it `isError` teaches the
 * agent to treat privacy as a fault to route around.
 */

import type { RefusalCode, Verdict } from '@/types/domain'

export type ToolResponse = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

/**
 * The subset of JSON Schema these tools use.
 *
 * Deliberately narrow. A `Record<string, unknown>` would accept every schema we might ever write and
 * also every typo, and the failure mode of a mistyped schema key is silent: the host ignores it, the
 * model never sees the constraint, and the tool looks like it works until something calls it wrong.
 */
export type JsonSchemaNode = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  /** Written for a model. One sentence on what the field means, plus an example when the format is not obvious. */
  description?: string
  enum?: readonly (string | number)[]
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  required?: readonly string[]
  additionalProperties?: boolean
  minimum?: number
  maximum?: number
}

/**
 * Every tool takes an object, and `additionalProperties: false` is required rather than optional: a
 * closed schema turns a hallucinated argument into an error the model can correct, where an open one
 * turns it into silence.
 */
export type ToolInputSchema = {
  type: 'object'
  properties: Record<string, JsonSchemaNode>
  required?: readonly string[]
  additionalProperties: false
}

export type ToolDefinition = {
  name: string
  /**
   * Part of the interface, not documentation. A tool whose description doesn't say *when* to use it gets
   * used at the wrong moment, and that reads to a judge as a broken product rather than a vague
   * sentence. `request_reveal` in particular must state that reveals are expensive, logged, and
   * refusable — otherwise models reach for it as a general-purpose escape from uncertainty, which is
   * precisely the behaviour this project exists to make unnecessary.
   */
  description: string
  inputSchema: ToolInputSchema
  /**
   * Which agents may see this tool. Absent means everyone.
   *
   * `register-tools.ts` fills this in from `NEXT_PUBLIC_VEIL_TRUSTED_ORIGINS` for the four tools that
   * can uncover a value, mutate the dataset, or end the run. Declared here rather than in a list
   * somewhere else so that a new tool's exposure is decided in the same file as its schema, by the
   * person who understands what it does.
   */
  trusted?: boolean
  execute: (args: Record<string, unknown>) => Promise<ToolResponse>
}

/** Plain prose for a model. */
export function text(body: string): ToolResponse {
  return { content: [{ type: 'text', text: body }] }
}

/**
 * Structured data for a model.
 *
 * Indented with two spaces rather than minified: the token cost is small and models read nested JSON
 * noticeably more reliably when it is indented.
 */
export function json(payload: unknown): ToolResponse {
  return text(JSON.stringify(payload, null, 2))
}

/**
 * A failure the agent is expected to recover from — a bad argument, an unknown column, a call made
 * before a dataset was loaded.
 *
 * Never throw out of `execute`. A thrown exception reaches the model as a host-level failure it can only
 * report, whereas a sentence naming what was wrong and what is accepted gets corrected on the next
 * call.
 *
 * **Not for suppressions.** Use `refusal` for those.
 */
export function toolError(message: string): ToolResponse {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * The guard declined to answer.
 *
 * Deliberately *not* `isError`. The agent asked a reasonable question and the answer would have
 * described too few people; that is the product working. The response carries the code, the reason, and
 * the remaining budget, so the agent can choose between rephrasing, moving on, or telling the human that
 * a handful of rows need a person to look at them.
 */
export function refusal(
  code: RefusalCode,
  reason: string,
  remainingQueries: number,
): ToolResponse {
  return json({ status: 'refused', code, reason, remainingQueries })
}

/**
 * Turn a `Verdict` into a response, so no tool has to remember to handle the refusal branch.
 *
 * `shape` maps an answered value into whatever the tool's documented response object is. It is only
 * called on the answered branch, which is what makes it impossible to format a refusal as if it were an
 * answer.
 */
export function fromVerdict<T>(
  verdict: Verdict<T>,
  shape: (value: T) => Record<string, unknown>,
): ToolResponse {
  if (verdict.status === 'refused') {
    return refusal(verdict.code, verdict.reason, verdict.remainingQueries)
  }
  return json({ ...shape(verdict.value), remainingQueries: verdict.remainingQueries })
}

/** The standard "nothing loaded" reply. Tools stay registered when idle; they explain instead. */
export function noDataset(): ToolResponse {
  return toolError(
    'No dataset is loaded. Ask the human to open a CSV first — there is a sample one on the landing ' +
      'screen — then call describe_dataset.',
  )
}

/** Placeholder while a tool is being built, so the surface is inspectable before it is complete. */
export function notImplemented(name: string): ToolResponse {
  return toolError(`Tool '${name}' is registered but not implemented yet.`)
}

/** Read a required string argument without reaching for `any`. */
export function requireString(
  args: Record<string, unknown>,
  key: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, error: `'${key}' is required and must be a non-empty string.` }
  }
  return { ok: true, value }
}

/** Read a required integer argument, rejecting NaN, Infinity and fractions along with the wrong type. */
export function requireInteger(
  args: Record<string, unknown>,
  key: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false, error: `'${key}' is required and must be an integer.` }
  }
  return { ok: true, value }
}

/**
 * Read a required array-of-strings argument.
 *
 * Exists because three tools take a column list, and each of them getting this slightly wrong is three
 * different unhelpful error messages for the same mistake.
 */
export function requireStringArray(
  args: Record<string, unknown>,
  key: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  const value = args[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { ok: false, error: `'${key}' is required and must be an array of strings.` }
  }
  return { ok: true, value: value as string[] }
}
