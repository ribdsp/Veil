import type { Dataset } from '@/types/domain'

import { DEFAULT_K, QUERIES_PER_COLUMN, type Guard, createGuard } from './guard'

/**
 * The one guard in the process, and the only way a tool gets hold of it.
 *
 * Owner: Riko.
 *
 * `SessionState` in `types/domain.ts` lists what the store holds and then says what it does not: the
 * `GuardHandle`. A handle is not state — it is a capability with state inside it — so it lives here, at module
 * level, and the store holds the things React re-renders from.
 *
 * ## Why a module-level singleton rather than a parameter
 *
 * Tool `execute` functions are called by the browser with the model's arguments and nothing else. There is no
 * place to thread a guard through, and the alternatives are worse: a tool that constructs its own guard needs a
 * `Dataset` to construct it from, which is the exact thing no tool may hold, and a tool that reads the store
 * makes `lib/webmcp/tools/` import `lib/store/dataset`, which `guard/no-leak.test.ts` fails the build over.
 *
 * So the page loads a file, calls `loadDataset` once, and every tool calls `activeGuard()`. A tool can obtain a
 * handle; it cannot obtain a dataset, and it cannot obtain a handle to a dataset nobody loaded.
 *
 * ## No dataset is a refusal, not an exception
 *
 * `activeGuard()` returns `null` before a file is loaded. Every tool checks it and returns `noDataset()` — the
 * `noDataset` refusal code exists for exactly this, and it is the most likely state for a tool call to arrive
 * in, because an agent connected to the page has no way to know whether the human has picked a file yet.
 */

let current: Guard | null = null

/** Set of the row/column shape the current guard was built for, so a stale reload is visible. */
let loadedName: string | null = null

/**
 * Start a session over a freshly parsed file.
 *
 * Replaces any guard already in place, and that is the intended behaviour: loading a second file ends the first
 * session. The budget resets, the undo stack is dropped, refused reveals are forgotten — all of which is correct,
 * because they were facts about a file that is no longer open. Nothing carries over, in particular not the
 * questions already asked, since asking them again about a different file discloses nothing about the old one.
 *
 * `k` does not carry over either. A human who raised k for a sensitive file and then opened a different one is
 * back at the default, which is the safe direction to be wrong in only because the default is the floor the
 * whole design assumes; the UI is expected to re-offer the control.
 */
export function loadDataset(dataset: Dataset, k: number = DEFAULT_K): Guard {
  current = createGuard(dataset, { k, queriesPerColumn: QUERIES_PER_COLUMN })
  loadedName = dataset.sourceName
  return current
}

/** End the session. The guard is dropped, and with it the only reference to the dataset. */
export function closeSession(): void {
  current = null
  loadedName = null
}

/**
 * The current guard, or `null` when no file is loaded.
 *
 * Returns the handle rather than throwing, because a tool must never throw out of `execute`
 * (`tool-types.ts`) and "no file is open yet" is an ordinary answer rather than a fault.
 */
export function activeGuard(): Guard | null {
  return current
}

/** The loaded file's name, for a tool that wants to say which file it is talking about. Metadata only. */
export function activeSourceName(): string | null {
  return loadedName
}
