# Veil

**An AI agent cleans your sensitive spreadsheet without ever seeing what is in it.**

Veil is a browser-based data-cleaning workbench built on [WebMCP](https://github.com/webmachinelearning/webmcp).
You open a CSV — a customer export, a patient list, a payroll file — and an agent in your browser gets
to work on it: finding the mixed date formats, the near-duplicate records, the column where 3% of the
phone numbers are missing a country code, and proposing fixes for all of them.

It does this without a single cell of your data ever reaching the model.

Not "we don't store it". Not "we delete it after 30 days". The agent is never given the values in the
first place. It is given the *shape* of them — types, formats, distributions, counts, masked
exemplars — each answer filtered through a privacy guard that runs on your machine and refuses
anything specific enough to identify a person. When the agent decides it genuinely cannot proceed
without seeing one particular value, it has to ask you, in writing, for that one cell. You can say no,
and it has to finish the job anyway.

Every question the agent asked, every answer the guard suppressed, and every reveal you granted or
refused is written to an audit journal you can export.

- **Live demo:** *(deploying — link goes here)*
- **Video:** *(3 min — link goes here)*
- Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

---

## The problem

The moment an agent becomes useful for data work is the moment you have to hand it your data.

That is a bad trade and everybody makes it anyway. To get a spreadsheet tidied you paste rows into a
chat window; the useful ones are exactly the rows you are least allowed to paste. Customer lists,
medical records, salary tables, exam results, applicant data — all of them are both the files most
worth cleaning and the files where an upload is a reportable incident. So the work doesn't happen, or
it happens quietly and nobody writes it down.

The usual answers don't resolve it, they relocate it:

- **Local models** — you still hand the data to a model, just a weaker one, and you now maintain a GPU.
- **Redaction before upload** — you have to already know what is sensitive, which is the thing you
  were hoping the tool would tell you.
- **"Enterprise, zero-retention" endpoints** — a promise in a contract, enforced by a supplier's
  internal process, verifiable by nobody in the room.
- **Synthetic stand-ins** — the agent then cleans a dataset that does not have your problems in it.

The interesting question is the one none of these ask: **how much of this work actually requires
reading the data?** Spend an afternoon watching a competent person clean a spreadsheet and the answer
turns out to be *surprisingly little*. "These dates are in two formats" is a statement about formats.
"Rows 41 and 402 are the same person typed twice" is a statement about similarity. "This column is
90% empty and should be dropped" is a statement about counts. Every one of those can be established,
and a fix for it proposed, from structure alone.

Veil is what you get when you take that seriously and build the tool that only ever asks the
structural questions.

## What it does

Load a CSV. It is parsed in a Web Worker and stays in a JavaScript array on your tab's heap — there
is no server, no upload, no API route, and `connect-src 'self'` in the response headers means the
browser itself will block any attempt to change that.

Then an agent connects and works through it:

**It reads the shape.** `describe_dataset` returns 4,812 rows and 14 columns with inferred types and
null counts. `profile_column` on `phone` returns: 96% non-null, 4,102 distinct, and five format
buckets — `+62 8xx-xxxx-xxxx` (61%), `08xxxxxxxxxx` (33%), `8xxxxxxxxxx` (4%), and 2% that match
nothing recognisable. No phone numbers were transmitted to produce that.

**It asks statistical questions and sometimes gets refused.** `count_where` on `status = 'active'`
returns 3,904. The same call on `city = 'Ampenan' AND age > 70` returns `"suppressed"`, because the
true answer is 3, and telling the agent there are exactly three people matching a description that
narrow hands it a way to isolate them. The threshold is *k*-anonymity with k=5 by default, it is
visible in the UI, and you can raise it.

**It finds the problems.** `find_issues` reports issue codes against row IDs: `mixed_date_format` on
412 rows of `joined_at`, `leading_whitespace` on 88 rows of `name`, `impossible_date` on 3 rows.
`find_duplicates` reports that rows 41 and 402 have a similarity of 0.94 across `name`, `email` and
`phone`. Row IDs and scores — never the two names it compared.

**It proposes fixes it cannot see the effect of.** `propose_transform` with `{ column: 'joined_at',
transform: 'normalise_date', target: 'iso_8601' }` comes back as a report: 4,406 rows already
conform, 403 will change, 3 will fail, and here are masked before-and-after exemplars —
`dd/mm/yyyy → yyyy-mm-dd`. You see the real values in your browser; the agent sees the pattern.
Then `apply_transform` commits it, and `undo_last` takes it back.

**When it is truly stuck, it petitions you.** Three rows in `joined_at` fail every date parser. The
agent calls `request_reveal` with a column, a row, and a written reason — *"three values match no
date format; I cannot choose a repair without seeing one."* The call **blocks**. Your browser shows
the request, the reason, and the single cell it wants. You approve it, or you refuse it and type why.
Either way the agent's tool call returns and it has to carry on — and either way the decision is now
a permanent line in the journal.

**It hands back a report.** `submit_cleanup_report` ends the run: what it found, what it changed, what
it could not resolve. You export the cleaned CSV and the audit journal side by side.

## Why this needs WebMCP

This project does not work as a server-side MCP server, and the reason is not performance.

An MCP server over stdio or HTTP is a *different process* from the data. For it to analyse your
spreadsheet, the spreadsheet has to be sent to it. Every guarantee Veil makes would become a promise
about what that process does after it receives the file — which is precisely the promise nobody can
verify and this project exists to avoid making.

WebMCP puts the tool implementations *inside the page that holds the data*, and that single
architectural fact is what makes the whole idea possible:

- **The data never becomes a message.** `count_where` runs against an in-memory array in the same tab
  that parsed the file. What crosses the boundary to the model is the tool's return value — a number —
  and the guard decides what that number is allowed to be.
- **The privacy guard runs on the trusted side.** k-anonymity suppression, the per-column query
  budget, and predicate-complexity rejection all execute in your browser, before the model ever
  receives a response. A guard living behind the same API it is guarding is not a guard.
- **The human is *in* the loop because the loop passes through their screen.** `request_reveal`
  returns a promise that only resolves when a real person clicks. That is not a design pattern layered
  on top of the protocol; it is a direct consequence of tools being functions in a page with a UI.
- **`exposedTo` gives us origin-scoped capability.** The read-only analysis tools are registered for
  every agent. The four tools that can uncover a value, change your data, or end the run are
  registered with `exposedTo: [trusted origins]` — an untrusted agent cannot call them because it
  cannot see that they exist. This part of the spec has almost no usage in the wild yet; it is a good
  fit for a privacy boundary and we lean on it hard.

There is a smaller reason too, and it is worth saying out loud: WebMCP means Veil needs **no API
key**. There is no account, no billing, nothing to configure. You bring whichever agent your browser
already has, and Veil is a static site that costs nothing to run and cannot leak what it never holds.

## The two ideas we're proudest of

### The privacy guard is a compiler, not a filter

The naive version of this project puts a `sanitise()` call at the end of each tool. That fails the
first time somebody adds a tool and forgets, and it fails invisibly.

Veil inverts it. No tool in `src/lib/webmcp/tools/` can access a cell value at all — the raw
accessor is not exported from `lib/data`, and `guard/no-leak.test.ts` greps every tool file and fails
the build if one imports it. What tools get instead is a *query* type: a closed union of predicates
and aggregations, which they hand to the guard. The guard evaluates it against the real data and
returns either an answer or a refusal.

That means every privacy rule is written once, in one directory, and applies to tools that don't exist
yet:

- **k-anonymity suppression.** Any count, group or cell that describes fewer than *k* rows comes back
  as `"suppressed"` with the reason attached, never as a number. Groups below the threshold are merged
  into `__other__` rather than dropped, so the totals still add up and the agent isn't misled about
  the size of the dataset.
- **A per-column query budget.** Twelve questions per column, then that column is closed for the
  session. This exists because k-anonymity alone is defeated by *differencing*: ask for a count, then
  ask for the same count with one extra condition, and the difference between two legal answers is one
  person. Bounding the number of overlapping questions is the cheap, honest mitigation, and the
  remaining budget is reported to the agent in every response so it can spend it deliberately.
- **Predicate complexity limits.** At most three conditions, joined by one operator, drawn from a
  fixed vocabulary. A predicate specific enough to describe one human being is rejected before it is
  evaluated, not after.

### `request_reveal` — the agent has to ask, and you can say no

Most human-in-the-loop UI is a confirmation dialog: the work is done, press OK. `request_reveal` is
the opposite. It is a blocking tool call that suspends the agent mid-reasoning until a person decides,
and the interesting half is what happens when the person declines.

The agent gets `{ granted: false, reason: "you don't need to see a customer's name to fix a date" }`
and it still has a job to finish. In our testing this produces markedly better behaviour than an
agent with full access: it looks for a structural route it had not considered, it flags the three rows
for a human instead of guessing at them, and its final report distinguishes *"fixed"* from *"needs a
person"* — a distinction an agent with unrestricted access almost never bothers to make.

Two details make it work rather than annoy:

- **One cell, and a written reason.** Not a column, not "unlock the dataset". The request names the row
  and the column, the model has to justify it in prose, and that prose is what you are actually
  judging. Vague reasons are easy to refuse.
- **A timeout that fails closed.** Agents abandon a tool call that hangs. If nobody answers within the
  gate timeout, the call returns *not granted* — an unattended Veil reveals nothing, and the agent gets
  a clean, truthful answer instead of a stall.

## The 14 tools

Full schemas and return shapes in [`docs/tools.md`](docs/tools.md).

| Tool | What it answers | Exposure |
| --- | --- | --- |
| `describe_dataset` | rows, columns, inferred types, null and distinct counts, remaining budget | all |
| `profile_column` | one column's type, null rate, length range, format buckets | all |
| `sample_shapes` | up to 10 masked exemplars of a column's values | all |
| `count_where` | how many rows match a closed predicate | all |
| `aggregate` | group-by with count / sum / mean / min / max | all |
| `crosstab` | joint counts across two columns | all |
| `find_issues` | quality findings as issue codes against row IDs | all |
| `find_duplicates` | near-duplicate row pairs with similarity scores | all |
| `propose_transform` | dry-run report for a fix: rows changed, rows failed, masked exemplars | all |
| `apply_transform` | commit a proposed transform | trusted |
| `undo_last` | revert the last applied transform | trusted |
| `request_reveal` | **blocking** — petition the human for one cell | trusted |
| `ask_human` | **blocking** — ask a question with options | all |
| `submit_cleanup_report` | end the run and produce the export | trusted |

Every response carries the guard's accounting: what was suppressed and why, and how much budget the
column has left. An agent that is being refused always knows it is being refused, which is what keeps
it from silently drawing conclusions from a wall of zeroes.

## Describing data to a model without describing anyone

A model that cannot see values still has to be told enough to reason. Getting that dial right is most
of the engineering in this project, and it lives in
[`docs/privacy-guard.md`](docs/privacy-guard.md).

The short version: **content is replaced by class**. A phone number becomes the format it belongs to.
A name becomes a length, a script, and whether it contains a space. A date becomes one of a fixed set
of layouts. This is a *lossy compression whose loss is exactly the identifying part*, which is a
pleasant thing to be able to say about a compression scheme.

Two rules keep it from leaking anyway:

1. **Buckets, never verbatim.** `sample_shapes` masks every character it returns — `Aaaaa Aaaa`,
   `+99 999-9999-9999`. A masked exemplar tells the model what a transform must handle; it cannot tell
   it who anybody is. There is deliberately no code path that returns an unmasked value except
   `request_reveal`, and that one goes through a human.
2. **Named formats, never model-supplied regexes.** An earlier design let the agent pass a pattern to
   match against. We removed it. A regex from a model is both a denial-of-service risk (catastrophic
   backtracking) and a high-bandwidth exfiltration channel — `^0812(\d)` repeated ten times extracts a
   phone number one digit at a time through nothing but legal, k-safe counts. Veil accepts a closed
   enum of named formats instead. It is less flexible and it is the difference between a privacy
   boundary and a decoration.

## Human and agent in the same room

Veil is a two-handed tool, and the UI is built around that rather than around a chat log.

The dataset pane is yours: you can see every value, sort, filter and edit. The agent's view of the
same table is rendered beside it with the veil hatch over any cell it has not been shown — which is,
initially, all of them. As the agent profiles columns, the pane fills in with what it now knows:
*"phone: 5 formats, 96% populated"*. You are looking at your data and at the agent's model of your
data at the same time, and the gap between them is the point.

Every action is attributed. The journal records who did what — `human` or `agent` — with a timestamp
and a reason, and each entry is coloured by author. A transform the agent proposed and you approved
reads differently from one you made yourself, and six weeks later, when somebody asks why the dates in
this file changed, the journal is the answer.

Reveals get their own treatment. A granted reveal is the most expensive event in the app: it is the
one moment a real value crosses to the model. It is logged in red, it is permanent, it cannot be
undone by an undo, and the count is displayed in the header for the whole session. Making the cost
visible is what stops "just approve it" becoming a habit.

## Quick start

```bash
git clone https://github.com/ribdsp/Veil.git
cd Veil/veil
npm install
cp .env.example .env.local   # optional — see below
npm run dev
```

Open http://localhost:3000. There is a synthetic sample dataset on the landing screen; use it before
you use anything real, because it contains the specific defects the tools are built to find.

To generate more:

```bash
cd fixtures && node generate.mjs --rows 5000 --messy
```

### Getting WebMCP in your browser

WebMCP ships behind an origin trial. Without a token, `document.modelContext` does not exist and no
agent can see the tools.

1. Register at [chrome origin trials](https://developer.chrome.com/origintrials) for the
   WebMCP / Prompt API trial. Request one token per origin — `http://localhost:3000` and your
   deployed URL are different origins.
2. Put it in `veil/.env.local` as `NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN`. It is served as an
   `Origin-Trial` **header**, not a `<meta>` tag, for the reason documented at the top of
   `next.config.mjs`.
3. Restart the dev server. The header is read at boot.

With no token, Veil still runs and every tool is still callable — `src/lib/webmcp/polyfill.ts`
installs a stand-in `document.modelContext`, and the debug panel in the UI lets you invoke tools by
hand with JSON arguments. That is enough to develop against; it is not enough to see the project's
actual behaviour, which only shows up when a real model is choosing what to ask.

### Trying your own data

Use the file picker. It reads the file with the File API and never writes it anywhere — not to disk,
not to `localStorage`, not to the repo. Reload the page and it is gone.

Do **not** copy a real spreadsheet into the project directory. `.gitignore` blocks `*.csv` and
`*.xlsx` with a single allow-list for `veil/public/samples/`, precisely because that mistake is easy
and permanent once pushed.

## Project layout

```
veil/                       the app
  src/
    app/                    Next.js app router; tool-surface.tsx registers everything
    components/
      data/                 dataset table, column profiles, veil hatch
      agent/                the agent's view, reveal requests, question gates
      journal/              audit trail and export
      panes/                layout
      ui/                   primitives
    lib/
      data/                 CSV parsing, type inference, column profiling
      guard/                k-anonymity, query budget, predicate limits, masking
      dedupe/               similarity scoring and pair finding
      transform/            the closed set of transforms and their dry-run reports
      journal/              append-only audit log
      store/                zustand dataset + session state
      webmcp/               tool registration, blocking gates, polyfill
        tools/              one file per tool
    types/domain.ts         the frozen contract every module shares
docs/                       architecture, tools, privacy guard, threat model
fixtures/                   synthetic dataset generator
```

## Security

The threat model is written out in [`docs/threat-model.md`](docs/threat-model.md), including the
attacks we do **not** defend against. Four things are load-bearing:

- **Nothing from the model is ever executed.** No `eval`, no `new Function`, no dynamic regex
  construction, no `import()` of a model-supplied path. Predicates and transforms are closed unions
  that a switch statement interprets. `no-eval.test.ts` greps the source and fails the build if
  `eval(` or `new Function` appears anywhere in `src/`.
- **No tool can read a cell.** The raw accessor is module-private to `lib/data`, and
  `guard/no-leak.test.ts` proves by grep that no file in `lib/webmcp/tools/` imports it. The only
  exception is `request_reveal`, which routes through a human gate.
- **The browser enforces the no-upload claim.** `connect-src 'self'` is set in `next.config.mjs`, and
  Veil serves no endpoint that accepts data. A rogue dependency attempting to POST your dataset gets a
  CSP violation, not a 200.
- **No real data in this repository, ever.** Only synthetic CSVs from `fixtures/`. This is enforced by
  `.gitignore` and by review, and it applies to bug reports too — attach a generated file that
  reproduces the problem, never yours.

## Built with

- **[WebMCP](https://github.com/webmachinelearning/webmcp)** — `document.modelContext.registerTool`,
  `exposedTo` for origin-scoped capability, and the `toolchange` event
- **[Next.js](https://nextjs.org/) 15** + React 19, static export, no server-side anything
- **[Papa Parse](https://www.papaparse.com/)** — streaming CSV parsing in a Web Worker
- **[Zustand](https://zustand-demo.pmnd.rs/)** — dataset and session state
- **[Tailwind CSS](https://tailwindcss.com/)** and **[Vitest](https://vitest.dev/)**

## Status and limitations

Built in a week for a hackathon. Honest about where that shows:

- **CSV only.** `.xlsx` is a parser dependency away and did not fit in the week.
- **In-memory, single tab.** Comfortable to about 100k rows on a laptop. There is no streaming path
  and no IndexedDB spill, so a 2 GB file will not open.
- **k-anonymity is not differential privacy.** A determined adversary with many queries and outside
  knowledge can still learn things; the query budget bounds this rather than eliminating it. If you
  need a formal guarantee, you need noise injection, and that is a different project with a different
  set of trade-offs. We say what we implement and no more.
- **The guard protects against inference, not against a compromised page.** Anything with script
  access to the tab can read the heap. Veil defends the boundary between the page and the model,
  which is the boundary that was actually missing.
- **`exposedTo` behaviour varies.** It is a young part of a young spec, and the trusted-origin split
  degrades to "everything exposed" where it is unimplemented. Do not rely on it as your only control.
- **Reveals are all-or-nothing per cell.** Partial reveals — last four digits, year only — are
  obviously right and are not built.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). If you are an AI coding agent, read
[`CLAUDE.md`](CLAUDE.md) first; it exists to stop you from cheerfully weakening the tests that hold
this project's claims up.

The most useful contributions right now are new privacy-guard cases — a query pattern that gets past
the current rules and shouldn't. Open an issue with a synthetic dataset that demonstrates it.

## Licence

MIT — see [`LICENSE`](LICENSE). Built by Riko, Vicko and Faiq for The WebMCP Challenge, and open to
anyone who wants to take it further.
