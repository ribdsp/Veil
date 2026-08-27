import { QuestionCard } from '@/components/agent/question-card'
import { RevealRequestCard } from '@/components/agent/reveal-request-card'
import { ToolLog } from '@/components/agent/tool-log'
import { AgentView } from '@/components/data/agent-view'
import { DataTable } from '@/components/data/data-table'
import { FileDrop } from '@/components/data/file-drop'
import { JournalList } from '@/components/journal/journal-list'
import { HeaderBar } from '@/components/panes/header-bar'
import { ThreePane } from '@/components/panes/three-pane'

import { ToolSurface } from './tool-surface'

/**
 * The only page.
 *
 * Owner: Faiq.
 *
 * The layout is the argument. Two panes show the same table twice — the human's copy on the left with values in
 * it, the agent's copy on the right with a hatch over every cell — and the third holds the journal. Nobody has
 * to be told what the product does after seeing that once, which is the entire reason the demo can be under
 * three minutes.
 *
 * TODO(faiq), Day 3: build the real composition. The two table panes must scroll in lockstep, because the
 * comparison only lands if row 4,182 is at the same height in both. A shared scroll offset in local state here
 * is fine; do not put it in the store, where every scroll event would re-render the journal.
 *
 * TODO(faiq), Day 6: on a narrow screen this becomes tabs, not a stack. Stacked, the agent's pane is below the
 * fold and the product looks like an ordinary CSV viewer until you scroll — and on a phone, nobody scrolls.
 */
export default function Page() {
  return (
    <main className="flex h-full flex-col">
      <HeaderBar>
        <ToolSurface />
      </HeaderBar>

      <FileDrop>
        <ThreePane
          human={<DataTable />}
          agent={<AgentView />}
          record={
            <div className="flex h-full flex-col">
              <ToolLog />
              <JournalList />
            </div>
          }
        />
      </FileDrop>

      {/*
        Both gates render at the root rather than inside the pane that created them: a reveal request that
        appears inside a scrolled-away region is a request the human never answers, and an unanswered gate
        blocks the agent until it times out.
      */}
      <RevealRequestCard />
      <QuestionCard />
    </main>
  )
}
