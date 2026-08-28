import type { TransformSpec } from '@/types/domain'

/**
 * Turning the model's transform object into a `TransformSpec`, or into a sentence explaining why not.
 *
 * Owner: Riko. Contract: docs/tools.md § propose_transform.
 *
 * Lives beside the two tools that need it rather than inside either: `propose_transform` parses the object
 * the model sent, and `apply_transform` commits the spec that came out of that parse. Parsing twice, in two
 * files, is how the preview and the commit end up disagreeing about what `padLeft` meant.
 *
 * Every failure here is a sentence naming the field, because the model's next move is to fix the argument
 * and call again — "invalid transform" costs it a turn to learn nothing.
 */

export type SpecResult =
  | { ok: true; spec: TransformSpec; notes: readonly string[] }
  | { ok: false; error: string }

export type RowsResult = { ok: true; rows: readonly number[] | undefined } | { ok: false; error: string }

/** Every kind the frozen `TransformSpec` union allows, in the order the schema lists them. */
export const TRANSFORM_KINDS = [
  'trimWhitespace',
  'collapseSpaces',
  'changeCase',
  'normaliseDate',
  'normalisePhone',
  'normaliseNumber',
  'padLeft',
  'replacePlaceholderWithEmpty',
  'dropColumn',
  'maskColumn',
] as const

/**
 * The literals `replacePlaceholderWithEmpty` treats as "nothing here".
 *
 * Mirrored from `lib/data/patterns.ts` for the response text only — a tool may not import that module
 * (`guard/no-leak.test.ts`), and the model deserves to know what it is about to blank out. If the two lists
 * drift, this one is wrong and the recogniser is right.
 */
const PLACEHOLDER_LITERALS = 'N/A, n.a., -, --, null, nil, none, #N/A, #VALUE!, TBD, TBA, ?, ??, 0000-00-00'

/** A `padLeft` wide enough to be a mistake rather than a code. */
const MAX_PAD_LENGTH = 256

/**
 * Parse the `transform` argument.
 *
 * Field names differ from the frozen union in two places, and both are mapped rather than passed through:
 * the schema's `padWith` is the spec's `with`, and the schema's `keep: "nothing"` is the spec's
 * `keep: "none"`. The schema is what the model was told, so the schema wins at the boundary and the mapping
 * happens here, once.
 */
export function parseTransformSpec(raw: unknown): SpecResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "'transform' is required and must be an object with a 'kind' and a 'column'." }
  }
  const fields = raw as Record<string, unknown>

  const kind = fields['kind']
  if (typeof kind !== 'string') {
    return { ok: false, error: `'transform.kind' is required. Valid kinds: ${TRANSFORM_KINDS.join(', ')}.` }
  }
  if (!TRANSFORM_KINDS.some((allowed) => allowed === kind)) {
    return {
      ok: false,
      error:
        `'transform.kind' was "${kind}", which is not a transform Veil can run. Valid kinds: ` +
        `${TRANSFORM_KINDS.join(', ')}. There is no free-form or scripted transform on purpose — nothing ` +
        `from the model is ever executed against the data.`,
    }
  }

  const column = fields['column']
  if (typeof column !== 'string' || column.length === 0) {
    return { ok: false, error: `'transform.column' is required for ${kind} and must name one column.` }
  }

  const notes: string[] = []
  if (fields['placeholders'] !== undefined) {
    notes.push(
      `'placeholders' was ignored: the set of literals treated as empty is fixed, not caller-supplied, so ` +
        `a transform cannot be talked into blanking out real values. It is: ${PLACEHOLDER_LITERALS}.`,
    )
  }

  switch (kind) {
    case 'trimWhitespace':
    case 'collapseSpaces':
    case 'replacePlaceholderWithEmpty':
    case 'dropColumn':
      return { ok: true, spec: { kind, column }, notes }

    case 'changeCase': {
      const to = fields['to']
      if (to !== 'lower' && to !== 'upper' && to !== 'title') {
        return { ok: false, error: "'transform.to' must be lower, upper, or title for changeCase." }
      }
      return { ok: true, spec: { kind, column, to }, notes }
    }

    case 'normaliseDate': {
      const to = fields['to']
      if (to !== 'dateIso' && to !== 'timestampIso') {
        return {
          ok: false,
          error:
            "'transform.to' must be dateIso (2026-08-27) or timestampIso for normaliseDate. Profile the " +
            'column first: a column holding both 08/27/2026 and 27/08/2026 has no safe target layout, ' +
            'because the two are indistinguishable on the twelfth of any month.',
        }
      }
      return { ok: true, spec: { kind, column, to }, notes }
    }

    case 'normaliseNumber': {
      const to = fields['to']
      if (to !== 'decimalPoint' && to !== 'integerPlain') {
        return {
          ok: false,
          error: "'transform.to' must be decimalPoint (1234.5) or integerPlain (1234) for normaliseNumber.",
        }
      }
      return { ok: true, spec: { kind, column, to }, notes }
    }

    case 'normalisePhone': {
      const to = fields['to']
      if (to !== undefined && to !== 'phoneE164') {
        return {
          ok: false,
          error: "'transform.to' must be phoneE164 for normalisePhone — it is the only target it produces.",
        }
      }
      const code = fields['defaultCountryCode']
      // Required, never defaulted. A local number carries no country, so guessing one is guessing whose
      // number this is: the wrong guess writes a real, dialable number belonging to a stranger into
      // somebody's customer file, and every check downstream passes because the shape is perfect.
      if (typeof code !== 'string' || !/^\+?[0-9]{1,3}$/.test(code.trim())) {
        return {
          ok: false,
          error:
            "'transform.defaultCountryCode' is required for normalisePhone — a dialling code like +62 or " +
            '+1, used for numbers written in local form. It is not guessed for you: a number normalised ' +
            'to the wrong country is a valid phone number belonging to somebody else. Ask the human which ' +
            'country this file is from with ask_human if you do not know.',
        }
      }
      return {
        ok: true,
        spec: { kind, column, to: 'phoneE164', defaultCountryCode: code.trim() },
        notes,
      }
    }

    case 'padLeft': {
      const length = fields['length']
      if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
        return { ok: false, error: "'transform.length' is required for padLeft and must be a whole number above 0." }
      }
      if (length > MAX_PAD_LENGTH) {
        return {
          ok: false,
          error: `'transform.length' was ${length}; the maximum is ${MAX_PAD_LENGTH}. A pad that wide is a ` +
            `mistyped width, not a code format.`,
        }
      }
      const padWith = fields['padWith']
      if (padWith !== undefined && (typeof padWith !== 'string' || padWith.length === 0)) {
        return { ok: false, error: "'transform.padWith' must be a non-empty string when given. Defaults to \"0\"." }
      }
      return { ok: true, spec: { kind, column, length, with: padWith ?? '0' }, notes }
    }

    case 'maskColumn': {
      const keep = fields['keep']
      // "nothing" is what the schema offers and "none" is what the union holds. Same thing, renamed once.
      const mapped = keep === 'nothing' ? 'none' : keep
      if (mapped !== 'none' && mapped !== 'lastFour' && mapped !== 'domain') {
        return {
          ok: false,
          error: "'transform.keep' must be nothing, lastFour, or domain for maskColumn.",
        }
      }
      return { ok: true, spec: { kind, column, keep: mapped }, notes }
    }

    default:
      // Unreachable: `kind` was checked against TRANSFORM_KINDS above. Present so that adding a kind to the
      // frozen union without handling it here fails to compile rather than falling through silently.
      return { ok: false, error: `'transform.kind' "${kind as string}" is not handled.` }
  }
}

/**
 * Parse the optional `rows` argument.
 *
 * Absent means the whole column, which is a different request from an empty list — an empty list is a
 * transform that would change nothing, and the likeliest reason for one is a `find_issues` result the agent
 * misread. Saying so is more useful than reporting `changedCount: 0`.
 */
export function parseRows(raw: unknown): RowsResult {
  if (raw === undefined) return { ok: true, rows: undefined }

  if (!Array.isArray(raw)) {
    return { ok: false, error: "'rows' must be an array of row numbers when given. Omit it for the whole column." }
  }
  if (raw.length === 0) {
    return {
      ok: false,
      error:
        "'rows' was an empty list, which would transform nothing. Omit the field to transform the whole " +
        'column, or pass the row numbers find_issues returned.',
    }
  }
  if (raw.some((row) => typeof row !== 'number' || !Number.isInteger(row) || row < 0)) {
    return { ok: false, error: "'rows' must contain whole row numbers of 0 or above, as returned by find_issues." }
  }

  // Deduplicated and ordered so that the report reads the same way twice for the same set of rows.
  const unique = [...new Set(raw as number[])].sort((a, b) => a - b)
  return { ok: true, rows: unique }
}
