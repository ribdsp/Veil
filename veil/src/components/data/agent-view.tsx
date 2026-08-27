/**
 * The same table, as the agent sees it.
 *
 * Owner: Faiq.
 *
 * The most important component in the app, and the one that makes the pitch without narration: identical grid,
 * identical row heights, every cell under a hatch, and the column headers annotated with exactly what the agent
 * has been told — type, fill rate, pattern buckets, `distinct: 40+`.
 *
 * **This pane must never receive a cell value as a prop.** Not to blur it, not to hatch it, not "just to get the
 * column widths right". A value passed into this component is a value in the DOM, and then the honest claim
 * "there is nothing underneath the hatch" becomes a false one that a devtools panel disproves in four seconds —
 * on stage. Widths come from the header text and a fixed `--col-min-width`.
 *
 * TODO(faiq), Day 4: implement the hatch grid, reusing the *same* virtualiser as `data-table.tsx` so the two
 * panes cannot drift out of alignment. Extract it into `components/data/use-row-window.ts` rather than copying
 * it: two copies of the row arithmetic is two chances to be off by one, and the bug looks like a privacy bug.
 *
 * TODO(faiq), Day 4: un-hatch a cell only for a granted reveal, and render it with `.veil-revealed`. It stays
 * uncovered for the rest of the session — re-hatching it implies the reveal was temporary, and it was not: the
 * agent has the value now and no UI state changes that.
 *
 * TODO(faiq), Day 5: when a column's profile is absent from `knownProfiles`, grey its header out entirely. The
 * agent has not asked about that column, and showing it fully annotated makes the interface claim the agent
 * knows more than it does — which is the opposite of the error this product exists to prevent.
 */
export function AgentView() {
  return (
    <div className="h-full overflow-auto">
      <p className="p-4 text-xs text-muted">
        {/* TODO(faiq), Day 4: replace with the hatched grid. */}
        What the agent can see: shapes, counts, and patterns. No values.
      </p>
    </div>
  )
}
