import { noteToolCall } from '@/lib/guard/host'
import { activeGuard, activeSourceName } from '@/lib/guard/session'

import { json, noDataset, refusal, toolError, type ToolDefinition } from '../tool-types'
import { recordProposal } from './proposals'
import { parseRows, parseTransformSpec } from './transform-spec'

/**
 * A dry run. Says what would change, changes nothing.
 *
 * Owner: Riko. Contract: docs/tools.md § propose_transform.
 *
 * Shares one code path with `apply_transform` — the same function, called with `commit: false`. That is
 * not a tidiness preference: a preview computed by different code than the commit is a preview that can
 * be wrong, and a wrong preview is worse than none, because the human approved the wrong one.
 * `transform/apply-transform.test.ts` asserts the two agree.
 *
 * Untrusted on purpose. Proposing costs nothing and reveals nothing beyond masked before/after pairs, so
 * any agent may explore freely; only the commit is gated.
 */
export const proposeTransform: ToolDefinition = {
  name: 'propose_transform',
  description:
    'Dry-run a cleaning operation and see what it would do without doing it: how many rows would ' +
    'change, how many would be left unchanged, how many would fail, and a few masked before/after ' +
    'examples (00/00/0000 → 0000-00-00). Nothing is modified. Always call this before ' +
    'apply_transform — the human is shown your dry run when deciding whether to approve, and a ' +
    'transform proposed without one usually gets refused.',
  inputSchema: {
    type: 'object',
    properties: {
      transform: {
        type: 'object',
        description:
          'The operation. "kind" selects it; the remaining fields depend on the kind. See the tool ' +
          'documentation for the full list of kinds and their arguments.',
        properties: {
          kind: {
            type: 'string',
            enum: [
              'trimWhitespace',
              'collapseSpaces',
              'changeCase',
              'normaliseDate',
              'normalisePhone',
              'normaliseNumber',
              'padLeft',
              'replacePlaceholderWithEmpty',
              'dropColumn',
              'maskColumn',
            ],
            description: 'Which operation to run.',
          },
          column: { type: 'string', description: 'The column to operate on.' },
          to: {
            type: 'string',
            description:
              'For changeCase: lower, upper, or title. For normaliseDate: the target layout, e.g. ' +
              'dateIso. For normalisePhone: phoneE164.',
          },
          defaultCountryCode: {
            type: 'string',
            description:
              'For normalisePhone, the dialling code to assume for numbers written in local form, e.g. ' +
              '+62. Required for that kind and never guessed: the wrong code produces a valid phone ' +
              'number belonging to somebody else.',
          },
          length: { type: 'integer', description: 'For padLeft, the width to pad to.' },
          padWith: { type: 'string', description: 'For padLeft, the character to pad with. Defaults to "0".' },
          placeholders: {
            type: 'array',
            description:
              'Ignored, and reported as ignored. The literals replacePlaceholderWithEmpty blanks out ' +
              '("N/A", "-", "null", …) are a fixed list, so no argument can widen a transform into ' +
              'deleting real values.',
            items: { type: 'string' },
          },
          keep: {
            type: 'string',
            enum: ['nothing', 'lastFour', 'domain'],
            description: 'For maskColumn, what to leave readable.',
          },
        },
        required: ['kind'],
        additionalProperties: false,
      },
      rows: {
        type: 'array',
        description:
          'Restrict the transform to these row numbers — usually the ones find_issues gave you. Omit ' +
          'to apply to the whole column. Not accepted for dropColumn, which removes the column from the ' +
          'whole file and has no per-row meaning; use maskColumn if you want to empty particular cells.',
        items: { type: 'integer' },
      },
    },
    required: ['transform'],
    additionalProperties: false,
  },
  async execute(args) {
    const guard = activeGuard()
    if (guard === null) return noDataset()

    const parsed = parseTransformSpec(args['transform'])
    if (!parsed.ok) return toolError(parsed.error)

    const rows = parseRows(args['rows'])
    if (!rows.ok) return toolError(rows.error)

    // A malformed call rather than a refusal, which is why it is answered here and not left to the guard: a
    // drop removes the column from the file, so "these rows" has nothing to mean. The guard refuses the
    // combination too — it has to, since `apply_transform` reaches it through a stored proposal — but this is
    // the layer that can say "your arguments contradict each other" in the channel reserved for that.
    if (parsed.spec.kind === 'dropColumn' && rows.rows !== undefined) {
      return toolError(
        `A dropColumn cannot be limited to ${rows.rows.length} row(s): it removes "${parsed.spec.column}" ` +
          `from the file, and a column is not dropped for some rows and kept for others. Omit 'rows' to drop ` +
          `it, or use maskColumn with those rows to empty those cells and keep the column.`,
      )
    }

    const spec = parsed.spec
    noteToolCall(
      'propose_transform',
      `${spec.kind} on ${spec.column}, ${rows.rows === undefined ? 'whole column' : `${rows.rows.length} row(s)`}`,
    )

    const verdict = guard.preview(spec, rows.rows)
    if (verdict.status === 'refused') {
      return refusal(verdict.code, verdict.reason, verdict.remainingQueries)
    }

    // Recorded only once the dry run succeeded, so an id always refers to a diff a human could be shown.
    // The file it described is recorded with it: an id from before a different CSV was loaded is not a
    // proposal about this one.
    const report = verdict.value
    const proposalId = recordProposal(spec, rows.rows, report, activeSourceName())

    return json({
      proposalId,
      transform: spec,
      rowsTargeted: rows.rows === undefined ? 'whole column' : rows.rows.length,
      changedCount: report.changedCount,
      unchangedCount: report.unchangedCount,
      failedCount: report.failedCount,
      // The rows the transform could not handle: a date it could not read, a phone with too few digits. Row
      // numbers, not values. These are the rows worth a human's attention or a reveal request.
      failedRowIds: report.failedRowIds,
      // Masked pairs, drawn from rows that actually changed, five of them. A preview of unchanged rows is a
      // preview of nothing, and an unmasked pair would make this the cheapest read in the surface.
      examples: report.examples.slice(0, MAX_PREVIEW_EXAMPLES).map((pair) => ({
        from: pair.from,
        to: pair.to,
      })),
      destructive: report.destructive,
      reversible: !report.destructive,
      remainingQueries: verdict.remainingQueries,
      ...(parsed.notes.length > 0 ? { notes: parsed.notes } : {}),
      note:
        `Nothing has changed. Pass "${proposalId}" to apply_transform with a reason to ask the human to ` +
        `approve exactly this dry run.` +
        (report.destructive
          ? ' This kind cannot be undone once applied: the previous values are gone, not stored, so ' +
            'undo_last will refuse it. Be sure before you propose the commit.'
          : ' It can be undone with undo_last if the result is not what you expected.') +
        (report.changedCount === 0
          ? ' As it stands this transform would change nothing — profile the column again before ' +
            'committing a no-op, since the likeliest explanation is that it is already clean or that the ' +
            'rows you named are not the affected ones.'
          : ''),
    })
  },
}

/** Five is enough to see the shape of a change and few enough to read. */
const MAX_PREVIEW_EXAMPLES = 5
