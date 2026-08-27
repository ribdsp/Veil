'use client'

import { useEffect, useState } from 'react'

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
     * TODO(vicko), Day 3: register here and abort in the cleanup. React 18 Strict Mode runs this effect twice
     * in development, so registration must be idempotent — the second pass has to abort the first controller,
     * not add a second copy of all 14 tools. An agent shown two `count_where` entries picks one arbitrarily,
     * and the second copy holds a stale closure over the previous dataset.
     */
    setResult(registerTools())
    return () => unregisterTools()
  }, [])

  if (!result) return null

  /*
   * TODO(vicko), Day 4: when `mode === 'unavailable'`, this line is the whole product's failure message. Say
   * what to do — "open in Chrome 141+ with the WebMCP origin trial, or run `window.veilTools.list()` in the
   * console to drive the tools by hand" — not "WebMCP not supported". A judge on the wrong browser reads that
   * and marks the entry as broken.
   */
  return (
    <p className="text-2xs text-muted font-mono" aria-live="polite">
      {result.mode} · {result.open.length + result.trusted.length} tools ·{' '}
      {result.trusted.length} require approval
    </p>
  )
}
