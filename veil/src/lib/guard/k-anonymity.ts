import type { RefusalCode } from '@/types/domain'

import { DEFAULT_K, MIN_K } from './guard'

/**
 * The suppress-or-report decision, in one place.
 *
 * Owner: Riko. Required reading: docs/privacy-guard.md § k-anonymity suppression.
 *
 * Every count, group size, crosstab cell and format bucket in Veil passes through this file. It is small
 * on purpose — one decision, no side effects, no dataset access — because a suppression rule implemented
 * twice is a suppression rule with two behaviours, and the second one is the one that leaks.
 */

/** What a suppressed number looks like to the agent. Never a bare `0`, never a bare `null`. */
export type Suppressed = {
  readonly status: 'suppressed'
  readonly code: Extract<RefusalCode, 'belowK'>
  /** "Between 1 and 4 rows match, which is fewer than the minimum group size of 5." */
  readonly reason: string
}

export type Counted<T> = { readonly status: 'reported'; readonly value: T }

export type MaybeSuppressed<T> = Counted<T> | Suppressed

/**
 * Report a count, or suppress it.
 *
 * Zero is reported, and that is not an oversight. "No rows match" describes nobody — it is a fact about
 * the predicate, not about a person — and suppressing it would leave the agent unable to distinguish
 * *nothing here* from *something here I may not see*. Those two need different responses: the first means
 * move on, the second means tell the human to look.
 *
 * TODO(riko), Day 2: implement. Then read the test file before you decide it is finished — several of the
 * cases there are not obvious from this comment.
 */
export function reportCount(_count: number, _k: number = DEFAULT_K): MaybeSuppressed<number> {
  throw new Error('reportCount: not implemented')
}

/**
 * Split groups into those large enough to name and an `__other__` bucket holding the rest.
 *
 * **Merged, never dropped.** The merged bucket carries the combined count and how many groups went into
 * it, so the totals still sum to `rowCount`. If small groups simply vanished, the agent's groups would not
 * sum, and the conclusion a model draws from that is "I have been given a filtered dataset" — after which
 * every number it reports is wrong in a way nobody can detect. Suppressing a value while preserving the
 * total is honest. Suppressing it while breaking the total misleads in the direction of looking correct.
 *
 * TODO(riko), Day 2: implement. `__other__` is emitted only when at least one group went into it; an empty
 * `__other__` with count 0 tells the agent a suppression happened when none did.
 */
export function mergeSmallGroups(
  _groups: readonly { key: string; count: number }[],
  _k: number = DEFAULT_K,
  _maxGroups = 25,
): { groups: readonly { key: string; count: number }[]; mergedGroupCount: number } {
  throw new Error('mergeSmallGroups: not implemented')
}

/**
 * Validate a k the human asked for.
 *
 * Raising k is always allowed. Lowering it is only allowed down to `MIN_K`, and `guard.ts` additionally
 * refuses to lower it *mid-session* at all — a human can otherwise be walked from 12 down to 3 one click
 * at a time by an agent that keeps reporting suppressions, and each individual click looks reasonable.
 *
 * TODO(riko), Day 2: implement. Return the reason on rejection; the UI shows it next to the control.
 */
export function validateK(_k: number): { ok: true; k: number } | { ok: false; reason: string } {
  throw new Error(`validateK: not implemented (floor is ${MIN_K})`)
}
