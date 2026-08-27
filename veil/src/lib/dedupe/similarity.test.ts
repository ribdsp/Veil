import { describe, expect, it } from 'vitest'

import { fold, similarity } from './similarity'

/**
 * Similarity scoring, written as a specification before the implementation existed.
 *
 * Owner: Riko. **These tests are red on purpose.** Implement `similarity.ts` to make them pass; do not
 * weaken, skip or delete a case — CONTRIBUTING.md § Some tests are red on purpose.
 *
 * Less privacy-critical than the guard tests and more likely to be got subtly wrong, which is why the
 * thresholds below are asserted as ranges rather than exact numbers: the specification is "these two are
 * clearly the same record" and "these two clearly are not", not a particular arithmetic.
 */

describe('similarity', () => {
  it('scores identical strings 1', () => {
    expect(similarity('Ahmad Fauzi', 'Ahmad Fauzi')).toBe(1)
  })

  it('scores two empty strings 1 rather than dividing by zero', () => {
    // Two empty cells are the same cell. The naive normalisation is `1 - distance / maxLength`, which is
    // 0/0 here, and NaN then compares false against every threshold — so every pair of empty cells is
    // silently *not* a duplicate, in the column where duplicates are most likely.
    expect(similarity('', '')).toBe(1)
  })

  it('scores an empty string against a non-empty one 0', () => {
    expect(similarity('', 'Ahmad')).toBe(0)
  })

  it('scores a one-character typo in a short name high', () => {
    // Ahmad / Ahmed: the case the product exists for.
    expect(similarity('Ahmad', 'Ahmed')).toBeGreaterThan(0.75)
  })

  it('scores two unrelated names low', () => {
    expect(similarity('Ahmad Fauzi', 'Siti Nurhaliza')).toBeLessThan(0.4)
  })

  it('is symmetric', () => {
    // Asymmetry here means a pair's score depends on which row came first, and the pair list is built by
    // iterating rows — so the same duplicate is found or missed depending on file order.
    expect(similarity('Wijaya', 'Wijoyo')).toBe(similarity('Wijoyo', 'Wijaya'))
  })

  it('normalises by the longer string, not the shorter', () => {
    // Normalising by the shorter one makes every prefix a perfect match: 'Ani' against 'Ani Wijaya Kusuma'
    // scores 1, and a first name matches half the file.
    expect(similarity('Ani', 'Ani Wijaya Kusuma')).toBeLessThan(0.4)
  })

  it('does not depend on string length for equal proportions of difference', () => {
    // One character in five and four in twenty are the same amount of wrong, and a scorer that says
    // otherwise needs a different threshold per column length — which is a threshold nobody can choose.
    const short = similarity('abcde', 'abcdX')
    const long = similarity('abcdeabcdeabcdeabcde', 'abcdeabcdeabcdeabcXX')

    expect(Math.abs(short - long)).toBeLessThan(0.2)
  })
})

describe('fold', () => {
  it('lowercases', () => {
    expect(fold('MATARAM')).toBe('mataram')
  })

  it('collapses runs of whitespace', () => {
    expect(fold('Ahmad   Fauzi')).toBe('ahmad fauzi')
  })

  it('trims', () => {
    expect(fold('  Ahmad Fauzi  ')).toBe('ahmad fauzi')
  })

  it('strips punctuation, so PT. Sumber Jaya folds to pt sumber jaya', () => {
    // The case people actually have in their files.
    expect(fold('PT. Sumber Jaya')).toBe('pt sumber jaya')
  })

  it('leaves digits alone', () => {
    // Folding digits would make 0812 and 0813 identical, and phone columns are where duplicates matter most.
    expect(fold('0812-1000-0002')).toBe('081210000002')
  })

  it('keeps a non-Latin string usable rather than emptying it', () => {
    // A naive punctuation strip built from [^a-z0-9 ] deletes every non-Latin character, folding a Javanese
    // or Arabic name to an empty string — after which it matches every other such name at similarity 1.
    // That is a false duplicate on exactly the records least likely to be checked by hand.
    expect(fold('عبد الله').length).toBeGreaterThan(0)
  })
})
