import type {
  AppliedTransform,
  Dataset,
  RowId,
  TransformReport,
  TransformSpec,
} from '@/types/domain'

/**
 * Run a transform. Once, for both the dry run and the commit.
 *
 * Owner: Riko.
 *
 * **One code path, two modes.** `commit: false` computes the report and discards the new values;
 * `commit: true` computes the same report and keeps them. That is not a tidiness preference — a preview
 * computed by different code than the commit is a preview that can be wrong, and a wrong preview is worse
 * than no preview, because the human approved the wrong one. `apply-transform.test.ts` asserts the two agree.
 */

export type ApplyOutcome = {
  report: TransformReport
  /** Present only when committed. Holds the previous values, which is what makes undo exact. */
  applied?: AppliedTransform
  /** Present only when committed. */
  dataset?: Dataset
}

/**
 * Apply or dry-run a transform.
 *
 * TODO(riko), Day 5: implement. One pass over the target rows, calling the function from `buildTransform`,
 * counting `changedCount` / `unchangedCount` / `failedCount` separately, collecting the first 10 failed row
 * ids ascending, and collecting up to 10 masked before/after pairs drawn from rows that actually changed.
 *
 * TODO(riko), Day 5: build a whole new rows array rather than mutating in place, even on commit. The store
 * holds the dataset and React needs a new reference to re-render; more importantly, a half-applied mutation
 * after an exception mid-file leaves the human's data in a state that is neither before nor after, and there
 * is no server-side copy to fall back on.
 *
 * TODO(riko), Day 5: capture `previousValues` for changed rows only. Storing every row's previous value on a
 * 50k-row file doubles the memory for no benefit — undo only needs the cells that moved.
 *
 * TODO(riko), Day 6: `dropColumn` and `maskColumn` set `destructive: true`, and `undo_last` refuses them.
 * Do not be tempted to make `dropColumn` undoable by stashing the column: that is a full copy of the most
 * sensitive column in the file, kept alive after the human asked for it to be gone, which is the opposite of
 * what they asked for.
 */
export function applyTransform(
  _dataset: Dataset,
  _spec: TransformSpec,
  _options: { rows?: readonly RowId[]; commit: boolean },
): ApplyOutcome {
  throw new Error('applyTransform: not implemented')
}

/**
 * Put back what a transform changed.
 *
 * TODO(riko), Day 6: implement. Restore `previousValues` by row id, and return a new dataset.
 *
 * TODO(riko), Day 6: throw — do not partially restore — when the dataset no longer contains every row id in
 * `previousValues`. Transforms never reorder or remove rows, so this can only happen if a different file was
 * loaded over the top of this one, and then a row id that addressed one record addresses another. Writing a
 * stashed value into the wrong row is data corruption that looks like a successful undo, which is the failure
 * mode with no recovery path: the human sees a green confirmation and stops looking.
 */
export function revertTransform(_dataset: Dataset, _applied: AppliedTransform): Dataset {
  throw new Error('revertTransform: not implemented')
}
