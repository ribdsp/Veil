import { notImplemented, type ToolDefinition } from '../tool-types'

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
  async execute() {
    // TODO(riko), Day 4:
    //   - refuse when either column has more than 12 distinct values, or the product exceeds 100 cells,
    //     *before* building anything: say which column was too wide and suggest aggregate instead
    //   - refuse when the two columns are the same — a diagonal table teaches nothing and costs two
    //     charges
    //   - `guard.crosstab(rowColumn, columnColumn)`, suppressing per cell
    //   - report `suppressedCells` as a count so the agent can see how sparse the table really was
    return notImplemented('crosstab')
  },
}
