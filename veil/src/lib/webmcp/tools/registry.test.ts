import { describe, expect, it } from 'vitest'

import { allTools, trustedToolNames } from './index'

/**
 * Checks on the tool surface itself rather than on any tool's behaviour.
 *
 * Owner: Vicko.
 *
 * These pass today and should keep passing — unlike the guard tests, none of them is a specification
 * waiting to be implemented. They exist because every failure they catch is silent: a duplicate tool name
 * means one tool shadows another with no error anywhere, a missing `additionalProperties: false` means a
 * hallucinated argument is accepted rather than corrected, and a trusted tool that forgot its flag is a
 * privacy control that was never wired up.
 *
 * The last two are the ones worth having. They encode decisions from docs/tools.md that a well-meaning
 * contributor could undo in a one-line diff and nobody would notice in review.
 */

const TRUSTED_BY_DESIGN = [
  'apply_transform',
  'undo_last',
  'request_reveal',
  'submit_cleanup_report',
] as const

describe('tool registry', () => {
  it('registers every documented tool', () => {
    expect(allTools).toHaveLength(14)
  })

  it('has no duplicate names', () => {
    const names = allTools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('names tools in snake_case, as the rest of the ecosystem does', () => {
    for (const tool of allTools) {
      expect(tool.name, tool.name).toMatch(/^[a-z][a-z_]*[a-z]$/)
    }
  })

  it('closes every schema against arguments a model invented', () => {
    for (const tool of allTools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false)
    }
  })

  it('describes every tool at enough length to say when to use it', () => {
    // Not a style rule. A description short enough to be a label gets a tool called at the wrong moment,
    // and 120 characters is about where "what it does" stops and "when to reach for it" starts.
    for (const tool of allTools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(120)
    }
  })

  it('describes every argument, since an undescribed field is a guessed field', () => {
    for (const tool of allTools) {
      for (const [key, node] of Object.entries(tool.inputSchema.properties)) {
        expect(node.description, `${tool.name}.${key}`).toBeTruthy()
      }
    }
  })

  it('marks exactly the four tools that may change data, reveal a value, or end the run', () => {
    expect([...trustedToolNames].sort()).toEqual([...TRUSTED_BY_DESIGN].sort())
  })

  it('warns the model that a reveal is expensive and refusable', () => {
    // The single most important sentence in the surface. A model that does not know refusal is normal
    // retries, and a retry loop turns a considered human decision into an attrition contest.
    const reveal = allTools.find((tool) => tool.name === 'request_reveal')
    expect(reveal).toBeDefined()
    expect(reveal?.description).toMatch(/refuse/i)
    expect(reveal?.description).toMatch(/logged|expensive/i)
  })

  it('accepts no pattern or regex argument anywhere', () => {
    // docs/privacy-guard.md § Predicate limits: a model-supplied regex extracts a phone number one digit
    // at a time through counts that are all individually above the suppression threshold. This test is
    // here because the field will be proposed again, by someone who has not read that section.
    for (const tool of allTools) {
      for (const key of Object.keys(tool.inputSchema.properties)) {
        expect(key.toLowerCase(), tool.name).not.toMatch(/pattern|regex/)
      }
    }
  })
})
