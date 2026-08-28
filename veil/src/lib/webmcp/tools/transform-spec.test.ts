import { describe, expect, it } from 'vitest'

import { TRANSFORM_KINDS, parseRows, parseTransformSpec } from './transform-spec'

/**
 * The boundary between what the model sent and what the transform layer runs.
 *
 * Owner: Riko. Unit tests for the only real logic in the tool layer: two field renames, one required field
 * that is never defaulted, and one argument that is accepted and ignored on purpose. Each of those is a
 * place where a silent mistake produces a plausible-looking transform on somebody's data, which is why they
 * are tested here rather than only through the inspector.
 */

/** Minimal valid arguments for each kind, so a new kind added without a parser fails a test. */
const MINIMAL: Readonly<Record<(typeof TRANSFORM_KINDS)[number], Record<string, unknown>>> = {
  trimWhitespace: {},
  collapseSpaces: {},
  changeCase: { to: 'lower' },
  normaliseDate: { to: 'dateIso' },
  normalisePhone: { to: 'phoneE164', defaultCountryCode: '+62' },
  normaliseNumber: { to: 'decimalPoint' },
  padLeft: { length: 6 },
  replacePlaceholderWithEmpty: {},
  dropColumn: {},
  maskColumn: { keep: 'nothing' },
}

describe('parseTransformSpec', () => {
  it('parses every kind the frozen union allows', () => {
    for (const kind of TRANSFORM_KINDS) {
      // Arrange
      const args = { kind, column: 'phone', ...MINIMAL[kind] }

      // Act
      const result = parseTransformSpec(args)

      // Assert
      expect(result.ok, `${kind} did not parse`).toBe(true)
      if (result.ok) expect(result.spec.kind).toBe(kind)
    }
  })

  it('renames padWith to the spec field and defaults it to "0"', () => {
    // Arrange
    const withFill = { kind: 'padLeft', column: 'code', length: 6, padWith: 'x' }
    const withoutFill = { kind: 'padLeft', column: 'code', length: 6 }

    // Act
    const explicit = parseTransformSpec(withFill)
    const defaulted = parseTransformSpec(withoutFill)

    // Assert
    expect(explicit.ok && explicit.spec.kind === 'padLeft' && explicit.spec.with).toBe('x')
    expect(defaulted.ok && defaulted.spec.kind === 'padLeft' && defaulted.spec.with).toBe('0')
  })

  it('renames the schema\'s keep "nothing" to the spec\'s "none"', () => {
    // Arrange
    const args = { kind: 'maskColumn', column: 'nik', keep: 'nothing' }

    // Act
    const result = parseTransformSpec(args)

    // Assert
    expect(result.ok && result.spec.kind === 'maskColumn' && result.spec.keep).toBe('none')
  })

  it('requires a country code for normalisePhone rather than guessing one', () => {
    // Arrange
    const args = { kind: 'normalisePhone', column: 'phone', to: 'phoneE164' }

    // Act
    const result = parseTransformSpec(args)

    // Assert
    expect(result.ok).toBe(false)
    // The error has to name the field, because the model's next move is to supply it.
    if (!result.ok) expect(result.error).toMatch(/defaultCountryCode/)
  })

  it('accepts a country code with or without its plus sign', () => {
    // Arrange
    const bare = { kind: 'normalisePhone', column: 'phone', defaultCountryCode: '62' }

    // Act
    const result = parseTransformSpec(bare)

    // Assert
    expect(result.ok && result.spec.kind === 'normalisePhone' && result.spec.defaultCountryCode).toBe('62')
  })

  it('rejects an unknown kind and lists the ones that exist', () => {
    // Arrange
    const args = { kind: 'runScript', column: 'phone' }

    // Act
    const result = parseTransformSpec(args)

    // Assert
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/trimWhitespace/)
      expect(result.error).toMatch(/maskColumn/)
    }
  })

  it('rejects a transform with no column', () => {
    // Arrange
    const args = { kind: 'trimWhitespace' }

    // Act
    const result = parseTransformSpec(args)

    // Assert
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/column/)
  })

  it('reports a supplied placeholder list as ignored instead of silently dropping it', () => {
    // Arrange
    const args = { kind: 'replacePlaceholderWithEmpty', column: 'notes', placeholders: ['whatever'] }

    // Act
    const result = parseTransformSpec(args)

    // Assert
    expect(result.ok).toBe(true)
    // Silently ignoring it would let the agent believe it had narrowed the transform when it had not.
    if (result.ok) expect(result.notes.join(' ')).toMatch(/ignored/i)
  })

  it('refuses a pad width wide enough to be a typo', () => {
    // Arrange
    const tooWide = { kind: 'padLeft', column: 'code', length: 100_000 }
    const notPositive = { kind: 'padLeft', column: 'code', length: 0 }

    // Act
    const wide = parseTransformSpec(tooWide)
    const zero = parseTransformSpec(notPositive)

    // Assert
    expect(wide.ok).toBe(false)
    expect(zero.ok).toBe(false)
  })

  it('rejects arguments that are not an object at all', () => {
    // Arrange, Act, Assert
    expect(parseTransformSpec(undefined).ok).toBe(false)
    expect(parseTransformSpec('trimWhitespace').ok).toBe(false)
    expect(parseTransformSpec([{ kind: 'trimWhitespace' }]).ok).toBe(false)
  })
})

describe('parseRows', () => {
  it('treats an absent list as the whole column', () => {
    // Act
    const result = parseRows(undefined)

    // Assert
    expect(result.ok && result.rows).toBeUndefined()
  })

  it('rejects an empty list rather than reporting a transform that changed nothing', () => {
    // Act
    const result = parseRows([])

    // Assert
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/empty/i)
  })

  it('deduplicates and orders row numbers', () => {
    // Act
    const result = parseRows([9, 2, 9, 0])

    // Assert
    expect(result.ok && result.rows).toEqual([0, 2, 9])
  })

  it('rejects row numbers that are not whole and not positive', () => {
    // Arrange, Act, Assert
    expect(parseRows([1.5]).ok).toBe(false)
    expect(parseRows([-1]).ok).toBe(false)
    expect(parseRows(['3']).ok).toBe(false)
    expect(parseRows(3).ok).toBe(false)
  })
})
