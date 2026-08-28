import type {
  AppliedTransform,
  Author,
  Column,
  Dataset,
  RowId,
  TransformReport,
  TransformSpec,
} from '@/types/domain'

import { maskPair } from '@/lib/guard/redact'

import { buildTransform } from './transforms'

/**
 * Run a transform. Once, for both the dry run and the commit.
 *
 * Owner: Riko.
 *
 * **One code path, two modes.** `commit: false` computes the report and discards the new values;
 * `commit: true` computes the same report and keeps them. That is not a tidiness preference — a preview
 * computed by different code than the commit is a preview that can be wrong, and a wrong preview is worse
 * than no preview, because the human approved the wrong one. `apply-transform.test.ts` asserts the two agree.
 *
 * The way that guarantee is actually held here: `scan` below does not know which mode it is in. It computes
 * the counts, the failures, the examples *and* the new values every time, and `commit` decides only whether
 * anything is done with them. There is no branch inside the measurement, so there is nothing for the two
 * modes to disagree about. The cost is holding the changed cells twice on a dry run that is about to throw
 * them away, which is the user's own data in the user's own tab and worth it.
 *
 * ## Why this module reads and writes `dataset.rows` directly
 *
 * Everywhere else, cell access goes through `reduceColumn`. That is a reader, and this module has to write.
 * `lib/transform` is therefore one of the two places (with `lib/data`) that touches rows, and it is not
 * reachable from a tool: `apply_transform` calls the guard, the guard calls this, and the report that comes
 * back has masked examples and counts in it and no cell values. `guard/no-leak.test.ts` enforces the tool
 * half of that.
 */

export type ApplyOutcome = {
  report: TransformReport
  /** Present only when committed. Holds the previous values, which is what makes undo exact. */
  applied?: AppliedTransform
  /** Present only when committed. */
  dataset?: Dataset
}

export type ApplyOptions = {
  /** Target subset. Omitted means every row. Duplicates are ignored; order does not matter. */
  rows?: readonly RowId[]
  commit: boolean
  /** Who asked. `agent` by default, because `apply_transform` is the only caller that commits. */
  author?: Author
}

/** `TransformReport.failedRowIds` — enough to go and look, not a bulk row-id dump. */
const MAX_FAILED_IDS = 10

/** `TransformReport.examples`. */
const MAX_EXAMPLES = 10

/** The two kinds that remove information rather than reshaping it. `undo_last` refuses both. */
function isDestructive(spec: TransformSpec): boolean {
  return spec.kind === 'dropColumn' || spec.kind === 'maskColumn'
}

type Scan = {
  changed: number
  unchanged: number
  failed: number
  failedRowIds: RowId[]
  examples: { from: string; to: string }[]
  /** Deduplicated `from→to`, so ten examples are ten kinds of change rather than one repeated. */
  seenExamples: Set<string>
  /** Empty for destructive kinds. See `applyTransform`. */
  previousValues: Map<RowId, string>
  /** The new value for each row that changed. Used on commit, computed always. */
  nextValues: Map<RowId, string>
}

/**
 * Apply or dry-run a transform.
 *
 * One pass over the target rows, counting `changedCount` / `unchangedCount` / `failedCount` separately,
 * collecting the first 10 failed row ids ascending, and collecting up to 10 masked before/after pairs drawn
 * from rows that actually changed.
 *
 * ## Examples are masked here, not later
 *
 * `maskPair` comes from `guard/redact.ts` rather than being written again in this module. A second mask
 * implementation would be a second set of opinions about what a mask hides, and the one that is wrong is the
 * one nobody is looking at. `redact.ts` imports nothing, so the direction of this edge is
 * `transform → guard/redact` and no cycle exists.
 *
 * A pair whose two masks are identical is dropped rather than reported. `000000 → 000000` tells the agent
 * nothing it did not already know from `changedCount`, and it costs one of the ten slots that could have
 * shown a shape that did change.
 *
 * ## What throws, and why it is not a refusal
 *
 * An unknown column, a row id past the end of the file, or a `dropColumn` narrowed to a row subset, is a
 * caller bug rather than a privacy decision. The guard validates all three before it gets here — it has the
 * column list, the `rowCount` and the spec, none of which is a cell — and returns a proper `Verdict` refusal.
 * Reaching this function with any of them is a broken call path, and a plausible report would be a lie the
 * human would approve: "0 of 8,000 rows need changing" reads as good news rather than as a typo in a column
 * name, and "1 row changed" reads as a blanked cell rather than as a dropped column.
 *
 * ## `previousValues` for changed rows only
 *
 * Storing every row's previous value on a 50k-row file doubles the memory for no benefit; undo only needs the
 * cells that moved. Destructive kinds store **nothing**: stashing the dropped column would be a full copy of
 * the most sensitive column in the file, kept alive after the human asked for it to be gone. That is the
 * opposite of what they asked for, and it is why `undo_last` refuses those two rather than why it can't.
 *
 * One consequence worth knowing before it surprises you in a debugger: `previousValues.size` equals
 * `changedCount` for the eight non-destructive kinds and is `0` for the other two.
 */
export function applyTransform(
  dataset: Dataset,
  spec: TransformSpec,
  options: ApplyOptions,
): ApplyOutcome {
  const column = dataset.columns.find((candidate) => candidate.id === spec.column)
  if (column === undefined) {
    throw new Error(
      `applyTransform: no column called "${spec.column}". The guard validates the column name before ` +
        `calling this, so reaching here means a caller skipped it.`,
    )
  }

  // A drop is a change to `columns`, which no row subset can express: `commit` below would blank the named
  // rows and remove the column from the whole file, and the report would say `changedCount: 1`. The guard
  // refuses this combination with a sentence the agent can act on; reaching here means a caller went around
  // it, and a plausible report understating a destructive write is the worst thing this module could return.
  if (spec.kind === 'dropColumn' && options.rows !== undefined) {
    throw new Error(
      `applyTransform: dropColumn cannot be limited to a row subset — it removes "${spec.column}" from the ` +
        `file. The guard refuses this before calling, so reaching here means a caller skipped it.`,
    )
  }

  const targets = targetRows(dataset, options.rows)
  const destructive = isDestructive(spec)
  const scan = scanRows(dataset, column, spec, targets, destructive)

  const report: TransformReport = {
    spec,
    unchangedCount: scan.unchanged,
    changedCount: scan.changed,
    failedCount: scan.failed,
    failedRowIds: scan.failedRowIds,
    examples: scan.examples,
    destructive,
  }

  if (!options.commit) return { report }

  return {
    report,
    applied: {
      id: `transform_${crypto.randomUUID().slice(0, 8)}`,
      spec,
      author: options.author ?? 'agent',
      appliedAt: Date.now(),
      previousValues: scan.previousValues,
    },
    dataset: commit(dataset, column, spec, scan.nextValues),
  }
}

/**
 * The rows this call is about, ascending and without repeats.
 *
 * Ascending because `failedRowIds` has to be, and sorting the targets once is cheaper and simpler than
 * sorting the failures afterwards. Without repeats because `rows: [4, 4]` would otherwise count one row
 * twice and produce totals that sum to more rows than the file has.
 *
 * Iterates `dataset.rows.length` rather than `dataset.rowCount` when no subset is named: the array is what
 * exists, and if the two disagree the array is the one that will be written.
 */
function targetRows(dataset: Dataset, rows: readonly RowId[] | undefined): readonly RowId[] {
  if (rows === undefined) {
    return Array.from({ length: dataset.rows.length }, (_, index) => index)
  }

  for (const rowId of rows) {
    if (!Number.isInteger(rowId) || rowId < 0 || rowId >= dataset.rows.length) {
      throw new Error(
        `applyTransform: row ${rowId} is not in this file, which has ${dataset.rows.length} rows. The guard ` +
          `checks row ids against the row count before calling this.`,
      )
    }
  }

  return [...new Set(rows)].sort((a, b) => a - b)
}

/** The measurement, identical in both modes. */
function scanRows(
  dataset: Dataset,
  column: Column,
  spec: TransformSpec,
  targets: readonly RowId[],
  destructive: boolean,
): Scan {
  const transform = buildTransform(spec)

  const scan: Scan = {
    changed: 0,
    unchanged: 0,
    failed: 0,
    failedRowIds: [],
    examples: [],
    seenExamples: new Set<string>(),
    previousValues: new Map<RowId, string>(),
    nextValues: new Map<RowId, string>(),
  }

  for (const rowId of targets) {
    const before = dataset.rows[rowId]?.[column.index] ?? ''
    const outcome = transform(before)

    if (outcome.failed) {
      scan.failed += 1
      if (scan.failedRowIds.length < MAX_FAILED_IDS) scan.failedRowIds.push(rowId)
      continue
    }

    if (!outcome.changed) {
      scan.unchanged += 1
      continue
    }

    scan.changed += 1
    scan.nextValues.set(rowId, outcome.value)
    if (!destructive) scan.previousValues.set(rowId, before)
    noteExample(scan, before, outcome.value)
  }

  return scan
}

function noteExample(scan: Scan, before: string, after: string): void {
  if (scan.examples.length >= MAX_EXAMPLES) return

  const pair = maskPair(before, after)
  if (pair.from === pair.to) return

  const key = `${pair.from}\u0000${pair.to}`
  if (scan.seenExamples.has(key)) return

  scan.seenExamples.add(key)
  scan.examples.push(pair)
}

/**
 * The new dataset.
 *
 * A whole new rows array rather than a mutation in place, even on commit. The store holds the dataset and
 * React needs a new reference to re-render; more importantly, a half-applied mutation after an exception
 * mid-file leaves the human's data in a state that is neither before nor after, and there is no server-side
 * copy to fall back on. Rows that did not change keep their existing array — they are never written to, so
 * sharing them is safe and avoids copying 50,000 arrays to change 200 cells.
 *
 * `dropColumn` also drops the column from `columns`, which is what makes it a drop rather than a blanking.
 * The row arrays keep their width and the emptied position stays where it was, deliberately: `Column.index`
 * is a position in the row array, so splicing the rows would silently shift every column after this one and
 * every `Column` value already held elsewhere would then address its neighbour. Nothing can read a position
 * that no column names, and an export writes the columns it is given.
 */
function commit(
  dataset: Dataset,
  column: Column,
  spec: TransformSpec,
  nextValues: ReadonlyMap<RowId, string>,
): Dataset {
  const rows = dataset.rows.map((row, rowId) => {
    const next = nextValues.get(rowId)
    if (next === undefined) return row
    const copy = [...row]
    copy[column.index] = next
    return copy
  })

  const columns =
    spec.kind === 'dropColumn'
      ? dataset.columns.filter((candidate) => candidate.id !== column.id)
      : dataset.columns

  return { ...dataset, columns, rows, rowCount: rows.length }
}

/**
 * Put back what a transform changed.
 *
 * Restores `previousValues` by row id and returns a new dataset. Two refusals, and both are the same
 * argument: an undo that appears to work and did not is worse than an undo that failed loudly, because the
 * human sees a green confirmation and stops looking.
 *
 * **A destructive transform is refused rather than no-op'd.** `dropColumn` and `maskColumn` record no
 * previous values on purpose, so restoring them would walk an empty map, change nothing, and return
 * successfully. `undo_last` refuses these before calling; this is the same refusal one layer down, where it
 * cannot be forgotten.
 *
 * **A dataset missing a recorded row is refused rather than partially restored.** Transforms never reorder or
 * remove rows, so this can only happen if a different file was loaded over the top of this one — and then a
 * row id that addressed one record addresses another. Writing a stashed value into the wrong row is data
 * corruption that looks like a successful undo. Throwing loses the undo; guessing loses the data.
 */
export function revertTransform(dataset: Dataset, applied: AppliedTransform): Dataset {
  if (isDestructive(applied.spec)) {
    throw new Error(
      `revertTransform: ${applied.spec.kind} cannot be undone. It records no previous values, by design — ` +
        `keeping a copy of a column the human asked to remove is the opposite of removing it.`,
    )
  }

  const column = dataset.columns.find((candidate) => candidate.id === applied.spec.column)
  if (column === undefined) {
    throw new Error(
      `revertTransform: this dataset has no column called "${applied.spec.column}", so the values recorded ` +
        `for it have nowhere to go.`,
    )
  }

  for (const rowId of applied.previousValues.keys()) {
    if (dataset.rows[rowId] === undefined) {
      throw new Error(
        `revertTransform: row ${rowId} was recorded by this transform and is not in the current dataset, ` +
          `which has ${dataset.rows.length} rows. Refusing to restore any of it: row ids addressed a ` +
          `different file, and writing these values back would corrupt rows that look untouched.`,
      )
    }
  }

  const rows = dataset.rows.map((row, rowId) => {
    const previous = applied.previousValues.get(rowId)
    if (previous === undefined) return row
    const copy = [...row]
    copy[column.index] = previous
    return copy
  })

  return { ...dataset, rows }
}
