import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

/**
 * Owner: Faiq.
 *
 * The shell. Deliberately thin: no providers, no theme context, no analytics. The store is a zustand hook and
 * needs no provider, and there is nothing to send anywhere — `connect-src 'self'` in `next.config.mjs` would
 * block it, which is the point rather than an inconvenience.
 */

export const metadata: Metadata = {
  title: 'Veil — clean a spreadsheet with an agent that cannot read it',
  description:
    'Veil loads a CSV in your browser and lets an AI agent profile, diagnose and clean it through a privacy ' +
    'guard. The agent sees shapes, counts and patterns; it never sees a cell unless you decide, one cell at a ' +
    'time, that it may. Nothing is uploaded.',
  applicationName: 'Veil',
  robots: { index: true, follow: true },
  /*
   * TODO(faiq), Day 6: add `openGraph` with a real image before the submission goes out. The Devpost gallery
   * and every link shared in a Discord renders this, and the default — a bare URL with no card — reads as an
   * unfinished side project next to entries that spent ten minutes on it.
   */
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/*
        `h-dvh` rather than `h-screen`: on mobile Safari `100vh` is taller than the visible viewport, which puts
        the reveal dialog's buttons underneath the browser chrome — on the one screen where the human has to be
        able to reach Refuse.
      */}
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  )
}
