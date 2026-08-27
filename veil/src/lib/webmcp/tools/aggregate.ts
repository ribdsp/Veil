import { notImplemented, type ToolDefinition } from '../tool-types'

/**
 * Group-by with a suppression rule.
 *
 * Owner: Riko. Contract: docs/tools.md § aggregate.
 *
 * Groups below k are merged into `__other__` with their combined count, and the number of groups folded
 * in is reported. Merging rather than dropping is not politeness — it keeps the group totals summing to
 * `rowCount`, and an agent whose groups don't sum concludes it was handed a filtered dataset and reports
 * every subsequent number wrongly. docs/privacy-guard.md § Merged, never dropped.
 */
export const aggregate: ToolDefinition = {
  name: 'aggregate',
  description:
    'Group rows by one column and compute a statistic per group: count, or sum, mean, min or max of a ' +
    'numeric column. Groups smaller than the minimum group size are combined into a single "__other__" ' +
    'bucket with their total, and the response says how many groups went into it — so the counts still ' +
    'add up to the dataset size. At most 25 groups are returned; the rest are merged the same way.',
  inputSchema: {
    type: 'object',
    properties: {
      groupBy: {
        type: 'string',
        description: 'The column to group by. Best on a column with few distinct values.',
      },
      metric: {
        type: 'string',
        enum: ['count', 'sum', 'mean', 'min', 'max'],
        description: 'What to compute per group. "count" needs no valueColumn.',
      },
      valueColumn: {
        type: 'string',
        description:
          'The numeric column to sum, average, or take the extreme of. Required for every metric ' +
          'except count.',
      },
    },
    required: ['groupBy', 'metric'],
    additionalProperties: false,
  },
  async execute() {
    // TODO(riko), Day 4:
    //   - reject `metric !== 'count'` without a `valueColumn`, naming the field, before charging budget
    //   - `guard.aggregate(spec)` — charges `groupBy` and, when present, `valueColumn`
    //   - order groups by size descending so the useful ones survive the 25-group cap
    //
    // A note on `min` and `max`: for a group of exactly k rows, the max **is** one row's value. It is a
    // real number from a real record, and no amount of group-size checking changes that. `guard.ts`
    // must apply a separate rule — suppress extremes for groups under 2k — and that rule is easy to
    // forget because it does not look like the others.
    return notImplemented('aggregate')
  },
}
