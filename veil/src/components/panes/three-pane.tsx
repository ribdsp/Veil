import type { ReactNode } from 'react'

/**
 * The three-pane frame: the human's table, the agent's hatched view of the same table, and the record.
 *
 * Owner: Faiq.
 *
 * TODO(faiq), Day 3: implement with a CSS grid — `grid-cols-[1fr_1fr_360px]` — not flex. The two table panes
 * must be exactly equal width for the side-by-side comparison to read as the same table twice; with flex they
 * size to content and drift apart by a few pixels per column, which reads as two different tables.
 *
 * TODO(faiq), Day 6: make the record pane collapsible, and make the two table panes resizable against each
 * other. During the demo the journal is the thing being pointed at, and 360px of it is not enough to show a
 * refusal and its reason on one line.
 */
export function ThreePane({
  human,
  agent,
  record,
}: {
  human: ReactNode
  agent: ReactNode
  record: ReactNode
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_360px] divide-x divide-line">
      <section aria-label="Your data" className="min-w-0 overflow-hidden bg-raised">
        {human}
      </section>
      <section aria-label="What the agent can see" className="min-w-0 overflow-hidden bg-panel">
        {agent}
      </section>
      <aside aria-label="Session record" className="min-w-0 overflow-hidden bg-panel">
        {record}
      </aside>
    </div>
  )
}
