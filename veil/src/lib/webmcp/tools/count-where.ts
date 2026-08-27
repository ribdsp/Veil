import { noteToolCall } from '@/lib/guard/host'
import { parseQuery } from '@/lib/guard/predicate'
import { activeGuard } from '@/lib/guard/session'

import { fromVerdict, noDataset, refusal, type ToolDefinition } from '../tool-types'

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
  async execute(args) {
    const guard = activeGuard()
    if (guard === null) return noDataset()

    // Validation first, and all of it, before a row is read. `predicate.ts` owns the arity check, the column
    // check and the format enum; a predicate specific enough to describe one person is rejected here rather
    // than evaluated and then suppressed. Two different decisions — see docs/architecture.md, steps 3 and 6.
    const parsed = parseQuery(args, guard.columns())
    if (!parsed.ok) {
      // Nothing was charged: the question never reached the data. The budget reported is the one the agent
      // still has for the columns it named, so a rejected predicate does not read as an exhausted column.
      return refusal(parsed.code, parsed.reason, guard.remainingFor(namedColumns(args)))
    }

    const query = parsed.query
    noteToolCall(
      'count_where',
      `${query.conditions.length} condition(s) joined by "${query.join}" over ` +
        `${namedColumns(args).length > 0 ? namedColumns(args).join(', ') : 'no column'}`,
    )

    return fromVerdict(guard.count(query), (matched) => ({
      matchingRows: matched,
      join: query.join,
      // Echoed back from the parsed query, not from the arguments. What comes back is exactly what was
      // understood, which is how an agent discovers that a field the schema does not have — `pattern`,
      // `regex`, `not` — was never read rather than silently honoured.
      conditionsUnderstood: query.conditions,
    }))
  },
}

/**
 * Column names the raw arguments mention, defensively.
 *
 * Only for reporting the remaining budget on a rejected predicate, so it has to cope with arguments that
 * failed validation: a non-array `conditions`, a condition that is a string, a `column` that is a number.
 * Anything it cannot read is simply not named.
 */
function namedColumns(args: Record<string, unknown>): readonly string[] {
  const conditions = args['conditions']
  if (!Array.isArray(conditions)) return []

  const names = conditions.flatMap((condition) => {
    if (typeof condition !== 'object' || condition === null) return []
    const column = (condition as Record<string, unknown>)['column']
    return typeof column === 'string' && column.length > 0 ? [column] : []
  })

  return [...new Set(names)]
}
