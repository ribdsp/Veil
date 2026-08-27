import { notImplemented, type ToolDefinition } from '../tool-types'

/**
 * Petition a human for one cell, with a written reason, and accept being told no.
 *
 * Owner: Riko. Contract: docs/tools.md § request_reveal. Design: README § The two ideas we're proudest of.
 *
 * The idea the whole project is built around. Every other privacy tool answers "how do we stop the model
 * seeing data" with a filter. This answers it with a *petition*: the agent must name the row, name the
 * column, and write an argument for why this specific value is necessary — then wait for a person to
 * read the argument and decide.
 *
 * Three properties make it work, and each one is load-bearing:
 *
 *  - **One cell.** Not a row, not a column, not a range. The unit is what makes the decision reviewable.
 *  - **A written reason.** Free text, from the model, shown to the human verbatim. It is the only place
 *    in Veil where the model's own words reach the person, and it is what makes the decision informed
 *    rather than a dialog to click through.
 *  - **A refusal the agent must survive.** `{ granted: false }` is a normal, expected reply. The
 *    description says so, because a model that treats refusal as an error retries, and a model that
 *    retries turns a considered decision into an attrition contest.
 *
 * Fail-closed on timeout: `{ granted: false, reason: 'no response' }`, once, and the call is over. See
 * `blocking.ts` for why Veil does not hand out a ticket to poll.
 */
export const requestReveal: ToolDefinition = {
  name: 'request_reveal',
  description:
    'Ask the human to show you one single cell value, giving a reason they will read. Expensive and ' +
    'permanently logged: use it only when a masked shape genuinely is not enough — for example when two ' +
    'rows look like duplicates and one character decides it. State plainly why this exact cell matters. ' +
    'The human may refuse, and refusal is a normal answer: continue your work without the value and say ' +
    'in your report which rows a person still needs to check. Do not ask again for a cell you have been ' +
    'refused.',
  trusted: true,
  inputSchema: {
    type: 'object',
    properties: {
      row: {
        type: 'integer',
        minimum: 0,
        description: 'Row number, as returned by find_issues or find_duplicates.',
      },
      column: { type: 'string', description: 'Column name from describe_dataset.' },
      reason: {
        type: 'string',
        description:
          'Why you need this specific value, in one or two sentences, addressed to the person who owns ' +
          'the file. Say what you will do with it and what you cannot do without it. A vague reason is ' +
          'usually refused, and rightly.',
      },
    },
    required: ['row', 'column', 'reason'],
    additionalProperties: false,
  },
  async execute() {
    // TODO(riko), Day 6:
    //   - `isTrustedCaller`; then validate the row is in range and the column exists
    //   - refuse immediately if this (row, column) has already been refused this session, and say so.
    //     Re-asking is the failure mode the description warns against, and enforcing it in code is more
    //     reliable than asking a model not to
    //   - `createGate('reveal', { granted: false, reason: 'no response' })`, push a `RevealRequest` into
    //     the store, and await
    //   - journal the request *and* the decision as separate entries. A request that was refused is the
    //     most interesting line in the journal and must survive independently of the outcome
    //   - on grant, return the value plainly, with a reminder in the same response that it is now in the
    //     model's context permanently and should not be repeated back in the report
    //
    // Deliberately not implemented: partial reveals (last four digits, domain only). The masking
    // primitives already exist in `redact.ts` and `maskColumn` has a `keep` field; what is missing is
    // the request shape and the approval UI. docs/privacy-guard.md flags it as the best first
    // contribution to this repository, and it belongs here.
    return notImplemented('request_reveal')
  },
}
