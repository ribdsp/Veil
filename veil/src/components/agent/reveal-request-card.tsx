'use client'

import { Button } from '@/components/ui/button'

/**
 * The reveal request. The most consequential 200 pixels in the product.
 *
 * Owner: Faiq. Read `docs/threat-model.md` (T8, habituation) before changing anything here.
 *
 * The agent has asked to see one cell and written a sentence saying why. The human is not really judging a row
 * and a column — they are judging whether that sentence is a real reason. So the reason gets the most space, in
 * the agent's own words, unedited and un-summarised.
 *
 * TODO(faiq), Day 4: implement as a modal with a focus trap, `role="dialog"` and `aria-modal`. It blocks the
 * agent, so it should block the page: a request the human can scroll away from is a request that times out, and
 * a timeout is a refusal nobody made a decision about.
 *
 * TODO(faiq), Day 4: Approve and Refuse get identical weight — see `ui/button.tsx`. Neither is `autoFocus`, and
 * neither is bound to Enter. A human who has approved four of these in a row is holding the keyboard, and the
 * fifth one should cost them a deliberate movement. Escape refuses; it must never approve.
 *
 * TODO(faiq), Day 4: show `column` and `row`, and the count of reveals already granted this session, next to the
 * buttons. "This is the 6th cell you have uncovered" is the only thing in the interface that can interrupt a
 * habit, and by the 6th one the header count has stopped being read.
 *
 * TODO(faiq), Day 5: the Refuse path needs a reason field with two or three one-click options ("you don't need a
 * value to fix a format", "ask me a question instead"). The reason goes back to the agent, and an agent told why
 * looks for a structural route instead of asking again in a slightly different shape — which is the difference
 * between a control and an obstacle.
 *
 * TODO(faiq), Day 5: do not preview the value anywhere on this card, including on hover. A human cannot consent
 * to seeing something they have already seen.
 */
export function RevealRequestCard() {
  /*
   * TODO(faiq), Day 4: read `pendingReveal` from the store and return null when it is absent. Rendering nothing
   * is correct for most of a session.
   */
  const pending = null as { request: { column: string; row: number; reason: string } } | null
  if (!pending) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reveal-title"
      className="fixed inset-0 grid place-items-center bg-ink/20 p-4"
    >
      <div className="w-full max-w-md rounded-sm border border-edge bg-raised p-4 shadow-lg">
        <h2 id="reveal-title" className="text-sm font-medium">
          The agent is asking to see one value
        </h2>
        <p className="mt-1 font-mono text-2xs text-muted">
          {pending.request.column} · row {pending.request.row}
        </p>
        <blockquote className="mt-3 border-l-2 border-agent pl-3 text-sm text-ink">
          {pending.request.reason}
        </blockquote>
        <div className="mt-4 flex gap-2">
          <Button intent="refuse">Refuse</Button>
          <Button intent="approve">Show this one value</Button>
        </div>
      </div>
    </div>
  )
}
