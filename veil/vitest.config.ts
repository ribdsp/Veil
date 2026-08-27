import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    /**
     * `node`, not `jsdom` — the opposite of what a Next.js project usually wants.
     *
     * Everything under test in `src/lib/` is arithmetic over arrays of strings: k-anonymity
     * suppression, pattern bucketing, similarity scoring, budget accounting. None of it touches an
     * Element. Booting jsdom for it would add a second of startup to every run and, worse, would
     * invite tests that reach for the DOM as a convenient scratchpad, which is how data logic ends
     * up unable to run outside a browser.
     *
     * If a component ever needs a test, give that file its own `environment: 'jsdom'` docblock
     * comment (`// @vitest-environment jsdom`) rather than switching the default for everyone.
     */
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
