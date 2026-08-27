import { notImplemented, type ToolDefinition } from '../tool-types'

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
    'and up to 10 masked examples (digits become 9, letters become a or A, punctuation is kept). ' +
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
  async execute() {
    // TODO(riko), Day 3:
    //   - `requireString(args, 'column')`, then check it exists; an unknown column is `unknownColumn`
    //     with the available names listed, not a bare failure
    //   - `guard.profile(column)` — one charge against that column's budget
    //   - format buckets below k are merged into `unrecognised`, never dropped (docs/privacy-guard.md)
    //   - exemplars come from `redact.ts` and are sampled one per bucket before two from any bucket
    //
    // Worth its own charge even though it looks like metadata: the format histogram is the highest
    // information-density answer in the surface, and an agent that could call it freely on every column
    // would have a cheap map of the whole file.
    return notImplemented('profile_column')
  },
}
