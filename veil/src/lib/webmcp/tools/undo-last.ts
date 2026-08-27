import { callerIsTrusted, noteToolCall } from '@/lib/guard/host'
import { activeGuard } from '@/lib/guard/session'

import { json, noDataset, type ToolDefinition } from '../tool-types'

/**
 * Take back the last reversible transform.
 *
 * Owner: Riko. Contract: docs/tools.md § undo_last.
 *
 * Trusted, because it mutates. Cheap, because it restores values the tab already held.
 *
 * The reason it exists at all is behavioural rather than technical: an agent that knows a mistake can be
 * undone proposes a transform and checks the result, while an agent facing an irreversible edit hedges,
 * asks the human about everything, and gets much less done. Undo is what makes the agent willing to act.
 */
export const undoLast: ToolDefinition = {
  name: 'undo_last',
  description:
    'Undo the most recent transform, restoring the values it changed. Only reversible transforms can ' +
    'be undone — dropping or masking a column cannot be taken back, and the response will say so ' +
    'rather than pretending. Use this freely if a transform did something you did not intend; it is ' +
    'cheaper than asking the human to fix it afterwards.',
  trusted: true,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute() {
    if (!callerIsTrusted()) {
      return json({
        status: 'refused',
        reason:
          'This tool is only available to the page itself, and this call did not come from it. Nothing was ' +
          'changed.',
      })
    }

    const guard = activeGuard()
    if (guard === null) return noDataset()

    noteToolCall('undo_last', 'undo requested')

    // The stack lives in the guard, holding `previousValues` for each applied transform. Those are real
    // cell values, they never cross back out, and no tool can read them: undo has to be exact, and an
    // approximate undo on somebody's data is not undo.
    const outcome = guard.undo()

    switch (outcome.status) {
      case 'undone':
        return json({
          status: 'undone',
          transformId: outcome.id,
          transform: outcome.kind,
          column: outcome.column,
          restoredCount: outcome.restoredCount,
          note:
            `Undone: ${outcome.restoredCount} row(s) in "${outcome.column}" are back to their previous ` +
            `values. Your query budget is unchanged — the questions were asked and the answers received, ` +
            `and rewinding the data does not rewind what you learned. Profile the column again if you need ` +
            `to see where it now stands; that costs a question.`,
        })

      case 'empty':
        return json({
          status: 'nothingToUndo',
          note:
            'Nothing to undo: no transform has been applied in this session. This is not an error. If a ' +
            'column looks wrong, it looked that way in the file.',
        })

      case 'irreversible':
        return json({
          status: 'irreversible',
          transform: outcome.kind,
          column: outcome.column,
          note:
            `The last transform was ${outcome.kind} on "${outcome.column}", which cannot be undone — the ` +
            `previous values were not kept, by design, because a stored copy of a column somebody asked to ` +
            `drop is the column still being there. It stays at the top of the stack, so calling undo_last ` +
            `again will not quietly undo the transform underneath it instead. Tell the human what happened; ` +
            `restoring that column means reloading the original file.`,
        })

      case 'failed':
        return json({
          status: 'failed',
          reason: outcome.reason,
          note:
            'The undo could not be completed and the data was left as it was rather than half-restored. ' +
            'Report this to the human before making any further change.',
        })
    }
  },
}
