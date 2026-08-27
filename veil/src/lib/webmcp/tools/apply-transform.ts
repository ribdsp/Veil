import { notImplemented, type ToolDefinition } from '../tool-types'

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
  async execute() {
    // TODO(riko), Day 6:
    //   - `isTrustedCaller` first; refuse with the reason if the origin is not trusted
    //   - look up the proposal; an unknown or already-committed id is an error that names why
    //   - open a gate so the human approves this specific diff, and fail closed on timeout — a
    //     transform that commits because nobody was watching is exactly the outcome this design exists
    //     to prevent
    //   - apply through the same `applyTransform` path the dry run used, with `commit: true`
    //   - push an `AppliedTransform` with `previousValues` before mutating, not after
    //   - journal with `irreversible: true` for dropColumn and maskColumn
    //
    // `previousValues` is a `ReadonlyMap<RowId, string>` of the *old* cells, which means the undo stack
    // holds real values. It never crosses the guard and no tool can read it, and that asymmetry is
    // intentional: undo has to be exact, and an approximate undo on someone's data is not undo.
    return notImplemented('apply_transform')
  },
}
