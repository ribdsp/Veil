import type { ColumnProfile } from '@/types/domain'

/**
 * A column header in the agent's pane: the name, and everything the agent has been told about it.
 *
 * Owner: Faiq.
 *
 * TODO(faiq), Day 4: implement. Name, inferred type, fill rate, distinct count, and the top pattern buckets as
 * a tiny stacked bar. This is the payload of the whole product — the agent's entire understanding of a column
 * fits in about 120 pixels, and showing it here is what makes "it can work without reading anything" credible
 * rather than asserted.
 *
 * TODO(faiq), Day 4: render a suppressed bucket as a hatched segment labelled `<k`, not as a gap. A gap makes
 * the bar not sum to the row count and the human reads it as a rendering bug; a hatched segment says "there is
 * something here and it was too small to describe", which is the truth and the more interesting fact.
 *
 * TODO(faiq), Day 5: never render `profile.exemplars` here. They are masked, so it is tempting — but masked
 * exemplars beside a real column of values in the neighbouring pane is a puzzle with about four pieces, and the
 * human solves it accidentally. They belong in the tool response only, where the agent is the audience.
 */
export function ColumnHeader({
  column,
  profile,
}: {
  column: string
  profile: ColumnProfile | undefined
}) {
  return (
    <th
      scope="col"
      className="border-b border-line px-[--cell-padding-x] py-1 text-left align-bottom font-normal"
    >
      <span className="block truncate font-mono text-2xs text-ink">{column}</span>
      <span className="block text-2xs text-faint">{profile ? profile.type : 'not asked about'}</span>
    </th>
  )
}
