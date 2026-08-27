/**
 * The journal, on screen.
 *
 * Owner: Faiq.
 *
 * TODO(faiq), Day 3: implement. One row per entry: time, author dot in `human` blue or `agent` purple, and the
 * detail line. Dense — this is a log, and 40 entries should fit without scrolling.
 *
 * TODO(faiq), Day 3: `irreversible` entries get `revealed` red and a left border. There is exactly one kind of
 * entry that qualifies, a granted reveal, and the point of making it loud is that scrolling back through the
 * session should make the pattern of one's own approvals visible at a glance.
 *
 * TODO(faiq), Day 4: no filter chips and no search in v1. A journal you can filter is a journal you can look at
 * and conclude nothing happened, because the filter was still set from ten minutes ago. Group by minute if it
 * gets long.
 *
 * TODO(faiq), Day 5: never truncate an entry's detail with an ellipsis and no way to see the rest. The detail on
 * a refusal is the agent's stated reason, and half of a justification is worse than none — it reads as
 * reasonable regardless of how it ends.
 */
export function JournalList() {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <h2 className="text-2xs font-medium uppercase tracking-wide text-faint">Record</h2>
      <p className="mt-2 text-xs text-muted">
        {/* TODO(faiq), Day 3 */}Every question, answer and refusal lands here.
      </p>
    </div>
  )
}
