import { noteToolCall } from '@/lib/guard/host'
import { activeGuard } from '@/lib/guard/session'

import {
  fromVerdict,
  noDataset,
  requireStringArray,
  toolError,
  type ToolDefinition,
} from '../tool-types'

/**
 * Rows that probably describe the same person, without saying who.
 *
 * Owner: Riko. Contract: docs/tools.md § find_duplicates.
 *
 * Returns pairs of row ids and a similarity score. Not the values, not the differing characters, not a
 * diff — a pair and a number. The human opens the two rows side by side and decides; the agent's job is
 * to have found the pair at all.
 *
 * This is the clearest demonstration of the whole premise: near-duplicate detection is genuinely useful
 * work, it genuinely needs to compare values, and the agent genuinely never sees one.
 */
export const findDuplicates: ToolDefinition = {
  name: 'find_duplicates',
  description:
    'Find rows that are probably duplicates of each other, comparing the columns you name with a ' +
    'fuzzy string similarity. Returns pairs of row numbers with a score between 0 and 1 — never the ' +
    'values, and never what differs between them. Ask the human to review the pairs, or propose a ' +
    'transform that normalises the columns first, since a lot of apparent duplicates are one record ' +
    'written two ways. At most 50 pairs, highest score first.',
  inputSchema: {
    type: 'object',
    properties: {
      columns: {
        type: 'array',
        description:
          'Which columns to compare. Two or three identifying columns work better than all of them: ' +
          'comparing every column means a single differing field hides a real duplicate.',
        items: { type: 'string' },
      },
      threshold: {
        type: 'number',
        minimum: 0.5,
        maximum: 1,
        description: 'Minimum similarity to report, between 0.5 and 1. Defaults to 0.85.',
      },
    },
    required: ['columns'],
    additionalProperties: false,
  },
  async execute(args) {
    const guard = activeGuard()
    if (guard === null) return noDataset()

    const columns = requireStringArray(args, 'columns')
    if (!columns.ok) return toolError(columns.error)

    const raw = args['threshold']
    if (raw !== undefined && (typeof raw !== 'number' || !Number.isFinite(raw))) {
      return toolError("'threshold' must be a number between 0.5 and 1 when given.")
    }

    // Clamped, not refused. The schema already stated the range, so a number outside it is a slip rather
    // than a misunderstanding, and the useful reading of `threshold: 2` is "only near-certain matches".
    // Refusing would cost the agent a turn to learn something the response can just tell it.
    const requested = raw === undefined ? DEFAULT_THRESHOLD : raw
    const threshold = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, requested))
    const clamped = threshold !== requested

    noteToolCall(
      'find_duplicates',
      `${columns.value.length} column(s) at threshold ${threshold}${clamped ? ' (clamped)' : ''}`,
    )

    // Empty and over-long column lists are the guard's refusals, not this tool's: the maximum lives next to
    // the blocking that has to survive it, and duplicating the number here is how the two drift apart.
    return fromVerdict(guard.duplicatePairs(columns.value, threshold), (report) => ({
      columnsCompared: columns.value,
      threshold,
      ...(clamped
        ? {
            thresholdNote:
              `Requested ${requested}, used ${threshold} — the usable range is ${MIN_THRESHOLD} to ` +
              `${MAX_THRESHOLD}. Below ${MIN_THRESHOLD} almost every pair of rows looks similar enough to ` +
              `report, which buries the real duplicates.`,
          }
        : {}),
      pairCount: report.pairs.length,
      // A pair carries two row numbers and a score, and that is the whole contract. There is no field here
      // for what differs between the rows, and adding one would turn this tool into a bulk read one
      // character at a time — see the doc comment above, and guard/no-leak.test.ts.
      pairs: report.pairs.map((pair) => ({
        rowA: pair.a,
        rowB: pair.b,
        score: pair.score,
        matchedColumns: pair.matchedColumns,
      })),
      truncated: report.truncated,
      ...(report.skippedBlocks.length > 0 ? { skippedBlocks: report.skippedBlocks } : {}),
      note:
        report.pairs.length === 0
          ? `No pair reached ${threshold} on those columns. Either the file has no near-duplicates in them, ` +
            `or the columns are written inconsistently enough that similarity misses the match — normalise ` +
            `them with propose_transform (trimWhitespace, changeCase, normalisePhone) and ask again.`
          : `Pairs are row numbers only, highest score first${
              report.truncated ? `, capped at ${report.cap}` : ''
            }. A score is not a verdict: hand the pairs to a human with ask_human, or normalise the columns ` +
            `first, because a lot of apparent duplicates are one record written two ways rather than two ` +
            `records. Nothing here says what the rows contain or how they differ.`,
    }))
  },
}

const DEFAULT_THRESHOLD = 0.85
const MIN_THRESHOLD = 0.5
const MAX_THRESHOLD = 1
