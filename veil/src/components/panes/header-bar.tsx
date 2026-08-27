import type { ReactNode } from 'react'

import { BudgetMeter } from '@/components/ui/budget-meter'
import { ExportButton } from '@/components/journal/export-button'

/**
 * The bar across the top: what is loaded, what it has cost, and the two numbers that matter.
 *
 * Owner: Faiq.
 *
 * TODO(faiq), Day 3: implement. Left: file name and row count. Middle: the k control and the budget meter.
 * Right: reveals granted, then the export button.
 *
 * TODO(faiq), Day 3: the reveals-granted count is the one element in the app allowed to use `revealed` red, and
 * it must be visible without looking for it. It is a running total of irreversible decisions, and the whole
 * mechanism depends on a human being able to notice they have approved eleven of them.
 *
 * TODO(faiq), Day 4: the k control raises k only. Render it as a stepper whose decrement is disabled with a
 * title explaining why, rather than hiding it — a human who cannot find the control assumes k is fixed at 5 and
 * never raises it either. `raiseMinGroupSize` in the store rejects a decrease regardless of what this renders.
 */
export function HeaderBar({ children }: { children?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-panel px-4 py-2">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-sm tracking-tight">veil</span>
        {children}
      </div>
      <div className="flex items-center gap-4">
        <BudgetMeter />
        <ExportButton />
      </div>
    </header>
  )
}
