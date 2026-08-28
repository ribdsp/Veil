import { beforeEach, describe, expect, it } from 'vitest'

import type { AppliedTransform, Dataset, Gate, RevealDecision } from '@/types/domain'

import { EMPTY_SESSION, snapshot, useSession } from './dataset'

/**
 * The store's three load-bearing rules, and nothing else.
 *
 * Owner: Vicko. Not a general store test — components announce their own bugs within five seconds of opening the
 * page (CONTRIBUTING.md § Testing policy). These three fail silently instead: a double-settled gate inflates the
 * reveal count the human is meant to be watching, a lowered k re-answers the whole session, and a refunded
 * budget turns undo into a way to buy more questions. No DOM, no React — the store is reachable as a plain
 * object from `getState()`, which is the same route the tools take.
 */

/** Synthetic, per CONTRIBUTING.md rule 4: one made-up column, one made-up row. */
const DATASET: Dataset = {
  columns: [{ id: 'phone', index: 0, type: 'text' }],
  rows: [['0800000000']],
  sourceName: 'synthetic.csv',
  rowCount: 1,
}

const APPLIED: AppliedTransform = {
  id: 't1',
  spec: { kind: 'trimWhitespace', column: 'phone' },
  author: 'agent',
  appliedAt: 1,
  previousValues: new Map([[0, ' 0800000000 ']]),
}

function fakeGate(record: RevealDecision[]): Gate<RevealDecision> {
  return { id: 'rv_1', createdAt: 0, expiresAt: 0, resolve: (decision) => record.push(decision) }
}

beforeEach(() => {
  // Merge, not replace: replacing would drop the actions along with the state.
  useSession.setState(EMPTY_SESSION)
})

describe('settleReveal', () => {
  it('settles once, however many times Approve is clicked', () => {
    const resolved: RevealDecision[] = []
    const { openReveal, settleReveal } = useSession.getState()
    openReveal(fakeGate(resolved), { column: 'phone', row: 0, reason: 'the last four digits are missing' })

    settleReveal({ granted: true, value: '0800000000' })
    settleReveal({ granted: true, value: '0800000000' })

    const state = snapshot()
    expect(resolved).toHaveLength(1)
    expect(state.pendingReveal).toBeNull()
    expect(state.revealsGranted).toBe(1)
    const granted = state.journal.filter((line) => line.kind === 'revealGranted')
    expect(granted).toHaveLength(1)
    expect(granted[0]?.irreversible).toBe(true)
    expect(granted[0]?.author).toBe('human')
  })

  it('does not count a refusal, and passes the human reason back', () => {
    const resolved: RevealDecision[] = []
    const { openReveal, settleReveal } = useSession.getState()
    openReveal(fakeGate(resolved), { column: 'phone', row: 0, reason: 'need to see it' })
    settleReveal({ granted: false, reason: 'you do not need a name to fix a date column' })

    const state = snapshot()
    expect(state.revealsGranted).toBe(0)
    expect(state.journal.at(-1)?.kind).toBe('revealRefused')
    expect(state.journal.at(-1)?.irreversible).toBe(false)
    expect(resolved).toEqual([{ granted: false, reason: 'you do not need a name to fix a date column' }])
  })

  it('is a no-op with nothing pending', () => {
    useSession.getState().settleReveal({ granted: true, value: 'x' })
    expect(snapshot().journal).toHaveLength(0)
  })
})

describe('raiseMinGroupSize', () => {
  it('raises, and journals the raise', () => {
    useSession.getState().raiseMinGroupSize(8)
    expect(snapshot().minGroupSize).toBe(8)
    expect(snapshot().journal).toHaveLength(1)
  })

  it('refuses to go down or sideways, and journals the attempt', () => {
    const { raiseMinGroupSize } = useSession.getState()
    raiseMinGroupSize(3)
    raiseMinGroupSize(5)
    raiseMinGroupSize(4.5)
    expect(snapshot().minGroupSize).toBe(5)
    expect(snapshot().journal).toHaveLength(3)
    expect(snapshot().journal.every((line) => line.detail.startsWith('Rejected'))).toBe(true)
  })
})

describe('undoTransform', () => {
  it('pops the stack without refunding the query budget', () => {
    const { loadDataset, recordQueries, commitTransform, undoTransform } = useSession.getState()
    loadDataset(DATASET, {})
    recordQueries(['phone', 'phone'])
    commitTransform(DATASET, APPLIED, 'agent')
    undoTransform(DATASET, 'human')

    const state = snapshot()
    expect(state.applied).toHaveLength(0)
    expect(state.queriesUsed.phone).toBe(2)
    expect(state.journal.at(-1)?.kind).toBe('transformUndone')
    expect(state.journal.at(-1)?.author).toBe('human')
  })
})

describe('clearDataset', () => {
  it('drops the dataset and keeps the journal', () => {
    const { loadDataset, clearDataset } = useSession.getState()
    loadDataset(DATASET, {})
    const before = snapshot().journal.length
    clearDataset()

    const state = snapshot()
    expect(state.dataset).toBeNull()
    expect(state.journal.length).toBe(before + 1)
  })
})
