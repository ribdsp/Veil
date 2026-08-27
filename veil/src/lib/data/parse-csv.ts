import type { Column, Dataset } from '@/types/domain'

/**
 * CSV in, `Dataset` out. The only place a file is read.
 *
 * Owner: Riko.
 *
 * ## The file never leaves the browser
 *
 * There is no upload, no API route, and no fetch. The `File` comes from an `<input type="file">` or a drop
 * event, and Papa Parse reads it in a Web Worker. `next.config.mjs` sets `connect-src 'self'` so that this
 * is enforced by the browser rather than by our good intentions — if a future dependency tries to phone
 * home with a row of somebody's data, the request fails.
 *
 * ## Why a worker
 *
 * A 50k-row parse on the main thread freezes the tab for several seconds, and a frozen tab during a demo
 * reads as a broken product. It also matters more here than in most apps: the human is the one being asked
 * to approve reveals, and an unresponsive page is one they cannot answer.
 *
 * `worker: true` in Papa Parse handles this. The cost is that the callback shape is streaming rather than
 * returning, which is why this returns a promise instead of a value.
 */

export type ParseOptions = {
  /** Papa Parse detects `,` `;` `\t` `|` on its own; override only when it guesses wrong. */
  delimiter?: string
  /** Stop after this many rows. The UI offers it for very large files. */
  rowLimit?: number
}

export type ParseOutcome =
  | { ok: true; dataset: Dataset; warnings: readonly string[] }
  | { ok: false; error: string }

/**
 * Parse a file the human picked.
 *
 * TODO(riko), Day 1: implement with Papa Parse, `header: true`, `worker: true`, `skipEmptyLines: 'greedy'`.
 *
 * TODO(riko), Day 1: `dynamicTyping` must stay **off**. Papa Parse would helpfully turn `0812345678` into
 * the number 812345678 and `007` into 7, silently destroying leading zeros in exactly the columns this
 * project exists to clean. Every cell is a string until a transform says otherwise.
 *
 * TODO(riko), Day 1: report parse errors as warnings, not failures, when rows still came through. A file
 * with three ragged rows is a file worth cleaning — that is the point — and refusing it sends the human
 * back to the spreadsheet software this tool was meant to replace. Refuse only when there is no usable
 * header row.
 *
 * TODO(riko), Day 1: de-duplicate header names. A CSV with two columns called `phone` is common and both
 * become `phone` here, after which every `ColumnId` lookup silently resolves to the first. Rename the
 * second `phone (2)` and warn.
 *
 * TODO(riko), Day 2: strip a UTF-8 BOM from the first header. Otherwise the first column is called
 * `﻿name`, every lookup for `name` fails, and the error the agent sees is `unknownColumn` for a column
 * it can see in the list — which is the least debuggable failure in the whole surface.
 */
export async function parseCsv(_file: File, _options: ParseOptions = {}): Promise<ParseOutcome> {
  throw new Error('parseCsv: not implemented')
}

/**
 * Read one cell.
 *
 * **Module-private. Never export this.** `guard/no-leak.test.ts` fails the build if a file in `lib/data`
 * exports an accessor named `cellAt`, `rawValueAt` or `readCell`, and if a tool imports from `@/lib/data`
 * at all.
 *
 * Everything above this line is plumbing. This function is the thing the entire architecture is arranged
 * around: `lib/guard` calls it, computes over the result, and returns a count or a class. Nothing in
 * `lib/webmcp/tools` can reach it, so no tool can be persuaded — by a clever prompt or a careless
 * refactor — to hand a value to a model.
 *
 * If a task seems to need this exported, the answer is a new guarded query with its own suppression rule.
 * See CLAUDE.md § The one thing this codebase is about.
 *
 * TODO(riko), Day 1: implement. Return `''` for an out-of-range row or column rather than throwing:
 * `noUncheckedIndexedAccess` already forces the caller to handle `undefined`, and a throw here surfaces
 * inside a guard method as a crash rather than a refusal.
 */
function cellAt(_dataset: Dataset, _row: number, _column: Column): string {
  throw new Error('cellAt: not implemented')
}

/**
 * The only way out of this module for cell data: a function that reads cells and returns something that is
 * not a cell.
 *
 * `lib/guard` passes in a reducer — count, classify, compare — and gets the reduction back. The values stay
 * behind the closure. It is not airtight in a language sense (a caller could pass a reducer that collects
 * strings), but it is airtight in an *import* sense: the only module that can call this is one that already
 * has to justify itself to `no-leak.test.ts`.
 *
 * TODO(riko), Day 2: implement. Iterate rows once and call `reduce` per cell; do not materialise an array of
 * column values first. On a 50k-row file that copy is both the memory spike and a second place where raw
 * values live.
 */
export function reduceColumn<T>(
  _dataset: Dataset,
  _column: Column,
  _initial: T,
  _reduce: (accumulator: T, cell: string, rowId: number) => T,
): T {
  throw new Error('reduceColumn: not implemented')
}

/** Same, across whole rows — what `find_duplicates` and multi-column predicates need. */
export function reduceRows<T>(
  _dataset: Dataset,
  _columns: readonly Column[],
  _initial: T,
  _reduce: (accumulator: T, cells: readonly string[], rowId: number) => T,
): T {
  throw new Error('reduceRows: not implemented')
}

// Referenced by `reduceColumn` and `reduceRows` once implemented. Kept here so the accessor and its only
// two callers sit in one file, where the boundary is visible in a single screen.
void cellAt
