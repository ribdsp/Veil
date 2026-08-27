import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Nothing from the model is ever executed.
 *
 * Owner: Riko. **This test is a security boundary, not a lint rule.** CONTRIBUTING.md rule 2.
 *
 * Transforms, predicates and formats arrive from a model as data and stay data: a closed enum matched by a
 * `switch`, never a string handed to an interpreter. This test greps the whole of `src/` and fails the
 * build if `eval(`, `new Function`, or a `RegExp` built from a variable appears anywhere.
 *
 * The `RegExp` case is the one people find surprising, so it is worth stating plainly. It is not about
 * injection into our own process. A model-supplied pattern is a high-bandwidth read of the data through
 * answers that are all individually legal:
 *
 *   count_where(phone matches ^0812(\d))    → 91
 *   count_where(phone matches ^08121(\d))   → 12
 *   count_where(phone matches ^081213(\d))  →  8
 *
 * Every answer is above the suppression threshold. Continue until suppression stops you and you have most
 * of a phone number, with no reveal requested and no rule broken. It is also a denial of service —
 * catastrophic backtracking hangs the tab that holds the user's only copy of their data.
 *
 * A literal `RegExp` written by us is fine and is used throughout `lib/data/patterns.ts`. The line is
 * whether the pattern came from outside.
 */

const SRC = join(process.cwd(), 'src')

const FORBIDDEN = [
  { pattern: /\beval\s*\(/, what: 'eval()' },
  { pattern: /new\s+Function\s*\(/, what: 'new Function()' },
  { pattern: /\bsetTimeout\s*\(\s*['"`]/, what: 'setTimeout with a string body' },
  // `new RegExp(someVariable)` — a literal argument is fine, a variable is not.
  { pattern: /new\s+RegExp\s*\(\s*(?!['"`/])/, what: 'new RegExp() from a non-literal' },
]

function allSources(dir: string): { path: string; source: string }[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return allSources(path)
    if (!/\.(ts|tsx)$/.test(entry)) return []
    return [{ path, source: readFileSync(path, 'utf8') }]
  })
}

/** These files discuss the forbidden constructs in prose; a checker that cannot tell a warning from a
 * violation trains people to delete the warnings. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('no dynamic code execution anywhere in src/', () => {
  const sources = allSources(SRC)

  it('finds source files to check', () => {
    expect(sources.length).toBeGreaterThan(20)
  })

  for (const { pattern, what } of FORBIDDEN) {
    it(`contains no ${what}`, () => {
      const offenders = sources
        .filter(({ path, source }) => !path.endsWith('no-eval.test.ts') && pattern.test(stripComments(source)))
        .map(({ path }) => path.slice(SRC.length + 1))

      expect(offenders, `${what} found in: ${offenders.join(', ')}`).toEqual([])
    })
  }
})
