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
        ink: '#1c1a17',
        muted: '#6b655c',
        faint: '#989185',

        /**
         * State of a value, and the heart of the interface.
         *
         * `veiled` is the resting state: the agent is working, and it is seeing shape rather than
         * content. It must look calm and completely normal, never like an error — a UI that treats
         * privacy as a warning teaches people that privacy is the exception.
         *
         * `suppressed` is a k-anonymity refusal: a real answer existed but describing it would have
         * described too few people. It is *informative*, not a failure, so it gets the colour of a
         * margin note.
         *
         * `revealed` is the loud one. A cell the human chose to uncover is the single most expensive
         * event in the app, it is permanent in the journal, and it should be visible from across the
         * room. Nothing else may use this colour.
         */
        veiled: '#5b6b7a',
        suppressed: '#a8823c',
        revealed: '#b5322a',

        // Authorship. Every journal entry and every mutation is tinted by who caused it. Kept distinct
        // from the state colours above because "who did this" and "what state is it in" are different
        // questions the user asks at different moments.
        human: '#2f6f9f',
        agent: '#6f4fa8',

        // Data quality findings, for the issues list only.
        error: '#b5322a',
        warn: '#a8823c',
        ok: '#3f7d58',
      },
      fontFamily: {
        // Placeholder. Faiq picks the real pair on Day 6; system-ui as "the design" is banned. The
        // brief is a text face with real proportions for the document surface, and a mono with
        // unambiguous zero and one for anything showing a value or a count.
        sans: ['ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
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
