import { notImplemented, type ToolDefinition } from '../tool-types'

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
  async execute() {
    // TODO(riko), Day 5:
    //   - `requireStringArray(args, 'columns')`, reject an empty list and more than 4 columns
    //   - clamp `threshold` into [0.5, 1] rather than refusing an out-of-range number; the schema
    //     already told the model the range, and a clamp with a note in the response is more useful than
    //     a rejection here
    //   - `guard.duplicates(columns, threshold)` — charges each column once
    //   - cap at 50 pairs and report `truncated`
    //
    // The pair count itself needs no k-check — a pair is 2 rows, always below k, and suppressing it
    // would remove the tool. What protects the data is that a pair carries no values at all, which is
    // why `no-leak.test.ts` matters most for this tool: a helpful "here's what differs" field added
    // later would quietly turn a safe tool into a bulk read.
    return notImplemented('find_duplicates')
  },
}
