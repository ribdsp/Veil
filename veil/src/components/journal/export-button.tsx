'use client'

import { Button } from '@/components/ui/button'

/**
 * Download the journal.
 *
 * Owner: Vicko.
 *
 * TODO(vicko), Day 6: implement, calling `lib/journal/export`. Two formats behind one button — JSON for a
 * machine, Markdown for the ticket somebody is about to paste it into.
 *
 * TODO(vicko), Day 6: label it "Download record", not "Export". Export is what a spreadsheet button says, and a
 * human clicking it in a privacy tool may reasonably expect their cleaned *data* — which this does not produce.
 * The one honest-looking mislabel in the app would be the one that sends the wrong file to a colleague.
 *
 * TODO(vicko), Day 6: disable it with a title when the journal is empty. A downloaded file containing zero
 * entries looks like a broken export rather than an unused session.
 */
export function ExportButton() {
  return (
    <Button aria-label="Download the session record">Download record</Button>
  )
}
