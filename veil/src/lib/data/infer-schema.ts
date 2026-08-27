import type { Column, Dataset, ValueType } from '@/types/domain'

/**
 * Decide what each column holds.
 *
 * Owner: Riko.
 *
 * A `ValueType` is coarser than a `NamedFormat` on purpose. The type answers "can I do arithmetic on this",
 * the format answers "what layout is it written in", and conflating them produces a column that is both
 * `date` and `text` depending on which row you looked at.
 */

/**
 * Infer a column's type from its values.
 *
 * TODO(riko), Day 1: implement. Sample rather than scanning everything — the first 500 non-empty values are
 * enough to type a column, and typing is called for every column on load, so a full scan is 50k × columns
 * before the page has rendered anything.
 *
 * TODO(riko), Day 1: `mixed` is a real answer and the most useful one in a messy file. Return it when no
 * single type covers 95% of sampled values, rather than picking the plurality — a column typed `integer`
 * because 60% of it parses will silently exclude the other 40% from every numeric predicate, and the agent
 * will read a real number that is wrong.
 *
 * TODO(riko), Day 1: `empty` for a column that is entirely blank. `find_issues` reports it as
 * `entirelyEmptyColumn`, which is one of the few findings where the right transform is `dropColumn`.
 */
export function inferColumnType(_values: readonly string[]): ValueType {
  throw new Error('inferColumnType: not implemented')
}

/**
 * Build the `Column[]` for a parsed file.
 *
 * TODO(riko), Day 1: implement. `index` is the position in the row array and is what every accessor uses;
 * `id` is the header text and is what the model sees. Keeping them separate is what allows a header to be
 * renamed for de-duplication without moving any data.
 */
export function inferSchema(
  _headers: readonly string[],
  _rows: readonly (readonly string[])[],
): readonly Column[] {
  throw new Error('inferSchema: not implemented')
}

/**
 * Columns whose every value is distinct.
 *
 * Reported as `distinctCount: 'unique'` rather than a number, because the number would be `rowCount` — which
 * the agent already knows — while the word is the fact it needs: a column of unique values is an identifier,
 * and an identifier is a column to normalise rather than analyse.
 *
 * TODO(riko), Day 2: implement.
 *
 * TODO(riko), Day 2: a unique column is also the highest re-identification risk in the file, since any
 * crosstab against it produces cells of one. `crosstab` refuses wide columns already, but `find_issues`
 * should surface uniqueness to the human explicitly — they are the one who knows whether `email` being
 * unique is expected or a sign the file has one row per person.
 */
export function uniqueColumns(_dataset: Dataset): readonly string[] {
  throw new Error('uniqueColumns: not implemented')
}
