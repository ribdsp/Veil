import { notImplemented, type ToolDefinition } from '../tool-types'

/**
 * Masked exemplars, grouped by the format they match.
 *
 * Owner: Riko. Contract: docs/tools.md § sample_shapes.
 *
 * `profile_column` says *how many* values are in each format bucket. This says *what they look like*.
 * The split exists because an agent often knows the counts already and only needs to see the shape of
 * the messy bucket before writing a rule for it.
 *
 * The unrecognised bucket is the interesting one, and the reason `onlyUnrecognised` is an argument
 * rather than a separate tool: "show me what I could not classify" is the question that actually gets
 * asked.
 */
export const sampleShapes: ToolDefinition = {
  name: 'sample_shapes',
  description:
    'Show masked examples from a column, grouped by the format each matches. Digits become 9, ' +
    'uppercase letters A, lowercase a; spaces and punctuation are preserved, so 27/08/2026 comes back ' +
    'as 99/99/9999. Use this to see the shape of values you could not classify before writing a ' +
    'transform for them. Never returns a real value, and you cannot request the shape of a specific row.',
  inputSchema: {
    type: 'object',
    properties: {
      column: {
        type: 'string',
        description: 'Column name, exactly as returned by describe_dataset.',
      },
      onlyUnrecognised: {
        type: 'boolean',
        description:
          'When true, only show examples that matched no known format — usually the ones worth fixing.',
      },
    },
    required: ['column'],
    additionalProperties: false,
  },
  async execute() {
    // TODO(riko), Day 3:
    //   - `guard.shapes(column, { onlyUnrecognised })` — one charge
    //   - at most 10 exemplars total, at most 8 buckets, and buckets below k are not shown at all
    //   - if every bucket is below k, refuse with `belowK` and say the column is too varied to sample
    //     rather than returning an empty list, which reads as "this column is clean"
    return notImplemented('sample_shapes')
  },
}
