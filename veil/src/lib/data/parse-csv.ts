import Papa from 'papaparse'

import type { Column, Dataset } from '@/types/domain'

import { inferSchema } from './infer-schema'

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

/** How many distinct parse complaints to pass on before summarising the rest. */
const MAX_WARNINGS = 5

/** U+FEFF, which Excel writes at the start of a UTF-8 CSV and nothing else ever wants. */
const BOM = '﻿'

/**
 * Parse a file the human picked.
 *
 * Papa Parse in a worker, `skipEmptyLines: 'greedy'`, and **`dynamicTyping` off**. Papa would otherwise
 * helpfully turn `0812345678` into the number 812345678 and `007` into 7, silently destroying leading zeros
 * in exactly the columns this project exists to clean. Every cell is a string until a transform says
 * otherwise.
 *
 * ## Why `header: false` when the file has a header
 *
 * A deviation from the original note in this file, and it is about duplicate headers rather than about
 * preference. In header mode Papa returns one object per row keyed by header text, so a CSV with two columns
 * called `phone` produces objects with a single `phone` property and the second column's values are simply
 * gone. De-duplicating in `transformHeader` would fix that, except `transformHeader` is a function and
 * functions cannot be passed to a Papa worker — only `step`, `chunk`, `complete` and `error` survive the
 * postMessage boundary. Keeping the worker matters more, and the first row is trivially a header here, so
 * the header row is taken and de-duplicated below. Rows stay positional arrays, which is what `Dataset`
 * wants anyway.
 */
export async function parseCsv(file: File, options: ParseOptions = {}): Promise<ParseOutcome> {
  const raw = await readRows(file, options)
  if (!raw.ok) return raw

  const [headerRow, ...dataRows] = raw.rows
  if (headerRow === undefined || headerRow.every((cell) => cell.trim() === '')) {
    return {
      ok: false,
      error:
        'This file has no usable header row. Veil identifies columns by their header text, so the first ' +
        'row needs to be column names. Add a header row and try again.',
    }
  }

  const warnings: string[] = [...raw.warnings]
  const headers = namedColumns(headerRow, warnings)

  // Ragged rows are the reason this tool exists, so they are padded and reported rather than refused.
  let short = 0
  let long = 0
  const rows: string[][] = dataRows.map((row) => {
    if (row.length < headers.length) short += 1
    if (row.length > headers.length) long += 1
    const cells: string[] = []
    for (let index = 0; index < headers.length; index += 1) cells.push(row[index] ?? '')
    return cells
  })

  if (short > 0) {
    warnings.push(
      `${short} ${short === 1 ? 'row has' : 'rows have'} fewer cells than there are columns; the missing ` +
        `cells are treated as empty.`,
    )
  }
  if (long > 0) {
    warnings.push(
      `${long} ${long === 1 ? 'row has' : 'rows have'} more cells than there are columns; the extra cells ` +
        `were dropped because no column names them.`,
    )
  }
  if (options.rowLimit !== undefined && rows.length >= options.rowLimit) {
    warnings.push(
      `Only the first ${rows.length} rows were read, as requested. Counts and profiles describe those ` +
        `rows and not the whole file.`,
    )
  }

  return {
    ok: true,
    dataset: {
      columns: inferSchema(headers, rows),
      rows,
      sourceName: file.name,
      rowCount: rows.length,
    },
    warnings,
  }
}

/**
 * Header text into column names, de-duplicated.
 *
 * A CSV with two columns called `phone` is common, and if both stay `phone` every `ColumnId` lookup
 * silently resolves to the first — the agent then profiles one column twice and reports the other's problems
 * as absent. The second becomes `phone (2)`, and the human is told.
 *
 * The BOM strip on the first header is the same class of bug with a worse failure mode: without it the first
 * column is called `﻿name`, every lookup for `name` fails, and what the agent sees is `unknownColumn` for a
 * column it can see in the list, which is the least debuggable message in the whole surface.
 */
function namedColumns(headerRow: readonly string[], warnings: string[]): readonly string[] {
  const used = new Map<string, number>()
  const names: string[] = []

  headerRow.forEach((rawHeader, index) => {
    const stripped = index === 0 && rawHeader.startsWith(BOM) ? rawHeader.slice(BOM.length) : rawHeader
    const trimmed = stripped.trim()
    const base = trimmed === '' ? `column ${index + 1}` : trimmed

    if (trimmed === '') {
      warnings.push(`Column ${index + 1} has no header; it is called "${base}".`)
    }

    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)

    if (seen === 0) {
      names.push(base)
      return
    }

    const unique = `${base} (${seen + 1})`
    names.push(unique)
    warnings.push(`Two columns are called "${base}"; the second is called "${unique}" here.`)
  })

  return names
}

type RowsOutcome =
  | { ok: true; rows: readonly string[][]; warnings: readonly string[] }
  | { ok: false; error: string }

/** The Papa call itself, wrapped so the rest of this file is synchronous and testable by eye. */
function readRows(file: File, options: ParseOptions): Promise<RowsOutcome> {
  return new Promise((resolve) => {
    try {
      Papa.parse<string[]>(file, {
        header: false,
        worker: true,
        skipEmptyLines: 'greedy',
        // Off, permanently. See the note above `parseCsv`.
        dynamicTyping: false,
        delimiter: options.delimiter,
        // One extra, because the header row counts towards `preview`.
        preview: options.rowLimit === undefined ? 0 : options.rowLimit + 1,
        complete: (results) => {
          resolve({ ok: true, rows: results.data, warnings: describeErrors(results.errors) })
        },
        error: (error: Error) => {
          resolve({ ok: false, error: `This file could not be read: ${error.message}` })
        },
      })
    } catch (error: unknown) {
      resolve({
        ok: false,
        error: `This file could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
      })
    }
  })
}

/**
 * Parse complaints, as warnings.
 *
 * Errors are warnings and not failures whenever rows still came through. A file with three ragged rows is a
 * file worth cleaning — that is the entire point — and refusing it sends the human back to the spreadsheet
 * software this tool was meant to replace.
 *
 * Grouped by Papa's error code rather than listed one per row: a delimiter guessed wrong produces one
 * complaint per line, and 50,000 warnings is not information.
 */
function describeErrors(errors: readonly Papa.ParseError[]): readonly string[] {
  const counts = new Map<string, { message: string; count: number }>()
  for (const error of errors) {
    const existing = counts.get(error.code)
    if (existing === undefined) counts.set(error.code, { message: error.message, count: 1 })
    else existing.count += 1
  }

  const described = [...counts.values()].map(
    ({ message, count }) => `${message}${count > 1 ? ` (${count} rows)` : ''}`,
  )

  if (described.length <= MAX_WARNINGS) return described
  const shown = described.slice(0, MAX_WARNINGS)
  return [...shown, `…and ${described.length - MAX_WARNINGS} other kinds of parse problem.`]
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
 * Out-of-range returns `''` rather than throwing: `noUncheckedIndexedAccess` already forces the caller to
 * handle `undefined`, and a throw here surfaces inside a guard method as a crash rather than a refusal.
 */
function cellAt(dataset: Dataset, row: number, column: Column): string {
  return dataset.rows[row]?.[column.index] ?? ''
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
 * One pass, one cell in flight at a time. No array of column values is materialised first: on a 50k-row file
 * that copy is both the memory spike and a second place where raw values live.
 */
export function reduceColumn<T>(
  dataset: Dataset,
  column: Column,
  initial: T,
  reduce: (accumulator: T, cell: string, rowId: number) => T,
): T {
  let accumulator = initial
  for (let rowId = 0; rowId < dataset.rows.length; rowId += 1) {
    accumulator = reduce(accumulator, cellAt(dataset, rowId, column), rowId)
  }
  return accumulator
}

/** Same, across whole rows — what `find_duplicates` and multi-column predicates need. */
export function reduceRows<T>(
  dataset: Dataset,
  columns: readonly Column[],
  initial: T,
  reduce: (accumulator: T, cells: readonly string[], rowId: number) => T,
): T {
  let accumulator = initial
  for (let rowId = 0; rowId < dataset.rows.length; rowId += 1) {
    // A fresh array per row rather than one reused buffer. Reusing it would be faster and would break the
    // first caller that keeps what it was handed — `find_duplicates` blocks rows by their values, and a
    // buffer that changes under it turns every block into the last row read.
    const cells = columns.map((column) => cellAt(dataset, rowId, column))
    accumulator = reduce(accumulator, cells, rowId)
  }
  return accumulator
}
