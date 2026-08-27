import { callerIsTrusted, noteToolCall } from '@/lib/guard/host'
import { activeGuard } from '@/lib/guard/session'

import { json, noDataset, requireInteger, requireString, toolError, type ToolDefinition } from '../tool-types'

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
  async execute(args) {
    if (!callerIsTrusted()) {
      return json({
        status: 'refused',
        reason:
          'This tool is only available to the page itself, and this call did not come from it. No value was ' +
          'read and no request reached the human.',
      })
    }

    const guard = activeGuard()
    if (guard === null) return noDataset()

    const row = requireInteger(args, 'row')
    if (!row.ok) return toolError(row.error)
    if (row.value < 0) {
      return toolError("'row' must be 0 or above — a row number as returned by find_issues or find_duplicates.")
    }

    const column = requireString(args, 'column')
    if (!column.ok) return toolError(column.error)

    const reason = requireString(args, 'reason')
    if (!reason.ok) return toolError(reason.error)
    if (reason.value.trim().length === 0) {
      return toolError(
        "'reason' cannot be blank. It is shown to the person who owns the file, word for word, and it is " +
          'the whole basis on which they decide. Say what you will do with the value and what you cannot ' +
          'do without it.',
      )
    }

    noteToolCall('request_reveal', `row ${row.value} of "${column.value}"`)

    // The guard validates the row and column as *metadata* — in range, exists — and then waits for a person.
    // It never reads the cell: the value in a granted decision is put there by the UI, next to the human who
    // approved it. A refusal, including a timeout, is remembered for the rest of the session.
    const outcome = await guard.reveal({ column: column.value, row: row.value, reason: reason.value })

    switch (outcome.status) {
      case 'granted':
        return json({
          status: 'granted',
          row: row.value,
          column: column.value,
          value: outcome.value,
          note:
            'A person decided to show you this. It is now in your context permanently and cannot be taken ' +
            'back: do not repeat it in your cleanup report, do not quote it in a later tool call, and do ' +
            'not treat it as licence to ask for the neighbouring cells. Use it for the one decision you ' +
            'asked for, then describe the decision rather than the value.',
        })

      case 'refused':
        return json({
          status: 'refused',
          row: row.value,
          column: column.value,
          reason: outcome.reason,
          note:
            'A normal answer, not an error, and the end of this request. Do not ask for this cell again — a ' +
            'second request for the same cell is refused without reaching anybody. Carry on without the ' +
            'value: say in your report that row ' +
            `${row.value} of "${column.value}" needs a person to look at it, and why.`,
        })

      case 'alreadyRefused':
        return json({
          status: 'alreadyRefused',
          row: row.value,
          column: column.value,
          reason: outcome.reason,
          note:
            'This cell was already refused earlier in the session, so the request was not put to anybody ' +
            'again. Repeating a refused request turns a considered decision into an attrition contest, ' +
            'which is why it is enforced here rather than merely discouraged. List the row in your report ' +
            'and move on.',
        })

      case 'invalid':
        return json({
          status: 'invalid',
          row: row.value,
          column: column.value,
          reason: outcome.reason,
          note:
            'Nothing was asked of the human, because the row or column does not exist. Check the row ' +
            'numbers against a fresh find_issues result and the column name against describe_dataset.',
        })
    }
  },
}
