import { describe, expect, it } from 'vitest'

import { mask, maskPair, sampleExemplars, scriptNote } from './redact'

/**
 * Masking and exemplar selection.
 *
 * Owner: Riko. Contract: docs/privacy-guard.md § Masking.
 *
 * These are the functions that stand between a cell and the model's context in every read path that returns
 * something resembling a value, so they are tested directly rather than only through the tools. The exemplar
 * tests pin behaviour that is easy to regress into a leak or into noise: masks are deduplicated (ten copies of
 * one shape teach nothing), the pool is scanned in file order (an exemplar set that changes between identical
 * calls invites a differencing attack), and the scan is bounded (a single-shape column must not mask every row
 * looking for a second shape).
 */

/** A bucket whose values are read by row id, so a test can assert what was and was not looked at. */
function pool(values: readonly string[]): { valueAt: (rowId: number) => string; reads: number[] } {
  const reads: number[] = []
  return {
    valueAt: (rowId) => {
      reads.push(rowId)
      return values[rowId] ?? ''
    },
    reads,
  }
}

describe('mask', () => {
  it('replaces digits with 0, uppercase with A and lowercase with a', () => {
    // Arrange
    const value = 'Ahmad Fauzi 27'

    // Act
    const masked = mask(value)

    // Assert
    expect(masked).toBe('Aaaaa Aaaaa 00')
  })

  it('keeps punctuation and structure, because that is the whole point of a shape', () => {
    // Arrange, Act, Assert
    // An agent writing a date transform has to see whether the separator is "/" or ".".
    expect(mask('27/08/2026')).toBe('00/00/0000')
    expect(mask('+6281234567890')).toBe('+0000000000000')
    expect(mask('a.wijaya@example.co.id')).toBe('a.aaaaaa@aaaaaaa.aa.aa')
  })

  it('never emits a digit other than 0, so a mask cannot be mistaken for a value', () => {
    // Arrange
    const value = '19,999.95'

    // Act
    const masked = mask(value)

    // Assert
    expect(masked).not.toMatch(/[1-9]/)
  })

  it('reports a caseless letter as one x and an accented Latin letter by its base', () => {
    // Arrange
    const han = '陈'
    const precomposed = 'é'
    const decomposed = 'é'

    // Act, Assert
    expect(mask(han)).toBe('x')
    // Both spellings of the same letter have to mask alike, and as "a": "x" would have scriptNote telling the
    // agent that case transforms do nothing to a letter changeCase handles fine.
    expect(mask(precomposed)).toBe('a')
    expect(mask(decomposed)).toBe('a')
    // The diacritic itself is dropped — a mask showing an accent from somebody's name is a leak.
    expect(mask('José')).toBe('Aaaa')
  })

  it('keeps one mask character per visible character in a syllabic script', () => {
    // Arrange
    // NFD over a Hangul syllable yields three jamo; a mask longer than its value misreports the shape.
    const syllable = '한'

    // Act, Assert
    expect(mask(syllable)).toBe('x')
  })

  it('iterates code points, so an emoji survives as one character', () => {
    // Act
    const masked = mask('a🙂b')

    // Assert
    expect(masked).toBe('a🙂a')
  })
})

describe('maskPair', () => {
  it('masks both sides of a transform preview', () => {
    // Act
    const pair = maskPair('27/08/2026', '2026-08-27')

    // Assert
    expect(pair).toEqual({ from: '00/00/0000', to: '0000-00-00' })
  })
})

describe('scriptNote', () => {
  it('says nothing when every shape is Latin', () => {
    // Act, Assert
    expect(scriptNote(['Aaaaa', '00/00/0000'])).toBeNull()
  })

  it('explains the x and warns that a case transform would do nothing', () => {
    // Act
    const note = scriptNote(['Aaaaa', 'xx'])

    // Assert
    expect(note).toMatch(/"x"/)
    expect(note).toMatch(/[Cc]ase transforms do nothing/)
  })
})

describe('sampleExemplars', () => {
  it('spreads across buckets before taking a second from any one', () => {
    // Arrange
    const buckets = [
      { format: 'dateIso', rowIds: [0, 1] },
      { format: 'dateDmy', rowIds: [2, 3] },
    ]
    // Distinct masks within each bucket, so the order is the round-robin's and not the deduplication's.
    const values = ['2026-08-27', '2026-8-7', '27/08/2026', '7/8/2026']

    // Act
    const exemplars = sampleExemplars(buckets, (rowId) => values[rowId] ?? '', 4)

    // Assert
    // One per format first: a column with one messy shape and one clean one must show both.
    expect(exemplars.map((exemplar) => exemplar.format)).toEqual(['dateIso', 'dateDmy', 'dateIso', 'dateDmy'])
  })

  it('returns one exemplar rather than ten copies when the masks are identical', () => {
    // Arrange
    // Seven-letter city names all mask to the same string, which is the common case for a category column.
    const values = ['Jakarta', 'Bandung', 'Jakarta', 'Bandung']
    const buckets = [{ format: 'titleCase', rowIds: [0, 1, 2, 3] }]

    // Act
    const exemplars = sampleExemplars(buckets, (rowId) => values[rowId] ?? '', 10)

    // Assert
    expect(exemplars).toEqual([{ format: 'titleCase', masked: 'Aaaaaaa' }])
  })

  it('keeps the shapes a column really has, up to the limit', () => {
    // Arrange
    const values = ['Jakarta', 'Medan', 'Solo', 'Bandung']
    const buckets = [{ format: 'titleCase', rowIds: [0, 1, 2, 3] }]

    // Act
    const exemplars = sampleExemplars(buckets, (rowId) => values[rowId] ?? '', 10)

    // Assert
    // Jakarta and Bandung collapse into one shape; Medan and Solo are their own.
    expect(exemplars.map((exemplar) => exemplar.masked)).toEqual(['Aaaaaaa', 'Aaaaa', 'Aaaa'])
  })

  it('keeps one shape per format when two formats mask alike', () => {
    // Arrange
    // The same shape under two names is worth seeing: it says the classifier split values that look alike.
    const values = ['12345678901', '12345678901']
    const buckets = [
      { format: 'phoneLocalId', rowIds: [0] },
      { format: 'numberPlain', rowIds: [1] },
    ]

    // Act
    const exemplars = sampleExemplars(buckets, (rowId) => values[rowId] ?? '', 10)

    // Assert
    expect(exemplars).toHaveLength(2)
    expect(exemplars.every((exemplar) => exemplar.masked === '00000000000')).toBe(true)
  })

  it('draws in file order, so two identical calls return the same set', () => {
    // Arrange
    const values = ['aa', 'bbb', 'cccc']
    const buckets = [{ format: 'lowerCase', rowIds: [0, 1, 2] }]

    // Act
    const first = sampleExemplars(buckets, (rowId) => values[rowId] ?? '', 3)
    const second = sampleExemplars(buckets, (rowId) => values[rowId] ?? '', 3)

    // Assert
    expect(first).toEqual(second)
    expect(first.map((exemplar) => exemplar.masked)).toEqual(['aa', 'aaa', 'aaaa'])
  })

  it('stops looking for a new shape instead of masking the whole column', () => {
    // Arrange
    // One shape, many rows: without a bound this would mask every row to fill ten slots it can never fill.
    const values = Array.from({ length: 5_000 }, () => 'Jakarta')
    const buckets = [{ format: 'titleCase', rowIds: values.map((_, index) => index) }]
    const reader = pool(values)

    // Act
    const exemplars = sampleExemplars(buckets, reader.valueAt, 10)

    // Assert
    expect(exemplars).toHaveLength(1)
    expect(reader.reads.length).toBeLessThanOrEqual(200)
  })

  it('reads nothing at all when asked for no exemplars', () => {
    // Arrange
    const reader = pool(['Jakarta'])

    // Act
    const exemplars = sampleExemplars([{ format: 'titleCase', rowIds: [0] }], reader.valueAt, 0)

    // Assert
    expect(exemplars).toEqual([])
    expect(reader.reads).toEqual([])
  })

  it('returns nothing when there are no buckets', () => {
    // Act, Assert
    expect(sampleExemplars([], () => 'unused', 10)).toEqual([])
  })
})
