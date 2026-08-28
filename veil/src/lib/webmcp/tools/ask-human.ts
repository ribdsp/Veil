import { askHumanQuestion, hasDataset } from '../session'
import {
  json,
  noDataset,
  requireString,
  requireStringArray,
  toolError,
  type ToolDefinition,
} from '../tool-types'

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
 *
 * The budget here is not a row cap, because nothing is counted: it is 4 options, one question on screen at
 * a time, and a wait bounded by `GATE_TIMEOUT_MS`. An agent cannot queue questions or stack cards, and a
 * second call while one is pending is refused with a sentence saying to wait rather than overwriting the
 * card somebody is reading. No per-column query budget is charged — a question touches no column.
 *
 * Untrusted on purpose: asking discloses nothing. The only thing that leaves the page is the option the
 * human picked, which they wrote... except that they did not — the model wrote the options. Worth
 * remembering that a badly-phrased option is a way to get a human to assert something they do not mean,
 * which is why the options are shown verbatim to the person and echoed verbatim back to the model, with no
 * summarising step anywhere in between where the wording could quietly shift.
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

  async execute(args) {
    /*
     * Idle behaviour matches the rest of the surface: the tool stays registered and explains itself. A
     * question about a file nobody has opened cannot be about anything, and popping a modal card at
     * somebody who is still on the landing screen is a worse answer than a sentence.
     */
    if (!hasDataset()) return noDataset()

    const question = requireString(args, 'question')
    if (!question.ok) {
      return toolError(
        `${question.error} Pass the question you want a person to read, for example: ` +
          '{ "question": "The status column says \\"N/A\\" 61 times. Missing value or real category?", ' +
          '"options": ["Missing — treat as empty", "A real category — leave it", "Skip it for now"] }',
      )
    }

    const options = requireStringArray(args, 'options')
    if (!options.ok) {
      return toolError(
        `${options.error} Pass between 2 and 4 short answers, with the change-nothing choice last.`,
      )
    }
    const choices = options.value

    if (choices.length < 2 || choices.length > 4) {
      return toolError(
        `'options' must contain between 2 and 4 choices; got ${choices.length}. One choice is not a ` +
          'question, and more than four is a menu nobody reads carefully. If the real decision has more ' +
          'branches, ask the coarse question first and a follow-up after.',
      )
    }

    if (choices.some((choice) => choice.trim().length === 0)) {
      return toolError(
        "Every entry in 'options' must be a non-empty label. A blank choice is unclickable, and if it " +
          'is the last one it is also what a timeout selects.',
      )
    }

    /*
     * Duplicates, compared case-insensitively and ignoring surrounding space. Two identical options is a
     * question that cannot be answered wrongly and cannot be answered usefully either — whichever one the
     * human clicks, the agent learns nothing it did not already know, and the human has been made to
     * perform a decision instead of make one. "Yes" and "yes " are the same option to a reader, so they are
     * the same option here.
     */
    const seen = new Set<string>()
    for (const choice of choices) {
      const key = choice.trim().toLowerCase()
      if (seen.has(key)) {
        return toolError(
          `'options' repeats the choice "${choice}". Each option must be a different answer — two ` +
            'identical choices make the question unanswerable in any way that tells you something. ' +
            'Rewrite them so each one leads to a different action.',
        )
      }
      seen.add(key)
    }

    /*
     * The fail-closed default, decided here rather than inside the gate, because this is the line where it
     * is obvious that it is the last option. The `undefined` branch cannot be reached after the length
     * check above; `noUncheckedIndexedAccess` cannot see that, and the alternative is a cast — in the one
     * place where being wrong means an unattended tab picks the wrong answer. So it stays a real check.
     */
    const changeNothing = choices[choices.length - 1]
    if (changeNothing === undefined) {
      return toolError("'options' must contain between 2 and 4 choices; it was empty.")
    }

    const outcome = await askHumanQuestion(
      { question: question.value, options: choices },
      changeNothing,
    )

    if (outcome.status === 'busy') {
      return toolError(
        'A question is already on screen waiting for this person, and Veil shows one at a time so they ' +
          'can read it properly. Wait for your previous ask_human call to return before asking another.',
      )
    }

    if (outcome.status === 'unanswered') {
      /*
       * Say plainly that nobody answered. The agent gets the same option a human would have had to click,
       * so it can carry on — but if it is not told how the answer arrived it will write "the user chose to
       * leave the column alone" in its report, and that sentence will be read as a decision somebody made.
       */
      return json({
        answer: outcome.answer,
        answeredBy: 'nobody',
        note:
          outcome.cause === 'timeout'
            ? 'Nobody answered in time, so the last (change-nothing) option stands. Do not report this ' +
              'as the person\'s decision: carry on without it, and list the question in your cleanup ' +
              'report as something they still need to settle.'
            : 'The question was closed before anyone answered — the session changed underneath it — so ' +
              'the last (change-nothing) option stands. Do not report this as the person\'s decision.',
      })
    }

    // Verbatim, so the model can quote the answer back without paraphrasing it into something the human
    // did not say. The whole value of closed options is that the answer is a string both sides agree on.
    return json({ answer: outcome.answer, answeredBy: 'human' })
  },
}
