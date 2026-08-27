import { notImplemented, type ToolDefinition } from '../tool-types'

/**
 * How many rows match a structured predicate.
 *
 * Owner: Riko. Contract: docs/tools.md § count_where.
 *
 * The most-used tool and the most-attacked one. Everything in docs/privacy-guard.md § Predicate limits
 * exists because of this schema — three conditions, one join operator, a closed format vocabulary, and
 * **no pattern argument**, because a model-supplied regex extracts a phone number one digit at a time
 * through answers that are all individually legal.
 *
 * If you are about to add a `pattern` field here, read that section first. It anticipates you.
 */
export const countWhere: ToolDefinition = {
  name: 'count_where',
  description:
    'Count the rows matching up to 3 conditions. Conditions are structured, not free text: equals a ' +
    'literal value, is empty, matches a named format (e.g. phoneE164, dateIso, unrecognised), a numeric ' +
    'comparison, or a length range. Join them with "all" or "any". If fewer than the minimum group size ' +
    'match, you get a suppressed result naming the range instead of the number — that is a normal ' +
    'answer, not an error, and it means a handful of rows need a person to look at them. Regular ' +
    'expressions are not accepted; use matchesFormat.',
  inputSchema: {
    type: 'object',
    properties: {
      conditions: {
        type: 'array',
        description:
          'Between 1 and 3 conditions. Each is an object with a "kind" of equals, isEmpty, ' +
          'matchesFormat, compare, or lengthBetween, plus a "column" and whatever that kind needs.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['equals', 'isEmpty', 'matchesFormat', 'compare', 'lengthBetween'],
              description: 'Which kind of condition this is.',
            },
            column: { type: 'string', description: 'Column name from describe_dataset.' },
            value: {
              type: 'string',
              description: 'For "equals", the literal value to match. Ignored by other kinds.',
            },
            format: {
              type: 'string',
              description:
                'For "matchesFormat", one of the named formats listed by profile_column — for example ' +
                'phoneE164, phoneLocalId, dateIso, dateDmySlash, emailAddress, integerPlain, blank, ' +
                'unrecognised. Arbitrary patterns are rejected.',
            },
            op: {
              type: 'string',
              enum: ['<', '<=', '>', '>='],
              description: 'For "compare", the operator. The column must hold numbers.',
            },
            min: { type: 'integer', description: 'For "lengthBetween", the minimum length inclusive.' },
            max: { type: 'integer', description: 'For "lengthBetween", the maximum length inclusive.' },
          },
          required: ['kind', 'column'],
          additionalProperties: false,
        },
      },
      join: {
        type: 'string',
        enum: ['all', 'any'],
        description: 'Whether every condition must hold ("all") or any one of them ("any").',
      },
    },
    required: ['conditions', 'join'],
    additionalProperties: false,
  },
  async execute() {
    // TODO(riko), Day 3:
    //   - parse into a `Query` via `guard/predicate.ts`; it owns the arity check, the column check and
    //     the format-enum check, and it must run before anything touches a row
    //   - `guard.count(query)` — charges one question against **every** column named in the predicate
    //   - shape through `fromVerdict`, so the suppressed branch cannot be formatted as a number
    //
    // The subtlety worth stating: predicate validation and result suppression are two different
    // decisions. "Was this a legitimate question" is not the same as "is this a legitimate answer", and
    // collapsing them into one check is how a guard ends up with a hole. See docs/architecture.md,
    // steps 3 and 6 of the guarded-question flow.
    return notImplemented('count_where')
  },
}
