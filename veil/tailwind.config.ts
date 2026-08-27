import type { Config } from 'tailwindcss'

/**
 * Owner: Faiq.
 *
 * Veil is a light interface on purpose, and that is a decision worth defending rather than a default.
 * The dark-panel look is the house style of the agent-tooling genre, and it reads as *console* — a
 * place where output scrolls past and nobody is accountable for it. Veil is closer to a records office:
 * a person sits with a document that matters, decides what an outsider may see, and signs off on it.
 * Paper, ink, and a stamp is the right register for that, and it also means the two screens in the demo
 * video — the agent's chat and Veil — cannot be confused for each other at a glance.
 *
 * The palette is narrow and the type scale is small. Every colour below except the neutrals carries a
 * meaning that the UI relies on; none of them are decoration, and reusing one for a different meaning
 * breaks the only visual vocabulary the user has for a privacy decision.
 *
 * See the UI conventions in CONTRIBUTING.md before adding anything here.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces, from the page inwards. Warm rather than neutral grey: at this density a pure
        // #ffffff panel next to a #f5f5f5 page is a flicker, and warmth separates them without a border.
        base: '#f2efe9',
        panel: '#fbfaf7',
        raised: '#ffffff',
        line: '#ddd8ce',
        edge: '#c4bdb0',

        // Text.
        //
        // Every token below that ever carries text clears WCAG AA (4.5:1) against all three surfaces
        // above, and the tightest of them is `faint` at 4.59:1 on `base`. That is measured, not assumed.
        // Before lightening any of these — and somebody will want to, because 4.5:1 on warm paper looks
        // heavier than it needs to — re-measure. `faint` and `suppressed` are both used at `text-2xs`,
        // which is 11px, which is normal text by every definition: the large-text exemption starts at
        // 18.66px bold. A privacy refusal nobody can read is not a gentler refusal.
        ink: '#1c1a17',
        muted: '#6b655c',
        faint: '#726b60',

        /**
         * State of a value, and the heart of the interface.
         *
         * `veiled` is the resting state: the agent is working, and it is seeing shape rather than
         * content. It must look calm and completely normal, never like an error — a UI that treats
         * privacy as a warning teaches people that privacy is the exception.
         *
         * `suppressed` is a k-anonymity refusal: a real answer existed but describing it would have
         * described too few people. It is *informative*, not a failure, so it gets the colour of a
         * margin note — an ink-brown rather than an amber warning. It is darker than a warning colour
         * usually is because it is set at 11px mono, and this is the one sentence in the interface the
         * human most needs to actually read.
         *
         * `revealed` is the loud one. A cell the human chose to uncover is the single most expensive
         * event in the app, it is permanent in the journal, and it should be visible from across the
         * room. Nothing else may use this colour.
         */
        veiled: '#5b6b7a',
        suppressed: '#7f6120',
        revealed: '#b5322a',

        // Authorship. Every journal entry and every mutation is tinted by who caused it. Kept distinct
        // from the state colours above because "who did this" and "what state is it in" are different
        // questions the user asks at different moments.
        human: '#2f6f9f',
        agent: '#6f4fa8',

        // Data quality findings, for the issues list only. `error` and `warn` deliberately hold the same
        // values as `revealed` and `suppressed`: an issue-list severity and a privacy state are different
        // questions, so they get different names, but a reader should never see two nearly-identical
        // ambers on one screen and have to work out whether the difference means something. Keep them in
        // step — two tokens that are meant to match and quietly drift is a bug that surfaces six weeks on.
        error: '#b5322a',
        warn: '#7f6120',
        ok: '#3a7350',
      },
      fontFamily: {
        /*
         * IBM Plex Sans and IBM Plex Mono, loaded from `src/app/layout.tsx` via `next/font` and served
         * from this origin — `font-src 'self'` in `next.config.mjs` makes a CDN impossible, not merely
         * discouraged.
         *
         * One family for both faces, so the text and the numbers share metrics: a count in mono sitting
         * beside a label in sans lines up on the baseline without either being nudged, which is most of
         * what makes a dense table readable. Plex is also the right register — it was cut for technical
         * documents rather than for terminals, and the argument at the top of this file is that Veil is a
         * records office and not a console.
         *
         * Plex Mono earns its place on two glyphs: the slashed zero and the serifed `1`. Every number in
         * this interface is either a count the human is auditing (`4/12` of a query budget) or a masked
         * exemplar they are comparing against a real value (`+62 999-9999-9999`), and a mono that renders
         * `0` like `O` or `1` like `l` turns both of those into a squint.
         *
         * The fallback stack stays: if the build-time font download fails, the app degrades to a system
         * face rather than to Times New Roman.
         */
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Dense by default. A dataset profile is a table of numbers, not a hero section.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      backgroundImage: {
        /**
         * The veil itself: a fine diagonal hatch laid over any cell whose content is withheld.
         *
         * A hatch rather than a blur, because a blur of real text is not a privacy control — it is
         * recoverable, it *looks* recoverable, and it invites the user to lean in and squint. A hatch
         * is honest: there is nothing underneath it to recover, because the value was never in the DOM.
         */
        hatch:
          'repeating-linear-gradient(45deg, transparent 0 3px, rgba(91,107,122,0.16) 3px 4px)',
      },
    },
  },
  plugins: [],
}

export default config
