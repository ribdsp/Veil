import { callerIsTrusted, noteToolCall } from '@/lib/guard/host'
import { activeGuard, activeSourceName } from '@/lib/guard/session'

import { json, noDataset, requireString, toolError, type ToolDefinition } from '../tool-types'
import { findProposal, markCommitted } from './proposals'

/**
 * Commit a transform. Trusted, human-approved, and undoable.
 *
 * Owner: Riko. Contract: docs/tools.md § apply_transform.
 *
 * The only tool that changes the dataset. Three things must hold before a cell moves:
 *
 *  1. the caller reached a trusted tool (`exposedTo`, plus `isTrustedCaller` because `exposedTo` fails
 *     open on hosts that have not implemented it — docs/threat-model.md T4);
 *  2. a proposal from `propose_transform` exists and matches this spec, so the human approved the diff
 *     they were actually shown;
 *  3. for anything irreversible, the human clicked.
 *
 * Every applied transform pushes an `AppliedTransform` holding the previous values, which is what makes
 * `undo_last` possible. That undo stack lives in the tab and dies with it — Veil has no server to keep it
 * on, which is the same reason the data is safe.
 */
export const applyTransform: ToolDefinition = {
  name: 'apply_transform',
  description:
    'Apply a cleaning operation for real, after the human approves it. Requires a proposalId from ' +
    'propose_transform: the human is shown that dry run, and approves or refuses it. The response says ' +
    'how many rows changed and whether the change can be undone. Dropping or masking a column cannot be ' +
    'undone and needs an explicit confirmation. If the human refuses, that is a normal outcome — say ' +
    'what you would have changed and move on.',
  trusted: true,
  inputSchema: {
    type: 'object',
    properties: {
      proposalId: {
        type: 'string',
        description: 'The id returned by propose_transform for the dry run you want to commit.',
      },
      reason: {
        type: 'string',
        description:
          'One sentence, for the human and the audit journal: why this change is worth making. Write ' +
          'it for the person who owns the file, not for a log.',
      },
    },
    required: ['proposalId', 'reason'],
    additionalProperties: false,
  },
  async execute(args) {
    // Trust first, before the arguments are even read. `exposedTo` is supposed to keep this tool away from
    // untrusted origins, but it fails open where a host has not implemented it, so the check is repeated
    // here where it fails closed instead. docs/threat-model.md T4.
    if (!callerIsTrusted()) {
      return json({
        status: 'refused',
        reason:
          'This tool is only available to the page itself, and this call did not come from it. Nothing was ' +
          'changed. Read-only tools are still available to you.',
      })
    }

    const guard = activeGuard()
    if (guard === null) return noDataset()

    const proposalId = requireString(args, 'proposalId')
    if (!proposalId.ok) return toolError(proposalId.error)

    const reason = requireString(args, 'reason')
    if (!reason.ok) return toolError(reason.error)
    if (reason.value.trim().length === 0) {
      return toolError(
        "'reason' cannot be blank. A person reads it before deciding, and an unexplained change is usually " +
          'refused — say what is wrong with the column and what this fixes.',
      )
    }

    const proposal = findProposal(proposalId.value)
    if (proposal === null) {
      return toolError(
        `No proposal "${proposalId.value}". Ids come from propose_transform and belong to this session only ` +
          `— call it again to get a fresh dry run, then commit that id. A transform is never applied from a ` +
          `spec sent straight to this tool, because the human approves the diff they were shown, not a ` +
          `description of one.`,
      )
    }
    if (proposal.committed) {
      return toolError(
        `Proposal "${proposal.id}" has already been applied (${proposal.spec.kind} on ` +
          `"${proposal.spec.column}"). Re-running it would transform values that are already transformed. ` +
          `Dry-run the column again to see where it stands now.`,
      )
    }
    // A proposal describes the diff for one file. Committing it against another is a change nobody previewed,
    // even where the column names happen to line up.
    if (proposal.source !== activeSourceName()) {
      return toolError(
        `Proposal "${proposal.id}" was a dry run on "${proposal.source ?? 'no file'}", and the file now ` +
          `loaded is "${activeSourceName() ?? 'none'}". Nothing was changed. Dry-run the column again ` +
          `against this file and commit the new id.`,
      )
    }

    noteToolCall('apply_transform', `${proposal.spec.kind} on ${proposal.spec.column} via ${proposal.id}`)

    // The gate lives inside `guard.commit`: it dry-runs the spec again, shows *that* report to the human,
    // waits, and applies only on approval — failing closed on timeout, because a transform that commits
    // because nobody was watching is the exact outcome this design exists to prevent.
    const outcome = await guard.commit(proposal.spec, proposal.rows, reason.value)

    if (outcome.status === 'refused') {
      return json({
        status: 'refused',
        code: outcome.code,
        reason: outcome.reason,
        transform: proposal.spec,
        note:
          outcome.code === 'notApproved'
            ? 'The human declined, or nobody answered in time. This is a normal outcome, not an error: ' +
              'leave the column as it is, note in your report which rows a person still needs to look at, ' +
              'and carry on with the rest of the work. Do not re-propose the same change hoping for a ' +
              'different answer.'
            : outcome.code === 'datasetChanged'
              ? 'The dataset changed between the dry run and the commit, so this proposal describes a file ' +
                'that no longer exists. Dry-run it again and commit the new id.'
              : 'The transform could not be applied as specified. Profile the column and propose a ' +
                'different one.',
      })
    }

    markCommitted(proposal.id)
    const report = outcome.report

    return json({
      status: 'applied',
      transformId: outcome.id,
      proposalId: proposal.id,
      transform: proposal.spec,
      changedCount: report.changedCount,
      unchangedCount: report.unchangedCount,
      failedCount: report.failedCount,
      failedRowIds: report.failedRowIds,
      irreversible: outcome.irreversible,
      undoable: !outcome.irreversible,
      note: outcome.irreversible
        ? 'Applied, and this one cannot be undone — the previous values are not kept for a drop or a mask, ' +
          'so undo_last will refuse it. Say so in your report.'
        : `Applied. undo_last will restore the ${report.changedCount} changed row(s) if this was not what ` +
          `you intended — undoing costs nothing, but it does not refund the questions you spent getting ` +
          `here.` +
          (report.failedCount > 0
            ? ` ${report.failedCount} row(s) could not be transformed and were left exactly as they were; ` +
              `they are listed in failedRowIds and are the ones to mention to the human.`
            : ''),
    })
  },
}
