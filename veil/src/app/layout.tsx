import type { Metadata } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import type { ReactNode } from 'react'

import './globals.css'

/**
 * Owner: Faiq.
 *
 * The shell. Deliberately thin: no providers, no theme context, no analytics. The store is a zustand hook and
 * needs no provider, and there is nothing to send anywhere — `connect-src 'self'` in `next.config.mjs` would
 * block it, which is the point rather than an inconvenience.
 */

/*
 * The type pair, self-hosted — and self-hosted is not a preference here. `font-src 'self'` in
 * `next.config.mjs` blocks a webfont CDN outright, because a font request to a third party is that third
 * party learning who opened the app. `next/font/google` downloads at build time and serves from this
 * origin, so there is no runtime request to anywhere. A `<link>` to fonts.googleapis.com would be a CSP
 * violation and a blank page's worth of unstyled text.
 *
 * Three weights of text and two of mono, and no more: every weight is another file the browser fetches,
 * and an interface this dense has nowhere to put a fourth. 400 for body, 500 for column headers and
 * labels, 600 for the numbers in the header bar that have to be findable without looking for them.
 */
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

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
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      {/*
        `h-dvh` rather than `h-screen`: on mobile Safari `100vh` is taller than the visible viewport, which puts
        the reveal dialog's buttons underneath the browser chrome — on the one screen where the human has to be
        able to reach Refuse.
      */}
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  )
}
