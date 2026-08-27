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

/**
 * Charge one question against every column named.
 *
 * All or nothing: if any column is exhausted, nothing is charged and nothing is answered. A partial charge
 * would leave the agent having paid for an answer it did not get, and — worse — a partial *answer* across
 * a crosstab would be a table with one axis silently missing, which reads as a real result.
 *
 * TODO(riko), Day 2: implement. Returns a new state rather than mutating the map — the store holds it, and
 * an in-place charge inside the guard makes the budget untestable without a store.
 */
export function charge(
  _state: BudgetState,
  _columns: readonly ColumnId[],
  _limit: number = QUERIES_PER_COLUMN,
): ChargeResult {
  throw new Error('charge: not implemented')
}

/**
 * How many questions remain on a column.
 *
 * Rides along on every tool response, deliberately. An agent that knows it has 3 questions left on
 * `phone` spends them carefully; one that does not burns them on questions it could have skipped, hits a
 * wall mid-reasoning, and writes a worse report. Publishing the budget makes the agent a better citizen at
 * no privacy cost — the number tells it nothing about the data.
 *
 * TODO(riko), Day 2: implement.
 */
export function remaining(
  _state: BudgetState,
  _column: ColumnId,
  _limit: number = QUERIES_PER_COLUMN,
): number {
  throw new Error('remaining: not implemented')
}

/**
 * The smallest remaining budget across several columns — what a multi-column tool reports.
 *
 * TODO(riko), Day 2: implement. Reporting the minimum rather than the sum or the average: the agent's next
 * multi-column question fails when the *tightest* column runs out, so the minimum is the number that
 * predicts its next refusal.
 */
export function remainingAcross(
  _state: BudgetState,
  _columns: readonly ColumnId[],
  _limit: number = QUERIES_PER_COLUMN,
): number {
  throw new Error('remainingAcross: not implemented')
}

/**
 * Columns with nothing left. Shown in the UI so the human can see where the agent hit the wall.
 *
 * TODO(riko), Day 2: implement.
 */
export function exhaustedColumns(
  _state: BudgetState,
  _limit: number = QUERIES_PER_COLUMN,
): readonly ColumnId[] {
  throw new Error('exhaustedColumns: not implemented')
}
