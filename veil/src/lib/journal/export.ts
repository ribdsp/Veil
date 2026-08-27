import type { JournalEntry } from '@/types/domain'

/**
 * Turn the journal into a file a human can keep.
 *
 * Owner: Vicko.
 *
 * This is the one export in Veil, and it is the one place where a leak would be permanent: the dataset stays in
 * the tab and dies on refresh, but this becomes a file, and the file gets attached to an email, and the email
 * gets forwarded. So the rule for everything below is that a journal export contains **decisions, not data** —
 * with the single, deliberate exception of a granted reveal, where the human chose to see one cell and the
 * record of what they saw is the point.
 */

export type ExportFormat = 'json' | 'markdown'

/** What goes in the file, in camelCase because it is our own format. */
export type JournalExport = {
  readonly tool: 'veil'
  readonly version: 1
  readonly exportedAt: string
  readonly dataset: { readonly sourceName: string; readonly rowCount: number }
  readonly settings: { readonly minGroupSize: number; readonly queriesPerColumn: number }
  readonly summary: {
    readonly toolCalls: number
    readonly suppressedAnswers: number
    readonly transformsApplied: number
    readonly revealsRequested: number
    readonly revealsGranted: number
  }
  readonly entries: readonly JournalEntry[]
}

/**
 * Build the export object.
 *
 * TODO(vicko), Day 6: implement. Compute `summary` from `entries` rather than accepting it as an argument —
 * a summary that can disagree with the entries it summarises will, eventually, and then the file is evidence
 * of nothing.
 *
 * TODO(vicko), Day 6: `exportedAt` as an ISO 8601 string with an offset, not a bare epoch number. Somebody will
 * open this in six weeks in a different timezone and needs to know when 14:32 was.
 *
 * TODO(vicko), Day 6: do not add the dataset, the transform stack, or `previousValues` to this shape, however
 * useful it sounds. `previousValues` is the user's raw data, and putting it in an export turns "here is my audit
 * log" into "here is my customer list" — sent by someone who read the button label and reasonably assumed it
 * exported the log.
 */
export function buildExport(
  _entries: readonly JournalEntry[],
  _context: {
    sourceName: string
    rowCount: number
    minGroupSize: number
    queriesPerColumn: number
  },
): JournalExport {
  throw new Error('buildExport: not implemented')
}

/**
 * Render the export.
 *
 * TODO(vicko), Day 6: implement both formats. JSON is `JSON.stringify(export, null, 2)`. Markdown is a table
 * of entries under a summary heading — worse for machines, and the one people actually paste into a ticket.
 *
 * TODO(vicko), Day 6: escape pipes and newlines in `detail` for the Markdown table. A tool name is safe; a
 * reveal reason is a sentence the agent wrote, and one pipe character in it silently shears the table for every
 * row after it.
 */
export function render(_data: JournalExport, _format: ExportFormat): string {
  throw new Error('render: not implemented')
}

/**
 * Hand the file to the browser.
 *
 * TODO(vicko), Day 6: implement with a `Blob`, `URL.createObjectURL`, a synthetic anchor click, and
 * `URL.revokeObjectURL` afterwards. No fetch, no upload, no API route — `connect-src 'self'` in the CSP would
 * block one anyway, and that is the point: the download path is the only way data leaves, and the human is
 * holding it.
 *
 * TODO(vicko), Day 6: name the file `veil-journal-<sourceName>-<date>.json`, sanitised. The default of
 * `download.json` is how three of these end up in a downloads folder with no way to tell which file each one
 * describes.
 */
export function download(_data: JournalExport, _format: ExportFormat): void {
  throw new Error('download: not implemented')
}
