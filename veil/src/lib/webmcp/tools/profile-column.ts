import { noteToolCall } from '@/lib/guard/host'
import { activeGuard } from '@/lib/guard/session'

import { fromVerdict, noDataset, requireString, toolError, type ToolDefinition } from '../tool-types'

/**
 * Everything about one column except what is in it.
 *
 * Owner: Riko. Contract: docs/tools.md § profile_column.
 *
 * The densest tool in the surface, and the one that makes the pitch true. A single call tells the agent
 * the column's type, how many values are missing, how many are distinct, which named formats the values
 * match and in what proportion, the length distribution, and a handful of masked exemplars.
 *
 * That is enough to write a cleaning rule. It is not enough to identify anybody.
 */
export const profileColumn: ToolDefinition = {
  name: 'profile_column',
  description:
    'Profile one column: value type, how many cells are empty, how many values are distinct, which ' +
    'recognised formats the values match and how many fall in each, the shortest and longest lengths, ' +
    'and up to 10 masked examples (digits become 0, letters become a or A, punctuation is kept). ' +
    'Returns no real values. This is the tool to use before proposing any transform on a column — one ' +
    'call usually answers everything you need.',
  inputSchema: {
    type: 'object',
    properties: {
      column: {
        type: 'string',
        description: 'Column name, exactly as returned by describe_dataset.',
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

    noteToolCall('profile_column', column.value)

    // One charge covers the profile and its exemplars together. Two calls for one question would be the
    // agent's problem to work around and the budget's to absorb.
    return fromVerdict(guard.profileWithExemplars(column.value, 10), (report) => ({
      column: report.profile.id,
      type: report.profile.type,
      emptyCount: report.profile.emptyCount,
      distinctCount: report.profile.distinctCount,
      minLength: report.profile.minLength,
      maxLength: report.profile.maxLength,
      // Buckets holding fewer than the minimum group size have already been folded into `unrecognised`
      // upstream, never dropped: shares that do not sum to 1 would read as a filtered column.
      formats: report.profile.formats.map((bucket) => ({
        format: bucket.format,
        count: bucket.count,
        share: bucket.share,
      })),
      maskedExamples: report.shapes.map((shape) => ({ format: shape.format, masked: shape.masked })),
      formatsTruncated: report.profile.truncated,
      ...(report.note === null ? {} : { maskingNote: report.note }),
      ...(report.exemplarsSuppressed
        ? {
            examplesSuppressed:
              'No masked examples: every format bucket in this column holds fewer than the minimum group ' +
              'size, so an example would point at the rows it came from. The counts and length range above ' +
              'are the whole answer — usually this column is unique per row, like an id or a full name.',
          }
        : {}),
    }))
  },
}
