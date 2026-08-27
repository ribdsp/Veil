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
 * Make an entry.
 *
 * TODO(vicko), Day 2: implement. `crypto.randomUUID()` for the id, `Date.now()` for `at`.
 *
 * TODO(vicko), Day 2: pass `at` in rather than reading the clock inside, or `journal.test.ts` cannot assert
 * ordering without sleeping. A test that sleeps is a test someone will delete.
 */
export function entry(
  _kind: JournalEventKind,
  _author: Author,
  _subject: string,
  _detail: string,
  _options?: { irreversible?: boolean; at?: number },
): JournalEntry {
  throw new Error('entry: not implemented')
}

/**
 * Add an entry. Returns a new array; never touches the old one.
 *
 * TODO(vicko), Day 2: implement as `[...journal, next]`. Resist the temptation to cap the length — a 10,000-
 * entry journal is 10,000 entries the human is entitled to, and a journal that silently drops its oldest lines
 * is worse than no journal because it looks complete. If rendering gets slow, virtualise the list; do not
 * truncate the record.
 */
export function append(
  _journal: readonly JournalEntry[],
  _next: JournalEntry,
): readonly JournalEntry[] {
  throw new Error('append: not implemented')
}

/**
 * Count the reveals that were granted this session.
 *
 * TODO(vicko), Day 3: implement by filtering on `kind === 'revealGranted'`. This number goes in the header in
 * red. Making the cost visible and cumulative is the whole mechanism: one reveal is a judgement call, and
 * eleven reveals is a habit the human should be able to notice they have formed.
 */
export function revealsGranted(_journal: readonly JournalEntry[]): number {
  throw new Error('revealsGranted: not implemented')
}

/**
 * The refusals, for the report the agent files at the end.
 *
 * TODO(vicko), Day 5: implement. `submit_cleanup_report` compares its `unresolved` list against this, and the
 * UI shows the human anything the agent left out. An agent that quietly drops a refused cell from its report is
 * the exact failure this project is meant to make visible, so it must not be possible to file a clean report
 * over a journal full of refusals without the discrepancy being on screen.
 */
export function refusals(_journal: readonly JournalEntry[]): readonly JournalEntry[] {
  throw new Error('refusals: not implemented')
}
