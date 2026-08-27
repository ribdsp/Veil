import { noteToolCall } from '@/lib/guard/host'
import { activeGuard } from '@/lib/guard/session'

import { fromVerdict, noDataset, requireString, toolError, type ToolDefinition } from '../tool-types'

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
    'Show masked examples from a column, grouped by the format each matches. Digits become 0, ' +
    'uppercase letters A, lowercase a; spaces and punctuation are preserved, so 27/08/2026 comes back ' +
    'as 00/00/0000. Use this to see the shape of values you could not classify before writing a ' +
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
  async execute(args) {
    const guard = activeGuard()
    if (guard === null) return noDataset()

    const column = requireString(args, 'column')
    if (!column.ok) return toolError(column.error)

    const flag = args['onlyUnrecognised']
    if (flag !== undefined && typeof flag !== 'boolean') {
      return toolError("'onlyUnrecognised' must be true or false when given.")
    }
    const onlyUnrecognised = flag === true

    noteToolCall('sample_shapes', onlyUnrecognised ? `${column.value}, unrecognised only` : column.value)

    // Ten exemplars, drawn one per bucket before two from any bucket, so a column with one messy shape and
    // one clean one shows both rather than ten of whichever is more common.
    return fromVerdict(guard.shapeSample(column.value, 10, onlyUnrecognised), (sample) => ({
      column: column.value,
      onlyUnrecognised,
      shapes: sample.shapes.map((shape) => ({ format: shape.format, masked: shape.masked })),
      buckets: sample.buckets.map((bucket) => ({
        format: bucket.format,
        count: bucket.count,
        share: bucket.share,
      })),
      truncated: sample.truncated,
      ...(sample.note === null ? {} : { maskingNote: sample.note }),
    }))
  },
}
