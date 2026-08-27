# Architecture

How Veil is put together, and why the pieces sit where they do.

---

## The shape of it

```
      ┌─────────────────────────────────────────────────────────────────┐
      │  one browser tab                                                │
      │                                                                 │
      │   CSV file ──► lib/data ──► Dataset (values, in memory)         │
      │                                   │                             │
      │                                   ├──────────────► store ──► UI │
      │                                   │              (the human     │
      │                                   │               sees values)  │
      │                                   ▼                             │
      │                             ╔═══════════╗                       │
      │                             ║ lib/guard ║  ◄── the veil         │
      │                             ╚═══════════╝                       │
      │                                   │  Verdict<T>                 │
      │                                   ▼                             │
      │                          lib/webmcp/tools                       │
      │                                   │                             │
      └───────────────────────────────────┼─────────────────────────────┘
                                          │  { content: [{ type: 'text' }] }
                                          ▼
                                      the agent
```

Everything above the double line has values. Everything below it has answers about values. There is no
path around the box, and `guard/no-leak.test.ts` is what keeps that sentence true as the code grows.

There is no server. `next build` produces a static site; there are no API routes, no server actions,
and no database. The response headers set `connect-src 'self'`, so a `fetch` to anywhere else is
blocked by the browser rather than by our good intentions.

---

## Modules

### `lib/data` — parsing and inference

Takes a `File`, gives back a `Dataset`. Papa Parse runs in a Web Worker so a 50 MB CSV doesn't freeze
the tab.

Values stay as the strings the file contained. Nothing is coerced to `Date` or `Number` at parse time,
and this is load-bearing: Veil's job is to report what the file *says*, and `new Date("08/27/2026")`
has already silently decided between two readings of that text. The whole `mixedFormat` finding depends
on not having thrown that ambiguity away.

`infer-schema.ts` assigns a `ValueType` per column by voting: classify every value, take the plurality,
and return `mixed` when no class holds a clear majority. `patterns.ts` holds one recogniser per
`NamedFormat` — pure functions, `string → boolean`, no shared state, individually testable.

**The module boundary that matters:** the accessor that returns a cell is not exported. `lib/guard`
imports it through a package-private module path; nothing else can.

### `lib/guard` — the veil

The only module allowed to look at values and speak to the tool layer. Four files, four concerns:

- **`k-anonymity.ts`** — given a group size, decide whether it may be reported. Also the merge logic
  that folds small groups into `__other__` instead of dropping them.
- **`query-budget.ts`** — per-column accounting. Twelve questions per column per session, then that
  column is closed. Defends against differencing, which k-anonymity alone does not.
- **`predicate.ts`** — validate and evaluate a `Query`. Rejects unknown columns, unknown formats, and
  more than three conditions. This is the security boundary: it is where a malformed or hostile query
  stops.
- **`redact.ts`** — masking. Turns a value into its shape (`Aaaaa Aaaa`, `+99 999-9999-9999`) for
  exemplars and transform previews.

`guard.ts` composes them into the `GuardHandle` that tools receive. Every method returns
`Verdict<T>` — answered or refused, never a bare value — which means a tool cannot read past a refusal
without narrowing on `status` first. The type system is doing real work there.

Read [`privacy-guard.md`](privacy-guard.md) before changing anything here.

### `lib/dedupe` and `lib/transform` — the analysis that needs values

Both live above the veil and are called *by* the guard, not by tools.

`dedupe/similarity.ts` scores two rows column by column and combines the scores; `dedupe/find-pairs.ts`
blocks candidates so the comparison isn't quadratic over 100k rows. What comes out is row ids and a
score.

`transform/` holds one implementation per `TransformSpec` variant plus `apply-transform.ts`, which runs
a spec in dry-run mode (producing a `TransformReport`) or commit mode (producing an `AppliedTransform`
with the previous values, so undo is exact). The dry run and the commit share one code path
deliberately: two paths drift, and the drift shows up as a preview that lied.

### `lib/webmcp` — the tool surface

- **`tool-types.ts`** — response helpers (`text()`, `json()`, `toolError()`), the narrow JSON-Schema
  types, and `notImplemented()` for stubs.
- **`polyfill.ts`** — installs a stand-in `document.modelContext` when the origin trial isn't active,
  so the app is developable in any browser.
- **`blocking.ts`** — the gate mechanism. A tool creates a `Gate<T>`, hands the promise back to the
  agent, and the UI resolves it. Includes the timeout, which **fails closed**: an unattended Veil
  refuses.
- **`register-tools.ts`** — registers all 14 tools against one `AbortController`, splits them into the
  open and trusted sets via `exposedTo`, and re-registers on `toolchange`.
- **`tools/`** — one file per tool. Each is thin by policy: validate arguments, call the guard, format
  the verdict. A tool with real logic in it is a tool whose logic isn't tested, because the test suite
  points at `lib/`.

### `lib/store` and `lib/journal` — state and memory

Zustand. Two rules, both enforced by convention and both load-bearing:

1. **No component calls `setState`.** Every mutation goes through an action in `store/dataset.ts`.
2. **Every action takes an `author`.** `'human'` or `'agent'`, no default. The journal is only
   trustworthy if attribution cannot be forgotten, so the parameter is required and the compiler asks
   for it.

`lib/journal` is append-only: `append()` and nothing else. `JournalEntry` fields are `readonly`, which
is the cheapest available way to tell the next person that editing history is not a feature.

### `app/` and `components/`

`app/tool-surface.tsx` is a client component that mounts nothing visible. Its whole job is to call
`registerTools()` in an effect and abort the controller on unmount. Registration has to happen in a
client component after hydration — `document.modelContext` does not exist during SSR — and keeping it
in its own file means the page component doesn't have to think about it.

Components are grouped by what they show: `data/` for the human's view of the spreadsheet, `agent/` for
the agent's view and the two gates, `journal/` for the audit trail, `panes/` for layout, `ui/` for
primitives.

---

## Two flows worth tracing

### A guarded question

The agent calls `count_where` with `{ conditions: [...], join: 'all' }`.

1. `tools/count-where.ts` validates argument *types* only — is `conditions` an array, is `join` one of
   two strings. It does not decide whether the query is acceptable.
2. It calls `guard.count(query)`.
3. `predicate.ts` validates the query's *content*: columns exist, formats are known, at most three
   conditions. A failure returns `{ status: 'refused', code: 'unknownColumn', reason: ... }` with a
   sentence naming the columns that do exist, because an agent given the valid options corrects itself
   on the next call.
4. `query-budget.ts` charges the columns named in the query. Over budget returns `budgetExhausted`.
5. The predicate is evaluated against the real rows. A number comes out.
6. `k-anonymity.ts` decides whether that number may be reported. Below k, the verdict is `belowK`.
7. The journal gets an entry either way — `toolCalled`, plus `answerSuppressed` if it was suppressed.
8. `tools/count-where.ts` formats the verdict as text and returns it.

Step 3 and step 6 are separate on purpose. Step 3 is *"was this a legitimate question"*; step 6 is
*"is this a legitimate answer"*. Collapsing them produces a guard that lets a fine-grained question
through because it happened to match many rows, and the next question differs from it by one condition.

### A reveal

1. `tools/request-reveal.ts` validates that `reason` is a non-empty string and that the row and column
   exist. A reveal request without a justification is refused before a human is disturbed.
2. It creates a `Gate<RevealDecision>` and puts it in the store with the request attached.
3. The promise is returned to the agent. **The agent's tool call is now suspended.**
4. `components/agent/reveal-request.tsx` renders the column, the row, the agent's reason, and the one
   cell — visible to the human, who is allowed to see their own data.
5. The human approves, or refuses and types why. The component resolves the gate.
6. If nobody acts before `expiresAt`, `blocking.ts` resolves it with
   `{ granted: false, reason: 'no response' }`. Fail closed, always.
7. The decision is journaled — `revealGranted` is flagged `irreversible` and rendered in red — and
   returned to the agent.

---

## Decisions that could reasonably have gone the other way

**The guard is a chokepoint, not a decorator.** The obvious design gives tools the dataset and asks
them to sanitise their output. That fails the first time somebody adds a tool and forgets, and it fails
invisibly. Putting the guard *between* tools and data means new tools inherit every rule, including
rules written after they were.

**Verdicts, not exceptions.** A refusal is a value the agent receives and can act on, not a thrown
error. Exceptions would let a `catch` somewhere turn a suppression into a zero.

**Row ids everywhere, values nowhere.** All findings address rows by id. It makes the tool responses
compact, it means the agent can correlate findings across tools, and it means the most detailed output
in the app is still a list of integers.

**Flat queries instead of a predicate tree.** Nesting can express "the one person who lives here and
was born then". Deciding whether a tree is too specific is open-ended; counting three conditions is
not. We took the bound we can verify.

**Static export, no server.** A server would make Veil's central claim unfalsifiable — you would be
trusting our deployment rather than your browser. The cost is no `.xlsx` parsing on the fly and no
datasets larger than memory. Worth it.
