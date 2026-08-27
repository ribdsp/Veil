import type { Column, Dataset, ValueType } from '@/types/domain'

import { classify } from './patterns'

/**
 * Decide what each column holds.
 *
 * Owner: Riko.
 *
 * A `ValueType` is coarser than a `NamedFormat` on purpose. The type answers "can I do arithmetic on this",
 * the format answers "what layout is it written in", and conflating them produces a column that is both
 * `date` and `text` depending on which row you looked at.
 */

/** Non-empty values per column that settle its type. The 501st never changed an answer. */
const SAMPLE_SIZE = 500

/** How much of a column one type has to cover to be *the* type rather than the plurality. */
const AGREEMENT = 0.95

/**
 * Words a column of yes/no answers is written in, English and Indonesian.
 *
 * `0` and `1` are deliberately absent. A column of nothing but zeroes and ones is as likely to be a count,
 * a flag, or a quantity, and typing it `boolean` would refuse `compare` on a column where summing is the
 * obvious question. `integer` costs nothing here: nothing in Veil treats a boolean differently.
 */
const BOOLEAN_WORDS = new Set([
  'true',
  'false',
  'yes',
  'no',
  'y',
  'n',
  'ya',
  'tidak',
  'benar',
  'salah',
])

/** `NamedFormat` → `ValueType`. Everything not named here is `text`. */
const TYPE_OF_FORMAT: Readonly<Record<string, ValueType>> = {
  integerPlain: 'integer',
  decimalPoint: 'decimal',
  decimalComma: 'decimal',
  dateIso: 'date',
  dateDmySlash: 'date',
  dateMdySlash: 'date',
  dateDmyDot: 'date',
  dateTextualMonth: 'date',
  timestampIso: 'date',
  // Not numbers, on purpose. `digitsFixedLength` is the identifier bucket — account and ID numbers — and
  // typing it `integer` invites a numeric compare and, worse, `normaliseNumber`, which is the transform
  // that turns `007` into `7`. `currencyPrefixed` and `percentSuffixed` are text because `Rp 1.234,00`
  // does not parse as a number, and a column where every cell fails to parse answers every comparison
  // with a real, wrong zero.
  digitsFixedLength: 'text',
  currencyPrefixed: 'text',
  percentSuffixed: 'text',
}

/**
 * Infer a column's type from its values.
 *
 * Sampled rather than scanned: the first 500 non-empty values are enough to type a column, and typing runs
 * for every column on load, so a full scan is 50k × columns before the page has rendered anything.
 *
 * `mixed` is a real answer and the most useful one in a messy file. It is returned when no single type
 * covers 95% of the sample, rather than picking the plurality — a column typed `integer` because 60% of it
 * parses will silently exclude the other 40% from every numeric predicate, and the agent will read a real
 * number that is wrong.
 */
export function inferColumnType(values: readonly string[]): ValueType {
  const sample = values.filter((value) => value.trim() !== '').slice(0, SAMPLE_SIZE)

  // Entirely blank. `find_issues` reports it, and it is one of the few findings where the right transform
  // is `dropColumn`.
  if (sample.length === 0) return 'empty'

  if (sample.every((value) => BOOLEAN_WORDS.has(value.trim().toLowerCase()))) return 'boolean'

  const counts = new Map<ValueType, number>()
  for (const value of sample) {
    const type = TYPE_OF_FORMAT[classify(value)] ?? 'text'
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }

  const threshold = sample.length * AGREEMENT

  for (const [type, count] of counts) {
    if (count >= threshold) return type
  }

  // Integers and decimals are the one pair worth reconciling: `1200` and `1200.50` in one column is a
  // decimal column, not a mixed one, and calling it `mixed` would refuse the arithmetic the agent needs.
  const integers = counts.get('integer') ?? 0
  const decimals = counts.get('decimal') ?? 0
  if (integers + decimals >= threshold) return decimals > 0 ? 'decimal' : 'integer'

  return 'mixed'
}

/**
 * Build the `Column[]` for a parsed file.
 *
 * `index` is the position in the row array and is what every accessor uses; `id` is the header text and is
 * what the model sees. Keeping them separate is what allows a header to be renamed for de-duplication
 * without moving any data.
 *
 * One pass over the rows, collecting a bounded sample per column, stopping as soon as every column has
 * enough. A column that never fills its sample is a mostly-empty column, and that is worth a full scan
 * once: the alternative is typing a column `empty` because its values start at row 3,000.
 */
export function inferSchema(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): readonly Column[] {
  const samples: string[][] = headers.map(() => [])

  for (const row of rows) {
    let complete = true
    for (let index = 0; index < headers.length; index += 1) {
      const bucket = samples[index]
      if (bucket === undefined) continue
      if (bucket.length >= SAMPLE_SIZE) continue
      const cell = row[index] ?? ''
      if (cell.trim() !== '') bucket.push(cell)
      if (bucket.length < SAMPLE_SIZE) complete = false
    }
    if (complete) break
  }

  return headers.map((header, index) => ({
    id: header,
    index,
    type: inferColumnType(samples[index] ?? []),
  }))
}

/**
 * Columns whose every value is distinct.
 *
 * Reported as `distinctCount: 'unique'` rather than a number, because the number would be `rowCount` — which
 * the agent already knows — while the word is the fact it needs: a column of unique values is an identifier,
 * and an identifier is a column to normalise rather than analyse.
 *
 * A unique column is also the highest re-identification risk in the file, since any crosstab against it
 * produces cells of one. `crosstab` refuses wide columns already, but `find_issues` surfaces uniqueness to
 * the human explicitly — they are the one who knows whether `email` being unique is expected or a sign the
 * file has one row per person.
 *
 * Exact rather than sampled, and that is a deliberate cost. A wrong "this column is unique" is a sentence
 * about somebody's file that is simply false, and it would be shown to the human as a risk. Proving
 * uniqueness needs every value in a set, so this holds one column's values at a time and drops them at the
 * first duplicate — which, for a column that is not unique, is usually within a few dozen rows.
 */
export function uniqueColumns(dataset: Dataset): readonly string[] {
  const unique: string[] = []

  for (const column of dataset.columns) {
    const seen = new Set<string>()
    let duplicated = false
    let filled = 0

    for (const row of dataset.rows) {
      const cell = row[column.index] ?? ''
      if (cell.trim() === '') continue
      filled += 1
      if (seen.has(cell)) {
        duplicated = true
        break
      }
      seen.add(cell)
    }

    // A column with one value in it is not an identifier, it is a column with one value in it.
    if (!duplicated && filled > 1) unique.push(column.id)
  }

  return unique
}
