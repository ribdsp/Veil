import { notImplemented, type ToolDefinition } from '../tool-types'

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
    // TODO(riko), Day 2:
    //   - read the dataset from the store; `noDataset()` if none
    //   - call `guard.describe()` and shape the DatasetSummary through `fromVerdict`
    //   - include `k`, `queriesPerColumn`, and the count of columns already exhausted
    //   - journal a 'describeDataset' entry with author 'agent'
    //
    // Free of charge on purpose: it spends no per-column budget. Charging for orientation would push
    // the agent to guess at column names, and a guessed column name costs a question anyway.
    return notImplemented('describe_dataset')
  },
}
