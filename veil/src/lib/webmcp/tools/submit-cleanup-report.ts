import { notImplemented, type ToolDefinition } from '../tool-types'

/**
 * End the run: what was found, what was changed, what a person still has to do.
 *
 * Owner: Vicko. Contract: docs/tools.md § submit_cleanup_report.
 *
 * Trusted, and the one tool whose gating has nothing to do with privacy. A report closes the session and
 * is what the human reads to decide whether to keep the file — a stray agent ending someone else's run is
 * a denial of service, not a disclosure.
 *
 * `unresolved` is the field that matters and the field a model will want to leave empty. Every refused
 * reveal, every suppressed count, every ambiguity the human declined to settle belongs there. A report
 * claiming a clean file when four rows were never legible is worse than no report: it is the moment the
 * privacy guarantee turns into a correctness bug, because the human now believes the file is done.
 */
export const submitCleanupReport: ToolDefinition = {
  name: 'submit_cleanup_report',
  description:
    'Finish the session with a report for the person who owns the file: what you found, what you ' +
    'changed and why, and — most importantly — what you could not resolve and they still need to look ' +
    'at. List every row you were refused a reveal for and every count that came back suppressed. Do not ' +
    'describe the file as clean if there are rows you could not see. Call this once, at the end.',
  trusted: true,
  inputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Two or three sentences on the state of the data, for a non-technical reader.',
      },
      changes: {
        type: 'array',
        description: 'What you changed, one plain sentence each, with the row counts.',
        items: { type: 'string' },
      },
      unresolved: {
        type: 'array',
        description:
          'What still needs a person: specific row numbers where you were refused a value or the count ' +
          'was suppressed, and the ambiguities nobody settled. Be exhaustive. An empty list here is a ' +
          'strong claim and is usually wrong.',
        items: { type: 'string' },
      },
    },
    required: ['summary', 'changes', 'unresolved'],
    additionalProperties: false,
  },
  async execute() {
    // TODO(vicko), Day 5:
    //   - `isTrustedCaller`, then validate all three fields are present; `changes` may be empty (a
    //     read-only session is legitimate), `unresolved` may be too but see below
    //   - journal a 'submitReport' entry and render the report in the UI as the session's final state
    //   - offer the journal export alongside it — the report is the agent's account of the session and
    //     the journal is the record; showing them together is what lets the human check one against the
    //     other
    //
    // TODO(vicko), Day 5: when `unresolved` is empty but the journal holds refused reveals or suppressed
    // counts, accept the report and show the human the discrepancy next to it. Not a rejection — the
    // agent may have genuinely resolved things another way — but the human should see that the report
    // and the record disagree, and be the one to judge it.
    return notImplemented('submit_cleanup_report')
  },
}
