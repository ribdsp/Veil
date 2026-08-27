/**
 * What the agent has been asking, as it happens.
 *
 * Owner: Faiq.
 *
 * The journal below is the permanent record; this is the live feed. Separate components because they answer
 * different questions — "what is it doing right now" and "what did it do" — and merging them produces a list
 * that is either too noisy to audit or too slow to watch.
 *
 * TODO(faiq), Day 3: implement from the `toolCalled` entries. One line each: tool name, the column it asked
 * about, and whether the answer was given or suppressed. Newest at the bottom, following the chat convention
 * people already have for watching an agent work.
 *
 * TODO(faiq), Day 3: render a suppression in `suppressed` amber with its reason inline. This is the moment the
 * product works — the agent asked something legitimate and got a real answer that describes nobody — and it is
 * over in 200ms unless the interface holds onto it. Half the demo is pointing at these lines.
 *
 * TODO(faiq), Day 5: do not auto-scroll if the human has scrolled up. They are reading something, and yanking
 * the viewport to the bottom on the next tool call — which is 300ms away — makes the pane unreadable during
 * exactly the burst of activity worth reading.
 */
export function ToolLog() {
  return (
    <div className="min-h-0 flex-1 overflow-auto border-b border-line p-3">
      <h2 className="text-2xs font-medium uppercase tracking-wide text-faint">Asking</h2>
      <p className="mt-2 text-xs text-muted">{/* TODO(faiq), Day 3 */}Nothing yet.</p>
    </div>
  )
}
