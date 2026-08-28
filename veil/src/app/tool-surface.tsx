'use client'

import { useEffect, useState } from 'react'

import { abandonAllGates } from '@/lib/webmcp/blocking'
import { registerTools, unregisterTools, type RegistrationResult } from '@/lib/webmcp/register-tools'

/**
 * Where Veil's tools get attached to the page.
 *
 * Owner: Vicko.
 *
 * One component, one job: register on mount, abort on unmount. It renders a small status line rather than
 * nothing, because "did the agent actually get the tools?" is the first question in every debugging session and
 * the answer should not require the console.
 *
 * This is the only client component in `app/`. Everything else that needs interactivity lives in
 * `components/`, so the boundary is easy to see from the file tree rather than by grepping for `'use client'`.
 */
export function ToolSurface() {
  const [result, setResult] = useState<RegistrationResult | null>(null)

  useEffect(() => {
    /*
     * Register here, abort in the cleanup. React 18 Strict Mode runs this effect twice in development, so
     * registration must be idempotent — the second pass has to abort the first controller, not add a second copy
     * of all 14 tools. An agent shown two `count_where` entries picks one arbitrarily, and the second copy holds
     * a stale closure over the previous dataset. `registerTools` aborts any previous controller before it starts,
     * which is what makes calling it twice safe; the cleanup below is the unmount case rather than the guard.
     */
    setResult(registerTools())

    return () => {
      unregisterTools()
      /*
       * And close the gates. A `request_reveal` still waiting on a person when the surface goes away would
       * otherwise hang until its own timeout, holding a suspended tool call against a page that no longer has
       * the tools. Each gate resolves with its own fail-closed default, so the agent is told no rather than
       * left waiting — see `blocking.ts`.
       */
      abandonAllGates()
    }
  }, [])

  if (!result) return null

  /*
   * When there is no tool surface, this line is the whole product's failure message, so it says what to do
   * rather than what is missing. "WebMCP not supported" reads to a judge on the wrong browser as a broken
   * entry; the console route is a real way to drive all 14 tools by hand, and `window.veilTools` is installed
   * whether or not registration succeeded, precisely so this sentence is true when it is shown.
   *
   * The version numbers are load-bearing rather than decorative, and they must keep agreeing with
   * CONTRIBUTING.md and `src/types/webmcp.d.ts`: Chrome 149+, Edge 150+. A number that is too low here sends
   * someone to upgrade a browser that was already new enough, and then to conclude the app is broken.
   */
  if (result.mode === 'unavailable') {
    return (
      <p className="text-2xs text-muted font-mono" role="status" aria-live="polite">
        no tool surface · open Veil in Chrome 149+ or Edge 150+ with the WebMCP origin trial enabled, or
        drive the tools by hand from the devtools console: <code>window.veilTools.list()</code>, then{' '}
        <code>window.veilTools.call(&apos;describe_dataset&apos;)</code>
      </p>
    )
  }

  return (
    <p className="text-2xs text-muted font-mono" aria-live="polite">
      {result.mode} · {result.open.length + result.trusted.length} tools ·{' '}
      {result.trusted.length} require approval
    </p>
  )
}
