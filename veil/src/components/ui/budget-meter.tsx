/**
 * How much of the agent's per-column query budget is left.
 *
 * Owner: Faiq.
 *
 * TODO(faiq), Day 4: implement as a row of small bars, one per column, filled by `queriesUsed[column]` against
 * `queriesPerColumn`. Not a single average across the dataset: the budget is per column precisely so that
 * hammering one column runs out while the rest stay available, and an average hides exactly that.
 *
 * TODO(faiq), Day 4: show the number as `4/12`, not a percentage. This is a count of questions asked about a
 * specific column, and "33%" invites the human to read it as progress through a task rather than as a
 * consumable that will run out.
 *
 * TODO(faiq), Day 4: tint a column's bar `suppressed` amber at 2 remaining and `revealed` red at 0. An
 * exhausted column is a column where every further question is refused, and the human needs to know that
 * before they wonder why the agent has started asking them things instead.
 */
export function BudgetMeter() {
  return (
    <div className="flex items-center gap-2 text-2xs text-muted" aria-label="Query budget">
      <span className="font-mono">budget</span>
      <span className="h-1.5 w-24 rounded-full bg-line" role="presentation" />
    </div>
  )
}
