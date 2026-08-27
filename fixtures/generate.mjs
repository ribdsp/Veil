/* eslint-disable no-console */
/**
 * Generate a synthetic dataset that is messy in the ways real ones are.
 *
 * Owner: Vicko.
 *
 * Run: `node fixtures/generate.mjs --rows 5000 --messy 0.25 > veil/public/samples/customers.csv`
 *
 * Every CSV in this repository comes from here. Not because a real file would be more convincing — it would —
 * but because there is no version of "I removed the sensitive columns first" that survives a week of commits,
 * and a dataset in git is in git forever. `.gitignore` blocks `*.csv` outside `veil/public/samples/` to make
 * the accident harder than the correct path.
 *
 * The names below are constructed from syllables rather than drawn from a name list on purpose: a plausible
 * generated name cannot accidentally be a real person's, and a name list scraped from somewhere is exactly the
 * kind of file this project should not ship.
 */

const SYLLABLES_A = ['an', 'bu', 'ci', 'de', 'fa', 'gi', 'ha', 'in', 'ju', 'ka', 'lo', 'mu', 'na', 'pu', 'ri', 'su', 'ta', 'wi', 'ya', 'zu']
const SYLLABLES_B = ['di', 'nto', 'wan', 'sih', 'yan', 'mad', 'ndra', 'lia', 'rah', 'nto', 'wati', 'man', 'nur', 'gus', 'tri']
const CITIES = ['Mataram', 'Bandung', 'Surabaya', 'Medan', 'Makassar', 'Semarang', 'Denpasar', 'Padang', 'Pontianak', 'Manado']

/** Deterministic PRNG. A fixture that changes every run makes every diff a whole-file diff. */
function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function parseArgs(argv) {
  const args = { rows: 5000, messy: 0.2, seed: 20260827 }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    const value = Number(argv[i + 1])
    if (key && Number.isFinite(value) && key in args) args[key] = value
  }
  if (args.messy < 0 || args.messy > 1) throw new Error('--messy must be between 0 and 1')
  return args
}

function name(random) {
  const first = SYLLABLES_A[Math.floor(random() * SYLLABLES_A.length)] + SYLLABLES_B[Math.floor(random() * SYLLABLES_B.length)]
  const last = SYLLABLES_A[Math.floor(random() * SYLLABLES_A.length)] + SYLLABLES_B[Math.floor(random() * SYLLABLES_B.length)]
  const cap = (word) => word[0].toUpperCase() + word.slice(1)
  return `${cap(first)} ${cap(last)}`
}

/**
 * TODO(vicko), Day 2: implement the row generator. Eight columns: id, name, phone, email, city, joined, amount,
 * notes.
 *
 * TODO(vicko), Day 2: the mess must be the mess the tools are built to find, in these proportions:
 *   - phone: mix `081210000001`, `+6281210000001`, `0812-1000-0001` and `0812 1000 0001` in the *same* column.
 *     This is the demo's opening move — four formats, one meaning, and the agent fixes it without reading one.
 *   - joined: mix `27/08/2026`, `2026-08-27` and `27.08.2026`, and include a handful where the day is ≤ 12 so
 *     `ambiguousDateOrder` fires and `ask_human` has a reason to exist.
 *   - amount: mix `1234.56`, `1.234,56` and `1234`. The decimal-comma rows are the ones a naive `parseFloat`
 *     silently divides by a thousand.
 *   - email: a few missing, a few with trailing whitespace, a few with a capital domain.
 *   - name: leading and trailing spaces, double spaces, and ~2% near-duplicate pairs (`Ahmad`/`Ahmed`) so
 *     `find_duplicates` has something true to find.
 *   - notes: mostly empty. A 95%-empty column is what `mostlyEmpty` is for, and every real export has one.
 *
 * TODO(vicko), Day 3: make one city dominate at ~60% and leave two with fewer than 5 rows. Without a group under
 * k, no `crosstab` in the demo ever suppresses anything, and the single most convincing thing Veil does never
 * appears on screen.
 *
 * TODO(vicko), Day 3: quote any field containing a comma, and escape embedded quotes by doubling them. A
 * generator that emits broken CSV sends whoever is debugging a parse bug into `parse-csv.ts` for an hour.
 */
function generate(_options) {
  throw new Error('generate: not implemented')
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const random = makeRandom(options.seed)
  void name
  void CITIES
  void random
  process.stdout.write(generate(options))
}

main()
