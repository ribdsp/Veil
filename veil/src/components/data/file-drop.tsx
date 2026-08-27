import type { ReactNode } from 'react'

/**
 * Take a CSV without sending it anywhere.
 *
 * Owner: Faiq.
 *
 * TODO(faiq), Day 2: implement as a drop target wrapping the whole workspace, plus a file input for the people
 * who do not drag files. `event.preventDefault()` on both `dragover` and `drop`, or the browser navigates away
 * from the app to display the CSV as text — losing the session and the journal with it.
 *
 * TODO(faiq), Day 2: say "nothing is uploaded" on the empty state, and mean it literally: there is no upload
 * endpoint in this app, `connect-src 'self'` blocks one, and `parseCsv` runs in a Web Worker in this tab. It is
 * the single most important sentence in the interface and it is the one a first-time user will not believe, so
 * put the reason next to it rather than the claim alone.
 *
 * TODO(faiq), Day 3: offer the sample files from `public/samples/` on the empty state. A judge with no CSV to
 * hand needs one click to a messy dataset, and "download this, then drag it back" is where an evaluation stops.
 *
 * TODO(faiq), Day 5: refuse a file over ~50 MB with a real explanation rather than freezing. Papa Parse in a
 * worker handles it, but the table and every profile pass are on the UI thread — and a locked tab during a
 * demo reads as a crash.
 */
export function FileDrop({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>
}
