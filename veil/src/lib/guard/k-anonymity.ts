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

/** The key small groups are folded into. Named in responses, so it is a constant rather than a literal. */
export const OTHER_KEY = '__other__'

/**
 * The sentence an agent gets instead of a number.
 *
 * The bound is `1..k-1` and never the real count: the obvious phrasing ("3 rows match, which is below 5")
 * reveals the exact number the suppression existed to hide, in the field explaining the suppression.
 */
export function suppressed(k: number): Suppressed {
  return {
    status: 'suppressed',
    code: 'belowK',
    reason:
      `Between 1 and ${k - 1} rows match, which is fewer than the minimum group size of ${k}. ` +
      `The exact number is not reported. A handful of rows this narrow needs a person to look at them; ` +
      `ask a broader question, or use ask_human.`,
  }
}

/**
 * Report a count, or suppress it.
 *
 * Zero is reported, and that is not an oversight. "No rows match" describes nobody — it is a fact about
 * the predicate, not about a person — and suppressing it would leave the agent unable to distinguish
 * *nothing here* from *something here I may not see*. Those two need different responses: the first means
 * move on, the second means tell the human to look.
 */
export function reportCount(count: number, k: number = DEFAULT_K): MaybeSuppressed<number> {
  if (count <= 0) return { status: 'reported', value: count }
  if (count < k) return suppressed(k)
  return { status: 'reported', value: count }
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
 * `__other__` is emitted only when at least one group went into it; an empty `__other__` with count 0 tells
 * the agent a suppression happened when none did. And the merged bucket is re-checked against k: two groups
 * of two make a bucket of four, and publishing that would defeat suppression by doing it once.
 */
export function mergeSmallGroups(
  groups: readonly { key: string; count: number }[],
  k: number = DEFAULT_K,
  maxGroups = 25,
): { groups: readonly { key: string; count: number }[]; mergedGroupCount: number } {
  const ordered = [...groups].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

  const kept: { key: string; count: number }[] = []
  const merged: { key: string; count: number }[] = []
  for (const group of ordered) {
    if (group.count >= k && kept.length < maxGroups) kept.push(group)
    else merged.push(group)
  }

  if (merged.length === 0) return { groups: kept, mergedGroupCount: 0 }

  const mergedRows = merged.reduce((sum, group) => sum + group.count, 0)
  if (mergedRows < k) {
    // The bucket is itself too small to name. It is still counted, so the response can say a tail exists.
    return { groups: kept, mergedGroupCount: merged.length }
  }

  return {
    groups: [...kept, { key: OTHER_KEY, count: mergedRows }],
    mergedGroupCount: merged.length,
  }
}

/**
 * Validate a k the human asked for.
 *
 * Raising k is always allowed. Lowering it is only allowed down to `MIN_K`, and `guard.ts` additionally
 * refuses to lower it *mid-session* at all — a human can otherwise be walked from 12 down to 3 one click
 * at a time by an agent that keeps reporting suppressions, and each individual click looks reasonable.
 */
export function validateK(k: number): { ok: true; k: number } | { ok: false; reason: string } {
  if (!Number.isInteger(k)) {
    return {
      ok: false,
      reason:
        `The minimum group size must be a whole number. ${k} would be rounded, and rounding 4.5 down ` +
        `puts it below the floor of ${MIN_K} by arithmetic rather than by decision.`,
    }
  }
  if (k < MIN_K) {
    return {
      ok: false,
      reason:
        `The minimum group size cannot go below ${MIN_K}. At ${k}, an answer can describe a group small ` +
        `enough to name the people in it, which is the one thing this setting exists to prevent.`,
    }
  }
  return { ok: true, k }
}
