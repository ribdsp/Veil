import { notImplemented, type ToolDefinition } from '../tool-types'

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
    // TODO(riko), Day 6:
    //   - `isTrustedCaller`, then pop the top of the undo stack
    //   - an empty stack is a plain sentence, not an error: "nothing to undo"
    //   - if the top entry is `irreversible`, refuse and name what it was — and leave it on the stack,
    //     so a second call does not silently undo the transform beneath it
    //   - restore `previousValues` and journal an 'undoTransform' entry, author 'agent'
    //
    // Undo does not restore query budget, and that is deliberate. The questions were asked and the
    // answers were received; rewinding the data does not rewind what the agent learned. Refunding
    // budget on undo would make undo a way to buy more questions.
    return notImplemented('undo_last')
  },
}
