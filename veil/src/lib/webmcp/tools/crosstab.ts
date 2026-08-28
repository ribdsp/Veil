import { noteToolCall } from '@/lib/guard/host'
import { activeGuard } from '@/lib/guard/session'

import { fromVerdict, noDataset, requireString, toolError, type ToolDefinition } from '../tool-types'

/**
 * A two-column contingency table, cell by cell, each cell k-checked on its own.
 *
 * Owner: Riko. Contract: docs/tools.md § crosstab.
 *
 * The tool that most needs its cap enforced. Two columns with 40 distinct values each is a 1,600-cell
 * table, and most of those cells hold one or two rows — a crosstab of a wide-enough pair is a
 * re-identification engine wearing a spreadsheet's clothes.
 *
 * Cross-referenced in docs/threat-model.md (T2): this is the tool that motivates the small-group rule
 * being applied per cell rather than per response.
 */
export const crosstab: ToolDefinition = {
  name: 'crosstab',
  description:
    'Cross-tabulate two columns: how many rows fall into each combination of their values. Every cell ' +
    'is checked against the minimum group size independently, and small cells come back as ' +
    '"suppressed" rather than a number. Both columns must have few distinct values — the request is ' +
    'refused outright if the table would be too large, which is a sign one of the columns is closer to ' +
    'an identifier than a category. Costs one question against each column.',
  inputSchema: {
    type: 'object',
    properties: {
      rowColumn: { type: 'string', description: 'Column whose values become the rows.' },
      columnColumn: { type: 'string', description: 'Column whose values become the columns.' },
    },
    required: ['rowColumn', 'columnColumn'],
    additionalProperties: false,
  },
  async execute(args) {
    const guard = activeGuard()
    if (guard === null) return noDataset()

    const rowColumn = requireString(args, 'rowColumn')
    if (!rowColumn.ok) return toolError(rowColumn.error)

    const columnColumn = requireString(args, 'columnColumn')
    if (!columnColumn.ok) return toolError(columnColumn.error)

    noteToolCall('crosstab', `${rowColumn.value} × ${columnColumn.value}`)

    // Both the same-column check and the width check live in the guard, and both happen before a row is
    // counted. Width is charged for on purpose: "that column is too wide to cross-tabulate" is a real fact
    // about the file, and an agent that learns it for free learns the distinct count of every column for
    // free with it.
    return fromVerdict(guard.crosstab(rowColumn.value, columnColumn.value), (table) => ({
      rowColumn: rowColumn.value,
      columnColumn: columnColumn.value,
      rowKeys: table.rowKeys,
      columnKeys: table.columnKeys,
      // Row-major: cells[i][j] is rowKeys[i] crossed with columnKeys[j]. A cell reads "suppressed" when it
      // holds between 1 and k-1 rows; an empty combination is reported as 0, because zero is a fact about
      // the categories rather than about anybody in them.
      cells: table.cells,
      suppressedCells: table.suppressedCells,
      truncated: table.truncated,
      note:
        table.suppressedCells === 0
          ? 'No cell needed suppressing: every combination present holds at least the minimum group size.'
          : `${table.suppressedCells} cell(s) hold between 1 and the minimum group size minus one row, and ` +
            `come back as "suppressed" rather than a count. A table this sparse usually means one of these ` +
            `columns is closer to an identifier than a category — aggregate on the other one instead, or ` +
            `ask a human to look at the thin combinations.`,
    }))
  },
}
