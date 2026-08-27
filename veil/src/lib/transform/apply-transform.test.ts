import { describe, expect, it } from 'vitest'

import type { Dataset, TransformSpec } from '@/types/domain'

import { applyTransform, revertTransform } from './apply-transform'

/**
 * Transform semantics, written as a specification before the implementation existed.
 *
 * Owner: Riko. **These tests are red on purpose.** Implement `apply-transform.ts` and `transforms.ts` to make
 * them pass; do not weaken, skip or delete a case — CONTRIBUTING.md § Some tests are red on purpose.
 *
 * The first test is the most important one in the file and the reason the dry run and the commit share a code
 * path at all: the human approves a preview, and a preview that does not match what happens is a consent form
 * for a different operation.
 */

const DATASET: Dataset = {
  columns: [
    { id: 'name', index: 0, type: 'text' },
    { id: 'joined', index: 1, type: 'text' },
    { id: 'phone', index: 2, type: 'text' },
  ],
  rows: [
    ['Ani ', '27/08/2026', '081210000001'],
    ['Budi', '2026-08-27', '081210000002'],
    ['  Cici', '27.08.2026', '081210000003'],
    ['Dedi', 'N/A', '081210000004'],
  ],
  sourceName: 'test.csv',
  rowCount: 4,
}

const TRIM: TransformSpec = { kind: 'trimWhitespace', column: 'name' }

describe('dry run and commit agree', () => {
  it('produces an identical report either way', () => {
    // The single most important assertion in this file. The human approves the dry run's numbers; if the
    // commit's numbers differ, they approved a different operation than the one that ran.
    const dry = applyTransform(DATASET, TRIM, { commit: false })
    const wet = applyTransform(DATASET, TRIM, { commit: true })

    expect(wet.report).toEqual(dry.report)
  })

  it('changes nothing on a dry run', () => {
    const before = JSON.stringify(DATASET.rows)

    const outcome = applyTransform(DATASET, TRIM, { commit: false })

    expect(JSON.stringify(DATASET.rows)).toBe(before)
    expect(outcome.dataset).toBeUndefined()
    expect(outcome.applied).toBeUndefined()
  })

  it('does not mutate the input dataset on commit either', () => {
    // The store needs a new reference to re-render, and a half-applied mutation after an exception mid-file
    // leaves the human's data in a state that is neither before nor after — with no server-side copy.
    const before = JSON.stringify(DATASET.rows)

    applyTransform(DATASET, TRIM, { commit: true })

    expect(JSON.stringify(DATASET.rows)).toBe(before)
  })
})

describe('counting', () => {
  it('counts changed, unchanged and failed separately', () => {
    // Collapsing failed into unchanged tells the human "these rows were already fine" about rows that are
    // unreadable, and they will approve it.
    const spec: TransformSpec = { kind: 'normaliseDate', column: 'joined', to: 'dateIso' }

    const { report } = applyTransform(DATASET, spec, { commit: false })

    expect(report.changedCount).toBe(2) // 27/08/2026 and 27.08.2026
    expect(report.unchangedCount).toBe(1) // already ISO
    expect(report.failedCount).toBe(1) // N/A
  })

  it('names the rows that failed, so a human can go and look at them', () => {
    const spec: TransformSpec = { kind: 'normaliseDate', column: 'joined', to: 'dateIso' }

    const { report } = applyTransform(DATASET, spec, { commit: false })

    expect(report.failedRowIds).toEqual([3])
  })

  it('counts a value that was already correct as unchanged, not changed', () => {
    // An implementation that writes every cell and counts every write reports 4 changes on an already-clean
    // column, and the human learns the numbers mean nothing.
    const spec: TransformSpec = { kind: 'trimWhitespace', column: 'phone' }

    const { report } = applyTransform(DATASET, spec, { commit: false })

    expect(report.changedCount).toBe(0)
    expect(report.unchangedCount).toBe(4)
  })

  it('reports totals that sum to the number of rows touched', () => {
    const { report } = applyTransform(DATASET, TRIM, { commit: false })

    expect(report.changedCount + report.unchangedCount + report.failedCount).toBe(DATASET.rowCount)
  })

  it('sums to the subset size when rows are named', () => {
    const { report } = applyTransform(DATASET, TRIM, { commit: false, rows: [0, 2] })

    expect(report.changedCount + report.unchangedCount + report.failedCount).toBe(2)
  })
})

describe('examples', () => {
  it('masks every example', () => {
    // An unmasked before/after pair is a bulk read wearing a preview's clothes: ten pairs per call, one call
    // per column, and the agent has read the file without ever asking to.
    const spec: TransformSpec = { kind: 'normaliseDate', column: 'joined', to: 'dateIso' }

    const { report } = applyTransform(DATASET, spec, { commit: false })

    expect(report.examples.length).toBeGreaterThan(0)
    for (const example of report.examples) {
      expect(example.from).not.toMatch(/[1-9]/)
      expect(example.to).not.toMatch(/[1-9]/)
    }
  })

  it('draws examples only from rows that changed', () => {
    // A preview of unchanged rows is a preview of nothing, and it is what the naive "first five rows"
    // implementation produces on a mostly-clean column.
    const spec: TransformSpec = { kind: 'normaliseDate', column: 'joined', to: 'dateIso' }

    const { report } = applyTransform(DATASET, spec, { commit: false })

    for (const example of report.examples) {
      expect(example.from).not.toBe(example.to)
    }
  })
})

describe('undo', () => {
  it('restores exactly what changed', () => {
    const committed = applyTransform(DATASET, TRIM, { commit: true })
    if (!committed.dataset || !committed.applied) throw new Error('expected a commit')

    const reverted = revertTransform(committed.dataset, committed.applied)

    expect(reverted.rows).toEqual(DATASET.rows)
  })

  it('stores previous values only for rows that changed', () => {
    // Storing every row's previous value doubles memory on a 50k file for no benefit.
    const committed = applyTransform(DATASET, TRIM, { commit: true })
    if (!committed.applied) throw new Error('expected a commit')

    expect(committed.applied.previousValues.size).toBe(committed.report.changedCount)
  })

  it('marks dropColumn destructive rather than stashing the column', () => {
    // Stashing would be a full copy of the most sensitive column in the file, kept alive after the human
    // asked for it to be gone.
    const spec: TransformSpec = { kind: 'dropColumn', column: 'phone' }

    const { report } = applyTransform(DATASET, spec, { commit: false })

    expect(report.destructive).toBe(true)
  })

  it('does not mark trimWhitespace destructive', () => {
    const { report } = applyTransform(DATASET, TRIM, { commit: false })

    expect(report.destructive).toBe(false)
  })

  it('refuses to revert into a dataset missing rows it recorded', () => {
    // Transforms never reorder or remove rows, so this only happens when a different file was loaded over the
    // top. Then a row id that addressed one record addresses another, and writing a stashed value into the
    // wrong row is corruption that looks like a successful undo — the human sees a green tick and stops
    // looking. Throwing loses the undo; guessing loses the data.
    const committed = applyTransform(DATASET, TRIM, { commit: true })
    if (!committed.dataset || !committed.applied) throw new Error('expected a commit')
    const applied = committed.applied

    const shorter: Dataset = {
      ...committed.dataset,
      rows: committed.dataset.rows.slice(0, 1),
      rowCount: 1,
    }

    expect(() => revertTransform(shorter, applied)).toThrow()
  })
})
