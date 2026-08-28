import { noteToolCall } from '@/lib/guard/host'
import { activeGuard } from '@/lib/guard/session'

import { fromVerdict, noDataset, toolError, type ToolDefinition } from '../tool-types'

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
  async execute(args) {
    const guard = activeGuard()
    if (guard === null) return noDataset()

    // Absent means "all of them" — the empty list the guard reads as every column. An explicit empty string
    // is a different thing: a column name the agent believes it has, and answering the wrong question is
    // worse than saying which field was wrong.
    const raw = args['column']
    if (raw !== undefined && typeof raw !== 'string') {
      return toolError("'column' must be a string naming one column when given. Omit it to scan all columns.")
    }
    if (raw !== undefined && raw.length === 0) {
      return toolError("'column' was empty. Omit the field entirely to scan every column.")
    }

    const requested = raw === undefined ? [] : [raw]
    const scanned = raw === undefined ? guard.columns().map((column) => column.id) : [raw]

    noteToolCall('find_issues', raw === undefined ? `all ${scanned.length} column(s)` : raw)

    // All-or-nothing across the columns scanned, which is why a whole-file scan refuses outright when any
    // single column is exhausted. A scan that quietly skipped that column would report it as clean, and
    // "clean" is the one wrong answer nobody re-checks.
    return fromVerdict(guard.issues(requested), (issues) => ({
      columnsScanned: scanned,
      issueCount: issues.length,
      // Ordered by affected rows descending upstream, so the first entry is the biggest problem.
      issues: issues.map((issue) => ({
        code: issue.code,
        column: issue.column,
        affectedCount: issue.affectedCount,
        rowIds: issue.rowIds,
        truncated: issue.truncated,
      })),
      note:
        issues.length === 0
          ? `No issues found in ${
              raw === undefined ? 'any column' : `"${raw}"`
            }. That is a real answer, not a suppressed one — a suppressed count says "suppressed", never 0.`
          : 'Row numbers are positions in the file, not identities, so they are never suppressed — that is ' +
            'what makes them worth returning. Use them as the "rows" argument to propose_transform to fix ' +
            'exactly these rows, or hand them to a human with ask_human. Where "truncated" is true there ' +
            'are more affected rows than the 100 listed; "affectedCount" is the real total.',
    }))
  },
}
