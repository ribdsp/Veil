import type { ButtonHTMLAttributes } from 'react'

/**
 * The only button.
 *
 * Owner: Faiq.
 *
 * Three intents, and they are not interchangeable. `neutral` for everything ordinary. `approve` and `refuse`
 * exist only on the two gate cards, and they are the reason this component is not just a Tailwind class string
 * copied around: the pair has to look symmetrical.
 *
 * A UI where Approve is a filled primary button and Refuse is a grey link has already made the decision for the
 * human — and it has made the *irreversible* one the default. Both get the same weight, the same size, and the
 * same distance from the pointer. Neither is `autoFocus`.
 */
type Intent = 'neutral' | 'approve' | 'refuse'

const INTENT_CLASS: Record<Intent, string> = {
  neutral: 'border-edge bg-raised text-ink hover:bg-base',
  approve: 'border-human/50 bg-raised text-human hover:bg-human/10',
  refuse: 'border-revealed/50 bg-raised text-revealed hover:bg-revealed/10',
}

export function Button({
  intent = 'neutral',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { intent?: Intent }) {
  return (
    <button
      type="button"
      className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${INTENT_CLASS[intent]} ${className}`}
      {...props}
    />
  )
}
