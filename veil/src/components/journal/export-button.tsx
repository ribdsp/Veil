'use client'

import { Button } from '@/components/ui/button'
import { QUERIES_PER_COLUMN } from '@/lib/guard/guard'
import { buildExport, download, type ExportFormat } from '@/lib/journal/export'
import { useSession } from '@/lib/store/dataset'

/**
 * Download the journal.
 *
 * Owner: Vicko.
 *
 * Labelled "Download record" and not "Export". Export is what a spreadsheet button says, and a human
 * clicking it in a privacy tool may reasonably expect their cleaned *data* — which this does not produce.
 * The one honest-looking mislabel in the app would be the one that sends the wrong file to a colleague.
 *
 * Two formats behind one control, because they are for two different readers rather than two tastes.
 * Markdown is the ticket somebody pastes this into; JSON is for a machine or a diff. Markdown leads because
 * the common case is a person explaining a session to another person.
 *
 * Disabled with a title when the journal is empty. A downloaded file containing zero entries looks like a
 * broken export rather than an unused session, and the title says which it is instead of leaving the human
 * to guess why the button does nothing.
 *
 * This is the one place `dataset.sourceName` is legitimately read. It is marked *"Never sent to the model"*
 * in `domain.ts`, and it is not being: the file goes to the human, and a record that does not name the file
 * it describes is the reason three of these end up in a downloads folder with no way to tell them apart.
 *
 * No new styling. The `Button` primitive belongs to whoever owns `components/`, and a control that invents
 * its own look is the one that stops matching the rest of the app after the next visual change.
 */
export function ExportButton() {
  // Narrow selectors, per CONTRIBUTING.md: a whole-store selector re-renders on every journal line, and
  // journal lines land on every tool call.
  const journal = useSession((state) => state.journal)
  const minGroupSize = useSession((state) => state.minGroupSize)
  const sourceName = useSession((state) => state.dataset?.sourceName)
  const rowCount = useSession((state) => state.dataset?.rowCount)

  const empty = journal.length === 0

  const save = (format: ExportFormat) => {
    /*
     * The journal outlives the dataset — it carries on across a clear, deliberately — so the file can
     * legitimately be built with nothing loaded. Naming that case rather than reporting row 0 of an unnamed
     * file: the `datasetLoaded` lines inside the record hold the real names and counts, and a header that
     * claimed otherwise would contradict the table under it.
     */
    download(
      buildExport(journal, {
        sourceName: sourceName ?? '(no dataset)',
        rowCount: rowCount ?? 0,
        minGroupSize,
        queriesPerColumn: QUERIES_PER_COLUMN,
      }),
      format,
    )
  }

  const disabledTitle =
    'Nothing has been recorded yet. The record fills as the agent asks questions and you answer them.'

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Download the session record">
      <Button
        disabled={empty}
        onClick={() => save('markdown')}
        title={
          empty
            ? disabledTitle
            : `Download ${journal.length} recorded event(s) as Markdown, for pasting into a ticket. ` +
              'Decisions only — this is not your data.'
        }
        aria-label="Download the session record as Markdown"
      >
        Download record
      </Button>
      <Button
        disabled={empty}
        onClick={() => save('json')}
        title={
          empty
            ? disabledTitle
            : `Download the same ${journal.length} event(s) as JSON, for a machine or a diff.`
        }
        aria-label="Download the session record as JSON"
      >
        JSON
      </Button>
    </div>
  )
}
