import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The module boundary, enforced by reading the source.
 *
 * Owner: Riko. **This test is a security boundary, not a lint rule.** CONTRIBUTING.md rule 1.
 *
 * No tool may read a cell. TypeScript cannot express "this module may not import that symbol" — `private`
 * is per-class, and a module-private binding stops being private the moment somebody adds an `export`
 * because they needed it for one thing. So the check is a grep: crude, exact, and impossible to satisfy
 * accidentally.
 *
 * If this test fails on your branch, the fix is almost never to adjust the pattern. It is to ask the guard
 * a new *structured question* with its own suppression rule. A tool that needs a value has either found a
 * missing guard method or a missing reveal request.
 *
 * This is also why `vitest.config.ts` uses `environment: 'node'` — these tests read files.
 */

const TOOLS_DIR = join(process.cwd(), 'src', 'lib', 'webmcp', 'tools')

/**
 * Imports that would put raw data in a tool's hands.
 *
 * `lib/data` is where the cell accessor lives; a tool importing from it at all is the signal, whatever it
 * claims to want. `useDatasetStore` is the other route in — the store holds the parsed rows, and reaching
 * them through React state is the same read with more steps.
 */
const FORBIDDEN_IMPORTS = [
  /from\s+['"]@\/lib\/data/,
  /from\s+['"]\.\.\/\.\.\/data/,
  /from\s+['"]@\/lib\/store\/dataset/,
  /require\(\s*['"].*lib\/data/,
]

/**
 * Accessor shapes that mean "a value is being read".
 *
 * Deliberately includes the shapes a well-meaning refactor produces. `rows[` is the raw array; `.cellAt(`
 * and `rawValueAt(` are the accessor names; `dataset.rows` is the store field.
 */
const FORBIDDEN_ACCESS = [
  /\brows\s*\[/,
  /\bcellAt\s*\(/,
  /\brawValueAt\s*\(/,
  /\bdataset\s*\.\s*rows\b/,
]

function toolSources(): { name: string; source: string }[] {
  return readdirSync(TOOLS_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => ({ name: file, source: readFileSync(join(TOOLS_DIR, file), 'utf8') }))
}

/**
 * Strip comments before matching.
 *
 * Necessary and slightly awkward: these files are heavily commented, and several comments discuss `rows[`
 * and `lib/data` precisely because that is what they are forbidding. A checker that cannot tell a warning
 * from a violation trains people to delete the warnings.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('tools cannot reach past the guard', () => {
  it('finds tool files to check', () => {
    // Guards the guard: a renamed directory would otherwise make every case below vacuously pass, and a
    // silently-empty security test is worse than a missing one.
    expect(toolSources().length).toBeGreaterThanOrEqual(14)
  })

  it('imports no raw data module', () => {
    for (const { name, source } of toolSources()) {
      const code = stripComments(source)
      for (const pattern of FORBIDDEN_IMPORTS) {
        expect(code, `${name} imports raw data (${pattern})`).not.toMatch(pattern)
      }
    }
  })

  it('reads no cell directly', () => {
    for (const { name, source } of toolSources()) {
      const code = stripComments(source)
      for (const pattern of FORBIDDEN_ACCESS) {
        expect(code, `${name} accesses a cell (${pattern})`).not.toMatch(pattern)
      }
    }
  })

  it('leaves the raw accessor unexported from lib/data', () => {
    // The other half of the boundary. The grep above stops a tool importing the accessor; this stops the
    // accessor becoming importable in the first place, which is the change that would make the grep
    // technically pass while the boundary is gone.
    const dataDir = join(process.cwd(), 'src', 'lib', 'data')
    const sources = readdirSync(dataDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => ({ name: file, source: stripComments(readFileSync(join(dataDir, file), 'utf8')) }))

    for (const { name, source } of sources) {
      expect(source, `${name} exports a raw cell accessor`).not.toMatch(
        /export\s+(function|const)\s+(cellAt|rawValueAt|readCell)\b/,
      )
    }
  })
})
