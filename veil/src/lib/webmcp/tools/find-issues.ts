import { notImplemented, type ToolDefinition } from '../tool-types'

/**
 * Everything wrong with the file, by row id and issue code.
 *
 * Owner: Riko. Contract: docs/tools.md § find_issues.
 *
 * The tool that makes row ids worth returning. An agent that knows row 903 has a malformed phone number
 * can propose a transform aimed at exactly those rows and tell the human where to look — without ever
 * being told what the number is.
 *
 * Called with no column it scans everything and charges every column, which is deliberately the most
 * expensive call in the surface. "Scan the whole file" should cost something.
 */
export const findIssues: ToolDefinition = {
  name: 'find_issues',
  description:
    'Find data-quality problems: empty cells in mostly-filled columns, values that match no known ' +
    'format, inconsistent date layouts within one column, leading or trailing whitespace, mixed case ' +
    'in categorical values, numbers stored as text, placeholder values like "N/A" or "-", and outliers. ' +
    'Returns an issue code, a count, and up to 100 row numbers per issue — row numbers are safe to ' +
    'share, since a position in a file identifies nobody without the file. Omit "column" to scan ' +
    'everything, which costs one question against every column.',
  inputSchema: {
    type: 'object',
    properties: {
      column: {
        type: 'string',
        description: 'Restrict the scan to one column. Omit to scan all of them.',
      },
    },
    additionalProperties: false,
  },
  async execute() {
    // TODO(riko), Day 4:
    //   - `guard.issues(column)`; with no column, charge every column and refuse the whole call if any
    //     column is exhausted — a partial scan silently missing an exhausted column would read as "this
    //     column is clean", which is the worst available answer
    //   - cap row ids at 100 per issue and set `truncated: true`; never a silent slice
    //   - order issues by count descending, so the first thing the agent reads is the biggest problem
    //
    // Issue *counts* are k-suppressed like everything else, and the row ids are not. That looks
    // inconsistent and isn't: knowing 3 rows have a malformed phone is a fact about a group of 3, while
    // knowing which rows they are is a fact about the file's layout. See docs/privacy-guard.md § Row ids.
    return notImplemented('find_issues')
  },
}
