/**
 * The human's table. Values in it, nothing hidden.
 *
 * Owner: Faiq.
 *
 * This pane is the control in the experiment: it is what the file actually contains, so the hatched pane beside
 * it means something. It has no privacy logic at all and it must not grow any — the human is looking at their
 * own data on their own machine.
 *
 * TODO(faiq), Day 3: implement with windowing. 50,000 rows × 24 columns is 1.2M cells, and rendering them all
 * makes the tab unresponsive for a minute — long enough that the human force-quits before the agent's first
 * tool call arrives. Render the visible window plus a small overscan and absolutely position the rows;
 * `--row-height` in `globals.css` is fixed so the arithmetic is exact.
 *
 * TODO(faiq), Day 3: highlight rows named in the current `find_issues` result, and scroll to the first one. The
 * agent says "412 rows have a malformed date"; the human's next move is to look at one, and making them find it
 * by hand is where trust in the finding goes.
 *
 * TODO(faiq), Day 4: mark cells changed by an applied transform with a left border in `agent` purple, and cells
 * the human edited in `human` blue. Colour is enough here — a legend nobody reads beats a badge per cell at this
 * density, and the journal carries the authoritative account anyway.
 */
export function DataTable() {
  return (
    <div className="h-full overflow-auto">
      <p className="p-4 text-xs text-muted">
        {/* TODO(faiq), Day 3: replace with the virtualised grid. */}
        Your data appears here. It stays in this tab.
      </p>
    </div>
  )
}
