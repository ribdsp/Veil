import type { ColumnId } from '@/types/domain'

import { QUERIES_PER_COLUMN } from './guard'

/**
 * The per-column query budget.
 *
 * Owner: Riko. Required reading: docs/privacy-guard.md § The query budget.
 *
 * k-anonymity alone is defeated by differencing: a sequence of individually legal, individually above-k
 * answers whose *differences* describe one person. No single check can catch it, because the leak is not
 * in any answer — it is in the relationship between them. Bounding the number of overlapping questions is
 * the cheap, exact, explicable defence. (The rigorous one is a differential-privacy budget with calibrated
 * noise; docs/privacy-guard.md says plainly why Veil does not do that.)
 *
 * Charged **per column, per session**. A session-wide budget would let an agent spend everything on one
 * column, which is precisely the attack.
 */

export type BudgetState = ReadonlyMap<ColumnId, number>

export type ChargeResult =
  | { ok: true; remaining: number; state: BudgetState }
  | { ok: false; reason: string; remaining: 0 }

/** Distinct columns, in the order they were named. */
function distinct(columns: readonly ColumnId[]): readonly ColumnId[] {
  return [...new Set(columns)]
}

/**
 * Charge one question against every column named.
 *
 * All or nothing: if any column is exhausted, nothing is charged and nothing is answered. A partial charge
 * would leave the agent having paid for an answer it did not get, and — worse — a partial *answer* across
 * a crosstab would be a table with one axis silently missing, which reads as a real result.
 *
 * Returns a new state rather than mutating the map — the store holds it, and an in-place charge inside the
 * guard makes the budget untestable without a store.
 */
export function charge(
  state: BudgetState,
  columns: readonly ColumnId[],
  limit: number = QUERIES_PER_COLUMN,
): ChargeResult {
  const named = distinct(columns)
  const spent = named.filter((column) => remaining(state, column, limit) <= 0)

  if (spent.length > 0) {
    const which = spent.map((column) => `"${column}"`).join(', ')
    return {
      ok: false,
      remaining: 0,
      reason:
        `No questions left on ${which}. Each column allows ${limit} questions per session and this ` +
        `one is spent, so nothing was charged and nothing was answered. Ask about a different column, ` +
        `or ask the person at the keyboard to look at this one.`,
    }
  }

  const next = new Map(state)
  for (const column of named) {
    next.set(column, (state.get(column) ?? 0) + 1)
  }

  return { ok: true, remaining: remainingAcross(next, named, limit), state: next }
}

/**
 * How many questions remain on a column.
 *
 * Rides along on every tool response, deliberately. An agent that knows it has 3 questions left on
 * `phone` spends them carefully; one that does not burns them on questions it could have skipped, hits a
 * wall mid-reasoning, and writes a worse report. Publishing the budget makes the agent a better citizen at
 * no privacy cost — the number tells it nothing about the data.
 */
export function remaining(
  state: BudgetState,
  column: ColumnId,
  limit: number = QUERIES_PER_COLUMN,
): number {
  const used = state.get(column) ?? 0
  return Math.max(0, limit - used)
}

/**
 * The smallest remaining budget across several columns — what a multi-column tool reports.
 *
 * Reporting the minimum rather than the sum or the average: the agent's next multi-column question fails
 * when the *tightest* column runs out, so the minimum is the number that predicts its next refusal.
 */
export function remainingAcross(
  state: BudgetState,
  columns: readonly ColumnId[],
  limit: number = QUERIES_PER_COLUMN,
): number {
  return distinct(columns).reduce(
    (lowest, column) => Math.min(lowest, remaining(state, column, limit)),
    limit,
  )
}

/** Columns with nothing left. Shown in the UI so the human can see where the agent hit the wall. */
export function exhaustedColumns(
  state: BudgetState,
  limit: number = QUERIES_PER_COLUMN,
): readonly ColumnId[] {
  const spent: ColumnId[] = []
  for (const [column, used] of state) {
    if (used >= limit) spent.push(column)
  }
  return spent
}
