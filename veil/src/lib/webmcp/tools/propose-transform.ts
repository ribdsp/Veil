import { notImplemented, type ToolDefinition } from '../tool-types'

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
    'examples (99/99/9999 → 9999-99-99). Nothing is modified. Always call this before ' +
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
          length: { type: 'integer', description: 'For padLeft, the width to pad to.' },
          padWith: { type: 'string', description: 'For padLeft, the character to pad with. Defaults to "0".' },
          placeholders: {
            type: 'array',
            description:
              'For replacePlaceholderWithEmpty, the literal strings to treat as empty — e.g. ["N/A", "-"].',
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
          'to apply to the whole column.',
        items: { type: 'integer' },
      },
    },
    required: ['transform'],
    additionalProperties: false,
  },
  async execute() {
    // TODO(riko), Day 5:
    //   - parse the transform object into a `TransformSpec`; an unknown `kind` lists the valid ones
    //   - `guard.dryRun(spec, rows)` → `TransformReport`
    //   - store the report against a proposal id and return it, so `apply_transform` can refuse a
    //     commit whose proposal it has never seen
    //   - examples are masked pairs, capped at 5, and drawn from rows that actually changed — a preview
    //     of unchanged rows is a preview of nothing
    //
    // Not charged against the query budget, and that took some arguing. A dry run does reveal
    // information (how many rows match a shape), so in principle it should cost. But an agent that
    // cannot afford to check its own work will apply transforms it has not checked, and an unchecked
    // transform on someone's only copy of their data is a worse outcome than a slightly larger side
    // channel. The masking of the examples is what makes that trade acceptable.
    return notImplemented('propose_transform')
  },
}
