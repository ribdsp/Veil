import { notImplemented, type ToolDefinition } from '../tool-types'

/**
 * Ask the person a closed question and block until they answer.
 *
 * Owner: Vicko. Contract: docs/tools.md § ask_human.
 *
 * The human as a tool in the agent's loop, which is the inversion worth demonstrating: normally a person
 * drives and the model responds. Here the model stops, asks, and waits.
 *
 * **Closed options, never a text box.** A model handed a free-text field asks open-ended questions
 * ("what would you like me to do about the dates?") and then has to parse prose it did not constrain.
 * Options make the question answerable in one click and the answer unambiguous — which also means a
 * question can be answered by someone who is not thinking hard, so the options have to be written for
 * that person.
 *
 * **The last option must be the one that changes nothing.** On timeout the gate resolves with the last
 * option, fail-closed. If you order the options so that the last one is destructive, an unattended tab
 * chooses it, and that would be entirely our fault rather than the human's.
 */
export const askHuman: ToolDefinition = {
  name: 'ask_human',
  description:
    'Ask the person a question and wait for their answer. Options only — no free text — so keep the ' +
    'question specific and the choices concrete ("Treat 01/02/2026 as 1 February or 2 January?"). Use ' +
    'this for judgement calls only a person can make about their own data, not for things you can ' +
    'measure yourself with the other tools. Put the do-nothing option last: if nobody is at the ' +
    'keyboard, the last option is what you get.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'The question, in plain language, for someone who has not read your reasoning. Say what ' +
          'depends on the answer.',
      },
      options: {
        type: 'array',
        description:
          'Between 2 and 4 short answers to choose from. The last one must be the safe, ' +
          'change-nothing choice — it is what a timeout selects.',
        items: { type: 'string' },
      },
    },
    required: ['question', 'options'],
    additionalProperties: false,
  },
  async execute() {
    // TODO(vicko), Day 4:
    //   - `requireString(args, 'question')` and `requireStringArray(args, 'options')`
    //   - reject fewer than 2 or more than 4 options, and reject duplicates: two identical options is a
    //     question that cannot be answered wrongly and cannot be answered usefully either
    //   - `createGate('ask', lastOption)`, push a `HumanQuestion`, await, journal both question and answer
    //   - return the chosen option verbatim, so the model can quote it back without paraphrasing
    //
    // Untrusted on purpose — asking a question discloses nothing. The only thing that leaves the page is
    // the option the human picked, which they wrote... except that they did not: the model wrote the
    // options. Worth remembering that a badly-phrased option is a way to get a human to assert something
    // they do not mean.
    return notImplemented('ask_human')
  },
}
