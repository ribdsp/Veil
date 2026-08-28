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

/* -------------------------------------------------------------------------------------------------
 * Small deterministic helpers. Every one of them takes `random` rather than reaching for Math.random,
 * because the whole value of this generator is that the same seed produces the same bytes.
 * ---------------------------------------------------------------------------------------------- */

function pick(random, list) {
  return list[Math.floor(random() * list.length)]
}

/** Inclusive on both ends. */
function intBetween(random, lo, hi) {
  return lo + Math.floor(random() * (hi - lo + 1))
}

/** Index into `weights`, chosen proportionally. Weights need not sum to 1. */
function weightedIndex(random, weights) {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = random() * total
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
}

/** Fisher–Yates, in place, seeded. Used to scatter the rare cities instead of clustering them. */
function shuffle(random, array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const swap = array[i]
    array[i] = array[j]
    array[j] = swap
  }
  return array
}

const pad2 = (n) => String(n).padStart(2, '0')

/* -------------------------------------------------------------------------------------------------
 * CSV output
 * ---------------------------------------------------------------------------------------------- */

/**
 * Quote any field containing a comma, and escape embedded quotes by doubling them. A generator that
 * emits broken CSV sends whoever is debugging a parse bug into `parse-csv.ts` for an hour.
 *
 * Newlines get the same treatment, though nothing generated here contains one — the escaping is
 * correct regardless of what a future defect puts in a cell, and that is cheaper than remembering.
 *
 * Leading and trailing spaces are quoted too, which RFC 4180 does not require. They are *deliberate
 * defects* here: an over-eager parser that strips unquoted surrounding space would silently delete the
 * thing `leadingWhitespace` / `trailingWhitespace` are supposed to find, and the fixture would look
 * clean for reasons nothing in the repository explains.
 */
function csvField(value) {
  const s = String(value)
  const needsQuotes = s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r') || s !== s.trim()
  return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(fields) {
  return fields.map(csvField).join(',')
}

/* -------------------------------------------------------------------------------------------------
 * Field shapes
 *
 * The mess must be the mess the tools are built to find. Each formatter below produces one of the
 * layouts named in `NamedFormat` (`veil/src/types/domain.ts`), so a `profile_column` bucket has a real
 * name to report rather than falling into `unrecognised`.
 * ---------------------------------------------------------------------------------------------- */

const PHONE_PREFIXES = ['0811', '0812', '0813', '0817', '0818', '0821', '0851', '0895']

/** Twelve digits always, so the 4-4-4 grouped shapes are grouped the same way every time. */
function phoneDigits(random) {
  let digits = pick(random, PHONE_PREFIXES)
  for (let i = 0; i < 8; i += 1) digits += String(intBetween(random, 0, 9))
  return digits
}

/**
 * Four phone formats in one column — the demo's opening move. Four formats, one meaning, and the agent
 * normalises them without reading one of them.
 *
 * `phoneLocalId` is the clean shape; the other three are what `mixedFormat` exists to notice.
 */
function formatPhone(digits, style) {
  switch (style) {
    case 'e164':
      return `+62${digits.slice(1)}`
    case 'dashed':
      return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`
    case 'spaced':
      return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`
    case 'local':
    default:
      return digits
  }
}

const PHONE_DEFECT_STYLES = ['e164', 'dashed', 'spaced']

/**
 * Three date formats, some of them ambiguous. `01/02/2026` cannot be resolved by looking harder, only
 * by asking, which is the entire reason `ask_human` exists.
 *
 * The ambiguity is *deliberately reserved* rather than left to chance: rows carrying a date-format
 * defect either get a day of 1–12, where `27/08/2026` and `08/27/2026` are indistinguishable, or a day
 * of 13–28, which pins the layout down. Both sets have to be present for the demo to work — all
 * ambiguous and there is no evidence for any answer, none ambiguous and there is nothing to ask about.
 * Rows with an ISO date are left alone at a uniform 1–28: reserving their days too would produce a
 * `joined` column in which nobody ever signed up in the first half of a month.
 *
 * (`fixtures/README.md` calls the finding `ambiguousDateOrder`. No such member exists in the frozen
 * `IssueCode` union yet; the data shape is generated regardless. See the note in the PR.)
 */
function formatDate(date, style) {
  const dd = pad2(date.d)
  const mm = pad2(date.m)
  switch (style) {
    case 'dmySlash':
      return `${dd}/${mm}/${date.y}`
    case 'dmyDot':
      return `${dd}.${mm}.${date.y}`
    case 'iso':
    default:
      return `${date.y}-${mm}-${dd}`
  }
}

const DATE_DEFECT_STYLES = ['dmySlash', 'dmyDot']

/**
 * Days are capped at 28 so no month-length arithmetic is needed, and nothing lands after 2026-08 so
 * the generator does not quietly manufacture `futureDate` findings nobody asked for.
 *
 * `dayRange` is `'ambiguous'` (1–12), `'unambiguous'` (13–28) or `'any'` (1–28).
 */
function makeDate(random, dayRange) {
  const y = intBetween(random, 2023, 2026)
  const m = y === 2026 ? intBetween(random, 1, 8) : intBetween(random, 1, 12)
  const d = dayRange === 'ambiguous' ? intBetween(random, 1, 12) : dayRange === 'unambiguous' ? intBetween(random, 13, 28) : intBetween(random, 1, 28)
  return { y, m, d }
}

function groupThousands(whole, separator) {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, separator)
}

/**
 * `1.234,56` beside `1234.56` — the failure a naive `parseFloat` turns into a value 1,000× too small,
 * silently, in a column somebody is about to total up. `1234` with no decimals at all is the third
 * shape, and it is the one that makes "is this column decimal or integer?" a real question.
 */
function formatAmount(cents, style) {
  const whole = Math.floor(cents / 100)
  const frac = pad2(cents % 100)
  switch (style) {
    case 'decimalComma':
      return `${groupThousands(whole, '.')},${frac}`
    case 'integerPlain':
      return String(Math.round(cents / 100))
    case 'decimalPoint':
    default:
      return `${whole}.${frac}`
  }
}

const AMOUNT_DEFECT_STYLES = ['decimalComma', 'integerPlain']

/** RFC 2606 reserved domains only. A generator that emits a live domain is a generator that emails somebody. */
const EMAIL_DOMAINS = ['example.com', 'example.net', 'example.org', 'mail.example.com', 'post.example.net']

function emailFor(personName, domain) {
  const parts = personName
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z]/g, ''))
  return `${parts.join('.')}@${domain}`
}

const EMAIL_DEFECTS = ['missing', 'trailingSpace', 'capitalDomain']

const NAME_DEFECTS = ['leadingSpace', 'trailingSpace', 'doubleSpace']

/**
 * One edit apart, `Ahmad`/`Ahmed` style, so `find_duplicates` has something true to find rather than a
 * pair that only a synthetic-data detector would call similar. A substitution keeps the Levenshtein
 * distance at exactly 1, which is the case the similarity metric is least likely to get right by luck.
 */
const LETTER_SWAPS = { a: 'e', e: 'a', i: 'y', o: 'u', u: 'o', d: 't', t: 'd', k: 'c', s: 'z', y: 'i', n: 'm', m: 'n', r: 'l', l: 'r' }

function nearVariant(random, personName) {
  const candidates = []
  for (let i = 0; i < personName.length; i += 1) {
    if (LETTER_SWAPS[personName[i].toLowerCase()]) candidates.push(i)
  }
  if (candidates.length === 0) return personName
  const at = pick(random, candidates)
  const swapped = LETTER_SWAPS[personName[at].toLowerCase()]
  const cased = personName[at] === personName[at].toUpperCase() ? swapped.toUpperCase() : swapped
  return personName.slice(0, at) + cased + personName.slice(at + 1)
}

/**
 * A 95%-empty notes column, because every real export has one and because a mostly-empty column is the
 * thing a profile has to describe without describing the 5% that says something.
 *
 * Several of these carry commas and embedded quotes on purpose: they are the only exercise the CSV
 * quoting path gets, and an unquoted comma here is a bug that shows up eight columns to the right.
 *
 * (`fixtures/README.md` calls the finding `mostlyEmpty`; that code does not exist in `IssueCode`
 * either. Same note in the PR.)
 */
const NOTES = [
  'follow up next week',
  'duplicate of earlier signup, verify',
  'prefers WhatsApp, not email',
  'said "call after 5pm"',
  'address unclear',
  'paid by transfer, receipt pending',
  'VIP, do not discount',
  'wants invoice marked "urgent"',
  'moved cities, update on renewal',
  'no answer on the number given',
]

/* -------------------------------------------------------------------------------------------------
 * The city column
 * ---------------------------------------------------------------------------------------------- */

/**
 * One city dominates at ~60% and two are left with fewer than 5 rows. Without a group under k, no
 * `crosstab` in the demo ever suppresses anything, and the single most convincing thing Veil does never
 * appears on screen.
 *
 * The rare counts are assigned *exactly*, not drawn from a probability — a 0.001 weight that happens to
 * land on 6 rows this seed is precisely the silent failure that empties the demo, and nothing about the
 * output would look wrong. For the same reason the near-duplicate pass below refuses to touch a
 * rare-city row: copying one person's city onto their twin is otherwise free to eat the whole group.
 */
const DOMINANT_CITY = CITIES[0]
const ORDINARY_CITIES = CITIES.slice(1, 8)
const ORDINARY_CITY_WEIGHTS = [26, 20, 16, 13, 10, 9, 6]
const RARE_CITIES = [CITIES[8], CITIES[9]]
const RARE_CITY_ROWS = [3, 2]

function cityColumn(random, rows) {
  const rareCounts = RARE_CITY_ROWS.map(() => 0)
  let left = rows
  RARE_CITY_ROWS.forEach((want, i) => {
    rareCounts[i] = Math.min(want, left)
    left -= rareCounts[i]
  })
  const dominantCount = Math.min(left, Math.round(rows * 0.6))
  left -= dominantCount

  const weightTotal = ORDINARY_CITY_WEIGHTS.reduce((a, b) => a + b, 0)
  const ordinaryCounts = ORDINARY_CITY_WEIGHTS.map((w) => Math.floor((left * w) / weightTotal))
  let remainder = left - ordinaryCounts.reduce((a, b) => a + b, 0)
  for (let i = 0; remainder > 0; i = (i + 1) % ordinaryCounts.length) {
    ordinaryCounts[i] += 1
    remainder -= 1
  }

  const column = []
  for (let i = 0; i < dominantCount; i += 1) column.push(DOMINANT_CITY)
  ORDINARY_CITIES.forEach((city, i) => {
    for (let n = 0; n < ordinaryCounts[i]; n += 1) column.push(city)
  })
  RARE_CITIES.forEach((city, i) => {
    for (let n = 0; n < rareCounts[i]; n += 1) column.push(city)
  })
  return shuffle(random, column)
}

/* -------------------------------------------------------------------------------------------------
 * Rows
 * ---------------------------------------------------------------------------------------------- */

/**
 * Which defects a messy row carries.
 *
 * `--messy` is the share of rows with *at least one* defect, so a row is first decided messy or clean,
 * and a messy row then draws each category independently — real messy rows are messy in several ways at
 * once, and one-defect-per-row produces a file that looks generated. If every draw misses, one category
 * is forced, because otherwise `--messy 0.25` would quietly mean 0.22.
 *
 * Three properties are *not* governed by `--messy`, because they describe the shape of the file rather
 * than an error in a row: the 95%-empty notes column, the city skew, and the ~2% near-duplicate names.
 * Turning `--messy` down to 0 still leaves a dataset with a group under k and a pair to find, which is
 * what makes it useful as a floor rather than an empty file.
 */
const DEFECT_RATES = { phone: 0.45, date: 0.4, amount: 0.35, email: 0.25, personName: 0.3 }
const DEFECT_FALLBACK_WEIGHTS = [28, 24, 20, 14, 14]
const DEFECT_KEYS = ['phone', 'date', 'amount', 'email', 'personName']

function chooseDefects(random, messy) {
  if (random() >= messy) return new Set()
  const chosen = new Set()
  for (const key of DEFECT_KEYS) {
    if (random() < DEFECT_RATES[key]) chosen.add(key)
  }
  if (chosen.size === 0) chosen.add(DEFECT_KEYS[weightedIndex(random, DEFECT_FALLBACK_WEIGHTS)])
  return chosen
}

/** Share of date-defect rows whose day is 1–12, i.e. whose layout genuinely cannot be inferred. */
const AMBIGUOUS_DAY_SHARE = 0.35

/** Share of rows that carry a note at all. The other 95% is the point. */
const NOTE_SHARE = 0.05

/** Share of rows that are one half of a near-duplicate pair. Half that many pairs. */
const NEAR_DUPLICATE_SHARE = 0.02

const COLUMNS = ['id', 'name', 'phone', 'email', 'city', 'joined', 'amount', 'notes']

/**
 * Returns the whole CSV as a string.
 *
 * Structured records are built first and formatted last, so the near-duplicate pass can copy one
 * person's details onto another row *before* either row is turned into text. That is what lets a pair
 * share a phone number while printing it in two different layouts — which is what a real export looks
 * like, and a harder case for `find_duplicates` than two identical strings.
 */
function generate(options) {
  const rows = Math.max(0, Math.floor(options.rows))
  const messy = options.messy
  const random = makeRandom(options.seed)

  const cities = cityColumn(random, rows)

  const records = []
  for (let i = 0; i < rows; i += 1) {
    const defects = chooseDefects(random, messy)
    const personName = name(random)
    const dayRange = !defects.has('date') ? 'any' : random() < AMBIGUOUS_DAY_SHARE ? 'ambiguous' : 'unambiguous'
    records.push({
      id: 1001 + i,
      personName,
      phone: phoneDigits(random),
      domain: pick(random, EMAIL_DOMAINS),
      city: cities[i],
      joined: makeDate(random, dayRange),
      cents: intBetween(random, 1500, 24999999),
      note: random() < NOTE_SHARE ? pick(random, NOTES) : '',
      defects,
    })
  }

  // Near-duplicate pairs. The twin keeps the base row's phone, city and date — the same person, entered
  // twice — and gets a name one edit away plus the email that name implies. Its own id, amount and note
  // stay, because a genuine double entry is never a byte-for-byte copy.
  //
  // Rows in a rare city are excluded from the pool in both roles. Copying a city across a pair moves a
  // row between groups, and there are only three rows in the smallest group to move.
  const rareCities = new Set(RARE_CITIES)
  const pool = shuffle(
    random,
    records.reduce((acc, record, i) => {
      if (!rareCities.has(record.city)) acc.push(i)
      return acc
    }, []),
  )
  const pairCount = Math.min(Math.floor((rows * NEAR_DUPLICATE_SHARE) / 2), Math.floor(pool.length / 2))
  for (let p = 0; p < pairCount; p += 1) {
    const base = records[pool[2 * p]]
    const twin = records[pool[2 * p + 1]]
    twin.personName = nearVariant(random, base.personName)
    twin.domain = base.domain
    twin.phone = base.phone
    twin.city = base.city
    twin.joined = base.joined
  }

  const lines = [csvRow(COLUMNS)]
  for (const record of records) {
    const { defects } = record

    let personName = record.personName
    if (defects.has('personName')) {
      switch (pick(random, NAME_DEFECTS)) {
        case 'leadingSpace':
          personName = ` ${personName}`
          break
        case 'trailingSpace':
          personName = `${personName} `
          break
        default:
          personName = personName.replace(' ', '  ')
      }
    }

    const phone = formatPhone(record.phone, defects.has('phone') ? pick(random, PHONE_DEFECT_STYLES) : 'local')
    const joined = formatDate(record.joined, defects.has('date') ? pick(random, DATE_DEFECT_STYLES) : 'iso')
    const amount = formatAmount(record.cents, defects.has('amount') ? pick(random, AMOUNT_DEFECT_STYLES) : 'decimalPoint')

    let email = emailFor(record.personName, record.domain)
    if (defects.has('email')) {
      switch (pick(random, EMAIL_DEFECTS)) {
        case 'missing':
          email = ''
          break
        case 'trailingSpace':
          email = `${email} `
          break
        default:
          email = emailFor(record.personName, record.domain.toUpperCase())
      }
    }

    lines.push(csvRow([record.id, personName, phone, email, record.city, joined, amount, record.note]))
  }

  return `${lines.join('\n')}\n`
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  process.stdout.write(generate(options))
}

main()
