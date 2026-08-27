/**
 * Two headers, for two different reasons.
 *
 * ## 1. The Origin Trial token
 *
 * It has to arrive as an HTTP header, not a `<meta>` tag. A meta tag only enables the trial for the
 * document itself; a header enables it for the document *and* its sub-resources. Veil registers its
 * tools from a client component that Next.js serves as a separate chunk, so the meta-tag route
 * silently gives you a page where `document.modelContext` exists in the console but not in your own
 * module. That failure looks like a bug in your code for about an hour before you find it.
 *
 * The token is bound to an origin, so localhost and production need different ones. Put yours in
 * `.env.local` (see `.env.example`). With no token set, no header is sent and the polyfill in
 * `src/lib/webmcp/polyfill.ts` takes over.
 *
 * ## 2. `connect-src 'self'` — the promise, enforced by the browser
 *
 * Veil's claim is that your spreadsheet never leaves your machine. Everything in `src/` is written to
 * honour that, but "we were careful" is not a guarantee: one `fetch` added in a hurry, one analytics
 * snippet, one dependency that phones home, and the claim is quietly false with nothing in the UI to
 * show it. A Content-Security-Policy moves the guarantee out of our discipline and into the browser,
 * where a violation is a blocked request and a console error rather than a silent upload.
 *
 * `connect-src 'self'` is the load-bearing directive: XHR, `fetch`, WebSocket, `sendBeacon` and
 * EventSource can only address this origin. Since this origin serves no endpoint that accepts a
 * dataset — Veil has no API routes at all — there is nowhere for the data to go.
 *
 * `script-src` is deliberately *not* locked down to the same degree, and that is a real limitation
 * rather than an oversight: Next.js bootstraps hydration with an inline script, which needs either
 * `'unsafe-inline'` or a per-request nonce, and nonces require middleware. See
 * `docs/threat-model.md` (T7) for what this does and does not buy.
 *
 * TODO(vicko), Day 5: add `middleware.ts` issuing a per-response nonce, then drop `'unsafe-inline'`
 * from `script-src`. Verify with the CSP evaluator in DevTools that no directive falls back to `*`.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,

  async headers() {
    const headers = []

    const token = process.env.NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN
    if (token) {
      headers.push({ key: 'Origin-Trial', value: token })
    }

    headers.push({
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        // The whole point. Nothing may be sent anywhere but back here, and here accepts nothing.
        "connect-src 'self'",
        // Next.js needs both until the nonce middleware above lands. `'unsafe-eval'` is dev-only —
        // it is what the fast-refresh runtime uses — so production gets the tighter of the two.
        process.env.NODE_ENV === 'development'
          ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
          : "script-src 'self' 'unsafe-inline'",
        // Tailwind's generated stylesheet is a file, but Next inlines critical CSS.
        "style-src 'self' 'unsafe-inline'",
        // Self-hosted only. A webfont from a CDN is a third party learning who opened the app.
        "font-src 'self'",
        "img-src 'self' data: blob:",
        // No embedding, and nothing embedded.
        "frame-ancestors 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        // Neither exists, but saying so costs nothing and closes a form-based exfiltration route.
        "form-action 'none'",
      ].join('; '),
    })

    return [{ source: '/:path*', headers }]
  },
}

export default nextConfig
