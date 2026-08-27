import { activeGuard, activeSourceName } from '@/lib/guard/session'
import { noteToolCall } from '@/lib/guard/host'

import { fromVerdict, noDataset, type ToolDefinition } from '../tool-types'

/**
 * The first tool any agent should call.
 *
 * Owner: Riko. Contract: docs/tools.md § describe_dataset.
 *
 * Returns the shape of the file and the rules of engagement in one response: how many rows, what the
 * columns are called, what type each holds, how much is missing — and the guard's settings, so the agent
 * learns the k threshold and the per-column budget before it spends any of it.
 *
 * Telling the agent the rules up front is the whole reason this tool is first. An agent that discovers
 * the budget by exhausting it has already wasted the budget.
 */
export const describeDataset: ToolDefinition = {
  name: 'describe_dataset',
  description:
    'Describe the loaded spreadsheet: row count, column names, the type of value each column holds, ' +
    'how many cells are empty, and how many distinct values each column has. Also returns the privacy ' +
    'rules in force — the minimum group size that can be reported and how many questions you may ask ' +
    'per column. No cell values are returned. Call this first; every other tool needs the column names ' +
    'from here.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute() {
    const guard = activeGuard()
    if (guard === null) return noDataset()

    const settings = guard.settings()
    noteToolCall('describe_dataset', `${settings.columnCount} columns, ${settings.rowCount} rows`)

    return fromVerdict(guard.describe(), (summary) => ({
      sourceName: activeSourceName(),
      rowCount: summary.rowCount,
      columns: summary.columns.map((column) => ({
        name: column.id,
        type: column.type,
        emptyCount: column.emptyCount,
        // `'unique'` rather than a number when every value differs. The number would be the row count,
        // which is already in this response; the word is the fact worth acting on, because a column of
        // unique values is an identifier — something to normalise, not something to analyse.
        distinctCount: column.distinctCount,
      })),
      privacy: {
        minGroupSize: summary.minGroupSize,
        queriesPerColumn: settings.queriesPerColumn,
        columnsExhausted: settings.exhausted.length,
        exhaustedColumns: settings.exhausted,
        revealsGranted: settings.revealsGranted,
        transformsApplied: settings.undoDepth,
        // Worth stating plainly: with no host installed nothing is journalled and no write can be
        // approved, so every transform and reveal will refuse. That is a wiring fault in the page, not
        // something the agent can fix, and an agent that knows it will say so instead of retrying.
        journalled: settings.hostInstalled,
      },
      note:
        `Answers describing fewer than ${summary.minGroupSize} rows are withheld, and each column ` +
        `answers at most ${settings.queriesPerColumn} questions this session. This call is free; every ` +
        `other read costs one question per column it touches. No tool returns a cell value.`,
    }))
  },
}
