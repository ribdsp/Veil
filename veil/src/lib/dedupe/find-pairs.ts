import type { Column, ColumnId, Dataset, DuplicatePair } from '@/types/domain'

import { reduceRows } from '@/lib/data/parse-csv'

import { fold, similarity } from './similarity'

/**
 * Find candidate duplicate pairs without comparing every row to every other row.
 *
 * Owner: Riko.
 *
 * A 50,000-row file has 1.25 billion pairs. Comparing them all with Levenshtein is not slow, it is
 * impossible — and this runs on the thread holding the UI, which is the thread the human uses to answer
 * reveal requests. So: **blocking**. Group rows by a cheap key that near-duplicates are very likely to
 * share, then compare only within groups.
 */

/** Never return more than this many pairs; the response says when it truncated. */
export const MAX_PAIRS = 50

/** Rows in one block before it is abandoned rather than compared. See `findPairs`. */
const MAX_BLOCK = 500

/** Pair comparisons across the whole call before it stops looking. */
const MAX_COMPARISONS = 400_000

/** Characters of the folded value that open a block. */
const PREFIX = 2

/** Characters of the folded value that close one. */
const SUFFIX = 4

/** Length ÷ this, as part of the prefix key: `Ahmad` and `Ahmed` bucket together, `Ani` does not join them. */
const LENGTH_BUCKET = 4

/**
 * A cheap key that near-duplicates tend to share.
 *
 * First two characters of the folded value plus its length bucket. Cheap, and it groups `Ahmad` with
 * `Ahmed` while keeping `Ani` out of that block.
 *
 * **The key never leaves this module.** It contains two characters of somebody's value, which is a read —
 * small, but a read. `findPairs` reports abandoned blocks as counts in a sentence, not as keys.
 */
function blockKey(value: string): string {
  return `p:${value.slice(0, PREFIX)}:${Math.floor(value.length / LENGTH_BUCKET)}`
}

/**
 * The second key: the last four characters.
 *
 * Two blocking passes with different keys, unioned, because a single prefix key misses every duplicate whose
 * first character is the typo — `Wijaya`/`Vijaya`, a whole class of real duplicates and precisely the class a
 * human scanning the file would not spot either. It also covers the length-bucket boundary, where a
 * seven-character value and its eight-character twin land in different prefix blocks. Two cheap passes beat
 * one clever key.
 */
function tailKey(value: string): string {
  return `s:${value.slice(-SUFFIX)}`
}

type Row = { rowId: number; parts: readonly string[]; joined: string }

/**
 * Candidate pairs above the threshold, highest score first.
 *
 * Folds the named columns per row, blocks twice, compares within blocks, scores with `similarity`, keeps
 * pairs at or above `threshold`.
 *
 * ## Work is capped, not just output
 *
 * A pathological file — a column of `N/A`, or one where 4,000 rows share a placeholder — puts most of the
 * file in one block and the quadratic blow-up is back. A block above 500 rows is abandoned and reported
 * instead: "4,000 rows share a blocking key" is a *better* finding than a list of pairs anyway, because it
 * names a placeholder column rather than 8 million false duplicates. `MAX_COMPARISONS` is the same idea
 * across the whole call, for the file that has a hundred blocks of 499.
 *
 * The abandonment message carries a count and no characters of any value. The key that produced the block is
 * two characters of somebody's cell and stays in this module.
 *
 * ## Each pair once
 *
 * `(3, 17)` and `(17, 3)` are the same pair, and a UI listing both asks the human to make the same decision
 * twice — which is how habituation starts, and habituation is the risk docs/threat-model.md (T8) admits it
 * cannot measure. Pairs are keyed with the lower row id first, across both blocking passes.
 */
export function findPairs(
  dataset: Dataset,
  columns: readonly Column[],
  threshold: number,
): { pairs: readonly DuplicatePair[]; truncated: boolean; skippedBlocks: readonly string[] } {
  if (columns.length === 0) return { pairs: [], truncated: false, skippedBlocks: [] }

  const rows = foldRows(dataset, columns)

  const blocks = new Map<string, number[]>()
  rows.forEach((row, index) => {
    add(blocks, blockKey(row.joined), index)
    add(blocks, tailKey(row.joined), index)
  })

  const found = new Map<string, DuplicatePair>()
  const skippedBlocks: string[] = []
  let comparisons = 0
  let abandoned = false

  for (const members of blocks.values()) {
    if (members.length < 2) continue

    if (members.length > MAX_BLOCK) {
      skippedBlocks.push(
        `${members.length} rows share a blocking key on these columns and were not compared — that many ` +
          `near-identical values is usually a placeholder or a default, not ${members.length} duplicates. ` +
          `Profile the column and look for placeholderValue before treating them as duplicate records.`,
      )
      continue
    }

    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        if (comparisons >= MAX_COMPARISONS) {
          abandoned = true
          break
        }
        comparisons += 1

        const left = rows[members[i] ?? -1]
        const right = rows[members[j] ?? -1]
        if (left === undefined || right === undefined) continue

        const key = pairKey(left.rowId, right.rowId)
        if (found.has(key)) continue

        const score = similarity(left.joined, right.joined, threshold)
        if (score < threshold) continue

        found.set(key, {
          a: Math.min(left.rowId, right.rowId),
          b: Math.max(left.rowId, right.rowId),
          score,
          matchedColumns: matchedColumns(columns, left, right, threshold),
        })
      }
      if (abandoned) break
    }
    if (abandoned) break
  }

  if (abandoned) {
    skippedBlocks.push(
      `Stopped after ${MAX_COMPARISONS.toLocaleString('en-GB')} comparisons. The pairs below are real, but ` +
        `they are not all of them — narrow the column list or raise the threshold and ask again.`,
    )
  }

  const ordered = [...found.values()].sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b)

  return {
    pairs: ordered.slice(0, MAX_PAIRS),
    truncated: ordered.length > MAX_PAIRS || abandoned,
    skippedBlocks,
  }
}

/**
 * Fold every row's named columns once.
 *
 * The one place this function spends memory: a folded copy of the compared columns, for the length of the
 * call. Re-folding inside the comparison loop would be the alternative, and a block of 500 rows folds each
 * of its members 499 times.
 *
 * Rows whose named columns are entirely blank are dropped rather than compared. They are all identical to
 * each other, so they would form the largest block in the file and fill the entire pair list with "these two
 * empty rows are the same" — which is true, useless, and crowds out every real finding.
 */
function foldRows(dataset: Dataset, columns: readonly Column[]): readonly Row[] {
  return reduceRows(dataset, columns, [] as Row[], (accumulator, cells, rowId) => {
    const parts = cells.map((cell) => fold(cell))
    const joined = parts.join(' ').trim()
    if (joined !== '') accumulator.push({ rowId, parts, joined })
    return accumulator
  })
}

function add(blocks: Map<string, number[]>, key: string, index: number): void {
  const existing = blocks.get(key)
  if (existing === undefined) blocks.set(key, [index])
  else existing.push(index)
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/**
 * Which of the named columns are themselves similar enough.
 *
 * The score on the pair is over the concatenation, which is what decides whether the rows are the same
 * record. This says *where* they agree, and it is the part the human reads: two rows matching on `email` is
 * a duplicate, two rows matching on `city` is a coincidence. Reported as column names, never as values.
 */
function matchedColumns(
  columns: readonly Column[],
  left: Row,
  right: Row,
  threshold: number,
): readonly ColumnId[] {
  const matched: ColumnId[] = []

  columns.forEach((column, index) => {
    const a = left.parts[index] ?? ''
    const b = right.parts[index] ?? ''
    if (a === '' && b === '') return
    if (similarity(a, b, threshold) >= threshold) matched.push(column.id)
  })

  return matched
}
