'use client'

import { Button } from '@/components/ui/button'

/**
 * A question from the agent, with closed options.
 *
 * Owner: Faiq.
 *
 * The cheap gate, and the one that should get used far more often than the expensive one. "Is `01/02/2026` the
 * first of February or the second of January?" is a question a human answers in a second, and it is the question
 * an unguarded agent would have answered by reading forty rows.
 *
 * TODO(faiq), Day 4: implement. Options render as a vertical list of equal-weight buttons — no primary, no
 * default. The tool guarantees 2–4 of them, and the last one is always the change-nothing option because a
 * timeout selects it.
 *
 * TODO(faiq), Day 4: show the timeout as remaining seconds, not a progress bar. The human should know a decision
 * is pending and roughly how long they have; a bar that empties creates pressure to click something, and the
 * something people click under pressure is the first option.
 *
 * TODO(faiq), Day 5: no free-text field, ever. Free text goes back into the agent's context unfiltered, and the
 * fastest way to answer "which date format?" is to paste in a row of the file. The human would be exfiltrating
 * their own data through the privacy control, helpfully, in one keystroke.
 */
export function QuestionCard() {
  /* TODO(faiq), Day 4: read `pendingQuestion` from the store. */
  const pending = null as { question: { question: string; options: readonly string[] } } | null
  if (!pending) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="question-title"
      className="fixed inset-0 grid place-items-center bg-ink/20 p-4"
    >
      <div className="w-full max-w-md rounded-sm border border-edge bg-raised p-4 shadow-lg">
        <h2 id="question-title" className="text-sm font-medium">
          {pending.question.question}
        </h2>
        <div className="mt-3 flex flex-col gap-2">
          {pending.question.options.map((option) => (
            <Button key={option} className="text-left">
              {option}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
