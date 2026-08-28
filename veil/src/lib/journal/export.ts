import type { JournalEntry } from '@/types/domain'

import { revealsGranted as countRevealsGranted } from './journal'

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
 * An ISO 8601 timestamp in *local* time, with the offset spelled out.
 *
 * Not `toISOString()`, which is always UTC: somebody will open this in six weeks in a different timezone and
 * needs to know when 14:32 was, which means the wall clock the human was looking at plus the offset that anchors
 * it. `2026-08-27T14:32:09+07:00` answers that; `2026-08-27T07:32:09Z` makes them do arithmetic they will get
 * wrong.
 */
function isoWithOffset(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(Math.trunc(Math.abs(value))).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${day}T${clock}${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`
}

/**
 * Build the export object.
 *
 * `summary` is computed from `entries` rather than accepted as an argument. A summary that can disagree with the
 * entries it summarises will, eventually, and then the file is evidence of nothing — the numbers are only worth
 * having if the reader can recount them from the table underneath.
 *
 * `transformsApplied` counts `transformApplied` lines and is deliberately *not* netted against `transformUndone`.
 * A change that was made and then reverted still happened, the undo has its own line two rows down, and a
 * summary that quietly cancels the pair hides the most interesting thing in the session.
 *
 * Nothing here carries the dataset, the transform stack, or `previousValues`, however useful that sounds.
 * `previousValues` is the user's raw data, and putting it in an export turns "here is my audit log" into "here is
 * my customer list" — sent by someone who read the button label and reasonably assumed it exported the log.
 */
export function buildExport(
  entries: readonly JournalEntry[],
  context: {
    sourceName: string
    rowCount: number
    minGroupSize: number
    queriesPerColumn: number
  },
): JournalExport {
  const count = (kind: JournalEntry['kind']): number =>
    entries.filter((line) => line.kind === kind).length

  return {
    tool: 'veil',
    version: 1,
    exportedAt: isoWithOffset(Date.now()),
    dataset: { sourceName: context.sourceName, rowCount: context.rowCount },
    settings: {
      minGroupSize: context.minGroupSize,
      queriesPerColumn: context.queriesPerColumn,
    },
    summary: {
      toolCalls: count('toolCalled'),
      suppressedAnswers: count('answerSuppressed'),
      transformsApplied: count('transformApplied'),
      revealsRequested: count('revealRequested'),
      revealsGranted: countRevealsGranted(entries),
    },
    entries,
  }
}

/**
 * Make a string safe to put in one cell of a Markdown table.
 *
 * A tool name is safe; a reveal reason is a sentence the agent wrote, and one pipe character in it silently
 * shears the table for every row after it — the rest of the file still renders, just wrong, which is the worst
 * available outcome for a document whose job is to be checkable. Newlines end the row outright, so they collapse
 * to a space.
 */
function tableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ')
}

/**
 * Render the export.
 *
 * JSON for a machine or a diff; Markdown for the ticket somebody pastes this into. Markdown is a table of
 * entries under a summary heading — worse for machines, and the one people actually read.
 */
export function render(data: JournalExport, format: ExportFormat): string {
  if (format === 'json') return JSON.stringify(data, null, 2)

  const { summary, settings, dataset } = data
  const lines: string[] = [
    `# Veil journal — ${dataset.sourceName}`,
    '',
    `Exported ${data.exportedAt} · ${dataset.rowCount} rows · minimum group size ${settings.minGroupSize} · ` +
      `${settings.queriesPerColumn} queries per column`,
    '',
    '## Summary',
    '',
    '| Measure | Count |',
    '| --- | --- |',
    `| Tool calls | ${summary.toolCalls} |`,
    `| Suppressed answers | ${summary.suppressedAnswers} |`,
    `| Transforms applied | ${summary.transformsApplied} |`,
    `| Reveals requested | ${summary.revealsRequested} |`,
    `| Reveals granted | ${summary.revealsGranted} |`,
    '',
    '## Entries',
    '',
    '| # | Time | Author | Event | Subject | Detail |',
    '| --- | --- | --- | --- | --- | --- |',
  ]

  data.entries.forEach((line, index) => {
    // The irreversible flag is carried into the text, because red is not available in Markdown and a granted
    // reveal is the one line a reader must not skim past.
    const event = line.irreversible ? `${line.kind} (irreversible)` : line.kind
    lines.push(
      `| ${index + 1} | ${isoWithOffset(line.at)} | ${line.author} | ${event} | ` +
        `${tableCell(line.subject)} | ${tableCell(line.detail)} |`,
    )
  })

  if (data.entries.length === 0) {
    lines.push('| — | — | — | — | — | Nothing was recorded in this session. |')
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * The file name: `veil-journal-<sourceName>-<date>.<ext>`, sanitised.
 *
 * The default of `download.json` is how three of these end up in a downloads folder with no way to tell which
 * file each one describes. The source name is a name the user typed, so it can hold spaces, slashes and dots;
 * everything outside a small safe set collapses to a dash.
 */
function fileName(sourceName: string, exportedAt: string, extension: string): string {
  const stem = sourceName
    .replace(/\.(csv|tsv|xlsx|xls|txt)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  const date = exportedAt.slice(0, 10)
  return `veil-journal-${stem === '' ? 'dataset' : stem}-${date}.${extension}`
}

/**
 * Hand the file to the browser.
 *
 * A `Blob`, an object URL, a synthetic anchor click, and then the URL is revoked. No fetch, no upload, no API
 * route — `connect-src 'self'` in the CSP would block one anyway, and that is the point: the download path is
 * the only way data leaves, and the human is holding it.
 *
 * Not covered by tests: `vitest.config.ts` runs in `environment: 'node'`, deliberately, so everything above this
 * function is pure and testable and this one is exercised by clicking the button.
 */
export function download(data: JournalExport, format: ExportFormat): void {
  const extension = format === 'json' ? 'json' : 'md'
  const mediaType = format === 'json' ? 'application/json' : 'text/markdown'
  const blob = new Blob([render(data, format)], { type: `${mediaType};charset=utf-8` })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName(data.dataset.sourceName, data.exportedAt, extension)
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  URL.revokeObjectURL(url)
}
