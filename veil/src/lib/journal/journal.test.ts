import { describe, expect, it } from 'vitest'

import type { JournalEntry, JournalEventKind } from '@/types/domain'

import { buildExport, render } from './export'
import { append, entry, refusals, revealsGranted } from './journal'

/**
 * The journal, tested where its failures hide.
 *
 * Owner: Vicko. CONTRIBUTING.md § Testing policy: the test budget goes where a bug is invisible. A wrong number
 * in the audit trail looks exactly like a right one — nobody notices a summary that under-counts reveals, which
 * is the number the whole habituation defence (threat model T8) rests on.
 *
 * `at` is injected everywhere below rather than slept for. A test that sleeps is a test someone will delete.
 */

const CONTEXT = { sourceName: 'customers.csv', rowCount: 4200, minGroupSize: 5, queriesPerColumn: 12 }

/** A journal built from `[kind, at]` pairs, so a test can say what it means in one line. */
function journalOf(...lines: readonly (readonly [JournalEventKind, number])[]): readonly JournalEntry[] {
  return lines.reduce<readonly JournalEntry[]>(
    (journal, [kind, at]) => append(journal, entry(kind, 'agent', 'subject', 'detail', { at })),
    [],
  )
}

describe('entry', () => {
  it('gives every entry its own id', () => {
    const ids = new Set(
      Array.from({ length: 500 }, () => entry('toolCalled', 'agent', 'count_where', 'x', { at: 1 }).id),
    )
    expect(ids.size).toBe(500)
  })

  it('uses the injected `at` rather than the clock, so ordering is assertable', () => {
    const first = entry('toolCalled', 'agent', 'a', 'x', { at: 1_000 })
    const second = entry('toolCalled', 'agent', 'b', 'x', { at: 2_000 })
    expect([first.at, second.at]).toEqual([1_000, 2_000])
    expect(second.at).toBeGreaterThan(first.at)
  })

  it('falls back to the clock when `at` is omitted', () => {
    const before = Date.now()
    const line = entry('toolCalled', 'human', 'a', 'x')
    expect(line.at).toBeGreaterThanOrEqual(before)
  })

  it('is reversible unless a caller says otherwise', () => {
    expect(entry('toolCalled', 'agent', 'a', 'x', { at: 1 }).irreversible).toBe(false)
    expect(entry('revealGranted', 'human', 'a', 'x', { at: 1, irreversible: true }).irreversible).toBe(true)
  })
})

describe('append', () => {
  it('returns a new array and leaves the old one untouched', () => {
    const before = journalOf(['toolCalled', 1])
    const after = append(before, entry('toolCalled', 'agent', 'b', 'x', { at: 2 }))
    expect(before).toHaveLength(1)
    expect(after).toHaveLength(2)
    expect(after).not.toBe(before)
  })

  it('never caps the length — a journal that drops its oldest lines looks complete and is not', () => {
    let journal: readonly JournalEntry[] = []
    for (let i = 0; i < 2_000; i += 1) {
      journal = append(journal, entry('toolCalled', 'agent', 'a', 'x', { at: i }))
    }
    expect(journal).toHaveLength(2_000)
    expect(journal[0]?.at).toBe(0)
  })
})

describe('revealsGranted', () => {
  it('counts granted reveals and nothing else', () => {
    const journal = journalOf(
      ['revealRequested', 1],
      ['revealGranted', 2],
      ['revealRefused', 3],
      ['revealRequested', 4],
      ['revealGranted', 5],
    )
    expect(revealsGranted(journal)).toBe(2)
    expect(revealsGranted([])).toBe(0)
  })
})

describe('refusals', () => {
  it('is suppressions, refused reveals and exhausted budgets, in the order they happened', () => {
    const journal = journalOf(
      ['toolCalled', 1],
      ['answerSuppressed', 2],
      ['revealRequested', 3],
      ['revealRefused', 4],
      ['revealGranted', 5],
      ['budgetExhausted', 6],
      ['reportSubmitted', 7],
    )
    expect(refusals(journal).map((line) => line.kind)).toEqual([
      'answerSuppressed',
      'revealRefused',
      'budgetExhausted',
    ])
  })
})

describe('buildExport', () => {
  const journal = journalOf(
    ['toolCalled', 1],
    ['toolCalled', 2],
    ['answerSuppressed', 3],
    ['transformApplied', 4],
    ['transformUndone', 5],
    ['revealRequested', 6],
    ['revealGranted', 7],
  )

  it('computes a summary that matches the entries it ships with', () => {
    const data = buildExport(journal, CONTEXT)
    expect(data.summary).toEqual({
      toolCalls: 2,
      suppressedAnswers: 1,
      transformsApplied: 1,
      revealsRequested: 1,
      revealsGranted: 1,
    })
    expect(data.entries).toHaveLength(journal.length)
  })

  it('stamps `exportedAt` as ISO 8601 with an offset, not a bare epoch', () => {
    expect(buildExport(journal, CONTEXT).exportedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    )
  })

  it('carries decisions, never data — no rows, no transform stack, no previousValues', () => {
    const serialised = JSON.stringify(buildExport(journal, CONTEXT))
    expect(Object.keys(buildExport(journal, CONTEXT))).toEqual([
      'tool',
      'version',
      'exportedAt',
      'dataset',
      'settings',
      'summary',
      'entries',
    ])
    expect(serialised).not.toMatch(/previousValues|"rows"|"applied"|"proposals"/)
  })
})

describe('render', () => {
  const nasty = append(
    [],
    entry('revealGranted', 'human', 'phone row 12', 'Granted | because\nthe agent asked', {
      at: 1,
      irreversible: true,
    }),
  )

  it('round-trips as JSON', () => {
    const data = buildExport(nasty, CONTEXT)
    expect(JSON.parse(render(data, 'json'))).toEqual(JSON.parse(JSON.stringify(data)))
  })

  it('keeps the Markdown table intact when a detail contains a pipe and a newline', () => {
    const markdown = render(buildExport(nasty, CONTEXT), 'markdown')
    const row = markdown.split('\n').find((line) => line.includes('phone row 12'))
    expect(row).toBeDefined()
    // Six cells means seven delimiting pipes; an unescaped pipe in the detail would push that to eight and
    // shear every row after this one.
    expect((row ?? '').replace(/\\\|/g, '').split('|')).toHaveLength(8)
    expect(row).toContain('\\|')
    expect(row).toContain('irreversible')
  })

  it('puts the summary above the entries, and says so when there are none', () => {
    const markdown = render(buildExport([], CONTEXT), 'markdown')
    expect(markdown.indexOf('## Summary')).toBeLessThan(markdown.indexOf('## Entries'))
    expect(markdown).toContain('customers.csv')
    expect(markdown).toContain('Nothing was recorded in this session.')
  })
})
