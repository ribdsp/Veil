import type { AggregateFn, AggregateSpec } from '@/types/domain'

import { noteToolCall } from '@/lib/guard/host'
import { activeGuard } from '@/lib/guard/session'

import { fromVerdict, noDataset, requireString, toolError, type ToolDefinition } from '../tool-types'

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
  async execute(args) {
    const guard = activeGuard()
    if (guard === null) return noDataset()

    const groupBy = requireString(args, 'groupBy')
    if (!groupBy.ok) return toolError(groupBy.error)

    const metric = requireString(args, 'metric')
    if (!metric.ok) return toolError(metric.error)

    if (!METRICS.some((allowed) => allowed === metric.value)) {
      return toolError(
        `'metric' must be one of ${METRICS.join(', ')}. Received "${metric.value}". There is no median or ` +
          `mode: both select a member of the group rather than summarising it.`,
      )
    }
    const fn = metric.value as AggregateFn

    const rawValueColumn = args['valueColumn']
    if (rawValueColumn !== undefined && typeof rawValueColumn !== 'string') {
      return toolError("'valueColumn' must be a string naming a numeric column when given.")
    }

    // Named field, checked before anything is charged. "sum" with nothing to sum is a call the model can fix
    // on the next attempt, and charging for it would take a question away for a typo.
    if (fn !== 'count' && (rawValueColumn === undefined || rawValueColumn.length === 0)) {
      return toolError(
        `A "${fn}" needs a 'valueColumn' — the numeric column to ${fn === 'mean' ? 'average' : fn}. ` +
          `'groupBy' is the column whose values become the groups. Use metric "count" if you only want ` +
          `how many rows are in each group.`,
      )
    }

    const spec: AggregateSpec = {
      groupBy: groupBy.value,
      fn,
      ...(fn === 'count' || rawValueColumn === undefined ? {} : { over: rawValueColumn }),
    }

    noteToolCall(
      'aggregate',
      `${fn} grouped by ${spec.groupBy}${spec.over === undefined ? '' : ` over ${spec.over}`}`,
    )

    return fromVerdict(guard.aggregate(spec), (result) => ({
      groupBy: spec.groupBy,
      metric: fn,
      ...(spec.over === undefined ? {} : { valueColumn: spec.over }),
      // Ordered by size descending upstream, so the groups that survive the cap are the ones worth reading.
      groups: result.groups.map((group) => ({
        key: group.key,
        count: group.count,
        value: group.value,
      })),
      // Present whenever anything was folded in. The row count is reported and the group *keys* are not:
      // the total is derivable by subtraction from describe_dataset anyway, and a tail that does not sum
      // reads as a filtered dataset.
      other:
        result.other === null
          ? null
          : { key: '__other__', groupCount: result.other.groupCount, rowCount: result.other.rowCount },
      truncated: result.truncated,
      note:
        result.other === null
          ? 'Every group reaches the minimum group size; nothing was merged.'
          : `${result.other.groupCount} group(s) holding ${result.other.rowCount} row(s) between them were ` +
            `merged into "__other__" — each was too small to name on its own. The counts still sum to the ` +
            `dataset size.` +
            (result.groups.some((group) => group.value === 'suppressed')
              ? ' A value of "suppressed" means the group is large enough to name but not large enough for ' +
                'that statistic: a min or max over a small group is one row\'s value, not a summary.'
              : ''),
    }))
  },
}

const METRICS: readonly AggregateFn[] = ['count', 'sum', 'mean', 'min', 'max']
