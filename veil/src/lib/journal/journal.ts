import type { Author, JournalEntry, JournalEventKind } from '@/types/domain'

/**
 * The audit trail. Append-only, in the type and in the code.
 *
 * Owner: Vicko.
 *
 * Six weeks after a file was cleaned, someone will ask why a date column changed. This is the answer — and it
 * is only the answer if nothing can quietly edit it. So: no `update`, no `remove`, no `clear`. `append` returns
 * a new array; the store swaps the reference.
 *
 * The journal is also the only part of Veil that survives the tab. Everything else — the dataset, the guard's
 * budget, the undo stack — dies on refresh by design. This gets exported, which means it is the one artefact
 * where "does this leak?" has to be asked about a file that will be attached to an email.
 */

/**
 * The kinds that count as a refusal: the agent asked for something and did not get it.
 *
 * Named as a constant rather than inlined into `refusals()` because `submit_cleanup_report` compares its
 * `unresolved` list against this set. Anything left out here is something an agent can silently drop from its
 * report, so the membership of this list is a product decision:
 *
 * - `answerSuppressed` — a real answer existed and k-anonymity declined to report it. The rows behind it are
 *   still unexamined, which is exactly what `unresolved` is for.
 * - `revealRefused` — a human said no to a cell. The most plainly unresolved thing a session can contain.
 * - `budgetExhausted` — the column closed before the question was answered. Practically identical to a
 *   suppression from the human's side: nobody found out what is in there.
 *
 * Note what is deliberately *not* here. `revealRequested` is not a refusal — it may well have been granted, and
 * counting it would double every reveal. A malformed query the agent then corrected is not one either: that is
 * an agent learning the schema, not an open question about the data.
 */
export const REFUSAL_KINDS: readonly JournalEventKind[] = [
  'answerSuppressed',
  'revealRefused',
  'budgetExhausted',
]

/**
 * Make an entry.
 *
 * `at` is passed in rather than read from the clock inside, because otherwise `journal.test.ts` cannot assert
 * ordering without sleeping — and a test that sleeps is a test someone will delete. Callers that do not care
 * omit it and get `Date.now()`.
 */
export function entry(
  kind: JournalEventKind,
  author: Author,
  subject: string,
  detail: string,
  options?: { irreversible?: boolean; at?: number },
): JournalEntry {
  return {
    id: crypto.randomUUID(),
    at: options?.at ?? Date.now(),
    author,
    kind,
    subject,
    detail,
    irreversible: options?.irreversible ?? false,
  }
}

/**
 * Add an entry. Returns a new array; never touches the old one.
 *
 * There is deliberately no cap on the length. A 10,000-entry journal is 10,000 entries the human is entitled
 * to, and a journal that silently drops its oldest lines is worse than no journal because it looks complete.
 * If rendering gets slow, virtualise the list; do not truncate the record.
 */
export function append(
  journal: readonly JournalEntry[],
  next: JournalEntry,
): readonly JournalEntry[] {
  return [...journal, next]
}

/**
 * Count the reveals that were granted this session.
 *
 * This number goes in the header in red. Making the cost visible and cumulative is the whole mechanism: one
 * reveal is a judgement call, and eleven reveals is a habit the human should be able to notice they have
 * formed. Derived from the journal rather than from a counter so it cannot drift away from the record.
 */
export function revealsGranted(journal: readonly JournalEntry[]): number {
  return journal.filter((line) => line.kind === 'revealGranted').length
}

/**
 * The refusals, for the report the agent files at the end.
 *
 * `submit_cleanup_report` compares its `unresolved` list against this, and the UI shows the human anything the
 * agent left out. An agent that quietly drops a refused cell from its report is the exact failure this project
 * is meant to make visible, so it must not be possible to file a clean report over a journal full of refusals
 * without the discrepancy being on screen.
 *
 * Order is preserved: these are the journal's own lines, in the order they happened, so the caller can quote
 * them back at the human without re-sorting.
 */
export function refusals(journal: readonly JournalEntry[]): readonly JournalEntry[] {
  return journal.filter((line) => REFUSAL_KINDS.includes(line.kind))
}
