import {
  checkTrustedCall,
  hasDataset,
  journalReportDiscrepancy,
  journalReportSubmitted,
  revealTally,
  sessionRefusals,
  type OpenRefusal,
} from '../session'
import { json, requireString, requireStringArray, toolError, type ToolDefinition } from '../tool-types'

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
 *
 * ## The discrepancy rule
 *
 * When `unresolved` is empty and the journal holds refusals, the report is **accepted anyway** and the
 * disagreement is surfaced twice: as its own journal line, so it is visible to somebody scanning the
 * record who never reads the report, and in the response, so the agent is told what it appears to have
 * left out. Not a rejection, for a reason worth keeping: the agent may genuinely have resolved a
 * suppressed count another way — a structural fix does not need the number — and a tool that rejected the
 * report would be Veil overruling a human's judgement about a human's own file. The human is the one who
 * gets to decide whether the omission matters. Our job is to make sure they see it.
 *
 * ## Where the report goes
 *
 * Into the journal, and nowhere else. `SessionState` is frozen and has no field for a submitted report, so
 * there is no state for the UI to render it from; the `reportSubmitted` entries *are* the report, and the
 * UI can find them by kind. That also means the report cannot be edited after the fact, which is the right
 * property for the thing the human is going to check the record against.
 *
 * TODO(vicko), Day 5: render the report on screen next to the download control, reading the
 * `reportSubmitted` entries back out of the journal. Showing the agent's account and the record side by
 * side is what lets a human check one against the other; a report shown on its own is just a claim. It has
 * to read from the journal rather than from session state, because giving `SessionState` a field for it is
 * a change to the frozen `domain.ts` and therefore a conversation rather than a commit.
 *
 * Response budget: at most 20 omitted refusals are named back to the agent, with `truncated` and an
 * instruction to read the record rather than a bare cut. Input is capped at 100 items per list — a report
 * with a thousand bullet points is not a report anybody reads.
 */

/** Named back to the agent, and no more than this. The full list is in the journal, which is the record. */
const MAX_OMISSIONS_LISTED = 20

/** Per list. Past this it is a data dump rather than a summary, and the human is the one who pays. */
const MAX_ITEMS_PER_LIST = 100

/** Turn a refusal into the short phrase the agent and the journal both use to name it. */
function nameRefusal(refusal: OpenRefusal): string {
  return `${refusal.kind}: ${refusal.subject}`
}

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

  async execute(args) {
    /*
     * The origin check first, before any work and before anything else is journalled.
     *
     * `execute(args)` is the whole signature WebMCP gives a tool: there is no caller identity in it, so no
     * origin is passed here and the check always takes its "the host did not report an origin" branch. That
     * is not a bug being papered over — it is exactly what docs/threat-model.md (T4) predicts, and it is why
     * the controls that actually hold are the human gates rather than the spec. Faking an origin to make
     * this look enforced would be the worst available outcome: a privacy control that reads as working.
     *
     * Through the bridge rather than straight to `register-tools.ts`, because the bridge is what guarantees
     * the observer that journals this decision is wired before the decision is made. Same check, same
     * sentence, one journal line.
     */
    const caller = await checkTrustedCall()

    if (!caller.allowed) {
      // A refusal, not an `isError`: the call was well-formed and the answer is no.
      return json({
        submitted: false,
        status: 'refused',
        reason: caller.detail,
        note:
          'Ending the run is one of the four actions Veil gates by origin. Everything you have already ' +
          'found still stands — hand your findings to the person another way.',
      })
    }

    const summary = requireString(args, 'summary')
    if (!summary.ok) {
      return toolError(
        `${summary.error} Two or three sentences on the state of the file, written for whoever owns it ` +
          'rather than for another engineer.',
      )
    }

    const changes = requireStringArray(args, 'changes')
    if (!changes.ok) {
      return toolError(
        `${changes.error} One plain sentence per change, with row counts. Pass [] if you changed nothing ` +
          '— a read-only pass over a file is a legitimate session and an empty list is the honest report ' +
          'of one.',
      )
    }

    const unresolved = requireStringArray(args, 'unresolved')
    if (!unresolved.ok) {
      return toolError(
        `${unresolved.error} One sentence per thing a person still has to look at: the rows you were ` +
          'refused, the counts that came back suppressed, the ambiguities nobody settled.',
      )
    }

    for (const [key, list] of [
      ['changes', changes.value],
      ['unresolved', unresolved.value],
    ] as const) {
      if (list.length > MAX_ITEMS_PER_LIST) {
        return toolError(
          `'${key}' has ${list.length} entries and at most ${MAX_ITEMS_PER_LIST} are accepted. Group ` +
            'them by column or by kind of problem — a list this long is read by nobody, which makes it ' +
            'the same as an empty one.',
        )
      }
      if (list.some((item) => item.trim().length === 0)) {
        return toolError(`Every entry in '${key}' must be a non-empty sentence; one of them was blank.`)
      }
    }

    const refused = sessionRefusals()
    const reveals = revealTally()

    /*
     * The report, as journal lines. `detail` carries the agent's own prose, which is safe: it is the
     * agent's account of its own session, and the agent never saw a cell value unless a human granted one.
     */
    journalReportSubmitted(
      `${summary.value} — ${changes.value.length} change(s) listed, ${unresolved.value.length} item(s) ` +
        `left for a person. Reveals requested ${reveals.requested}, granted ${reveals.granted}. The ` +
        `record holds ${refused.length} refusal(s).`,
    )
    for (const change of changes.value) journalReportSubmitted(`Reported as changed: ${change}`)
    for (const item of unresolved.value) journalReportSubmitted(`Reported as needing a person: ${item}`)

    const omitted = unresolved.value.length === 0 ? refused : []
    if (omitted.length > 0) {
      journalReportDiscrepancy(
        `The report lists nothing as unresolved, but this session recorded ${omitted.length} ` +
          `refusal(s): ${omitted.map(nameRefusal).join('; ')}. The report was accepted — the agent may ` +
          'have resolved these another way — but the two accounts disagree and this line is here so ' +
          'whoever reads the record can judge which is right.',
      )
    }

    const listed = omitted.slice(0, MAX_OMISSIONS_LISTED)

    return json({
      submitted: true,
      recordedIn: 'journal',
      changesListed: changes.value.length,
      unresolvedListed: unresolved.value.length,
      /* From the record rather than from the agent's own count of them, which is the point of reporting it. */
      revealsRequested: reveals.requested,
      revealsGranted: reveals.granted,
      refusalsInRecord: refused.length,
      datasetStillLoaded: hasDataset(),
      discrepancy:
        omitted.length === 0
          ? null
          : {
              omittedCount: omitted.length,
              omitted: listed.map(nameRefusal),
              truncated: omitted.length > listed.length,
              note:
                'Your report lists nothing as unresolved, but the record shows these were refused, ' +
                'suppressed, or ran out of budget. The report has been accepted and the disagreement is ' +
                'in the journal for the human to judge. If you did resolve them another way, say how; ' +
                'if you did not, call submit_cleanup_report again with them listed in unresolved.',
            },
      originNote: caller.detail,
      note:
        'Report filed. It lives in the journal rather than in app state, so the human reads it next to ' +
        'the record of what actually happened and can check one against the other. Stop here: this is ' +
        'the end of the run.',
    })
  },
}
