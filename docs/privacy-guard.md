# The privacy guard

Required reading before you change anything in `veil/src/lib/guard/`.

The guard's job is a dial, not a switch. Turn it one way and the agent is told nothing and is useless.
Turn it the other and it is told everything and the project has no reason to exist. Everything below is
an argument about where a specific notch on that dial should sit — and most of these notches were moved
at least once during the build.

---

## The principle: replace content with class

An agent cleaning a spreadsheet does not need values. It needs to know which *class* each value belongs
to, because a cleaning rule applies to a class.

- A phone number becomes the format it matches.
- A name becomes a length, a script, and whether it contains a space.
- A date becomes one of a fixed set of layouts.
- A category becomes a group key and a count.

This is lossy compression whose loss is exactly the identifying part, which is a pleasant thing to be
able to say about a compression scheme. `+6281234567890` and `+6289876543210` compress to the same
token. Everything a transform needs to know survives; the person does not.

Where it stops working is where the class *is* the person, and that is what the rest of this document is
about.

---

## k-anonymity suppression

**The rule.** Any number describing fewer than *k* rows is not reported. Default k=5, floor k=3 (the
guard refuses lower), and the human can raise it in the UI.

**Why 5.** It is the conventional floor in disclosure control, small enough that ordinary questions
still get ordinary answers, and large enough that an answer cannot be a household. We picked the
convention rather than inventing a number, and 3 is the floor because below that the concept stops
meaning anything.

**Where it applies.** Every count, every group size, every crosstab cell, every format bucket. Not to
row ids — see below.

**Merged, never dropped.** Small groups are folded into `__other__` with their combined count, and the
number of groups that went in is reported.

This matters more than it looks. If small groups vanish, the agent's groups don't sum to `rowCount`, and
the conclusion a model draws from that is *"I have been given a filtered dataset."* Every number it
reports afterwards is then wrong in a way nobody can detect. Suppressing a value while preserving the
total is honest; suppressing it while breaking the total is misleading in a direction that looks like
correctness.

**Suppression is informative, not silent.** A suppressed count comes back as
`"count": "suppressed", "code": "belowK", "reason": "Between 1 and 4 rows match..."`.

Reporting the *range* is a deliberate concession. Strictly, "between 1 and 4" is information. In
practice it is the information that makes the agent useful — it can now write *"a handful of rows need a
human"* instead of *"no rows match"* — and it does not narrow anyone down, because the bound is exactly
the suppression threshold the agent was already told about in `describe_dataset`.

**Row ids are not suppressed, on purpose.** `find_issues` returns row 903 freely. A row id is a position
in a file; it identifies nobody without the file, and the agent already knows how many rows there are.
What it buys is large: the agent can correlate findings across tools, address a transform at specific
rows, and tell the human exactly where to look. If row ids were suppressed the tool surface would
collapse to summary statistics and the project would not work.

---

## The query budget

**The rule.** 12 questions per column per session. Then that column is closed, and every tool touching
it returns `budgetExhausted`. Remaining budget rides along on every response.

**Why it has to exist.** k-anonymity alone is defeated by *differencing*:

```
count_where(city = Mataram)                        →  1204
count_where(city = Mataram AND status = active)    →  1102
count_where(city = Mataram AND age > 70)           →   102
count_where(city = Mataram AND age > 70 AND ...)   →     ⋮
```

Every answer is above k. Every answer is legal. Subtract two of them and you have a group of one. No
individual check can catch this, because the leak is not in any answer — it is in the relationship
between answers.

The rigorous defence is a privacy budget in the differential-privacy sense: track cumulative
information disclosure and add calibrated noise. We did not build that, and it is worth being clear
about the trade rather than implying we did. Noise changes every number the agent sees, which changes
what a transform report means, which changes the product. The practical defence is to bound the number
of overlapping questions, which is cheap, exact, and explicable to a user in one sentence.

**Why 12.** Enough for an agent to profile a column, check three or four hypotheses about it, and dry-run
a transform — measured against real runs, that is 6–9 questions for a column it actually cares about.
Not enough for a systematic sweep across a wide table. If you change this number, change it because you
watched an agent run out of budget doing legitimate work, and say so in the commit.

**Charged per column, not per session.** A session budget would let an agent spend everything on one
column, which is precisely the attack. Per-column also means the agent can work on a wide file
indefinitely, as long as it moves on.

**Multi-column queries charge every column named.** A crosstab charges both. `find_issues` with no
argument charges all of them, which is expensive by design: "scan everything" should cost something.

**Reported, not hidden.** An agent that knows it has 3 questions left on `phone` spends them
deliberately. One that doesn't burns them on questions it could have skipped, then hits a wall
mid-reasoning and produces a worse report. Telling the agent its budget makes it a better citizen at no
privacy cost.

---

## Predicate limits

**Three conditions, one operator, closed vocabulary.**

A predicate specific enough to describe one human being is rejected before it is evaluated, not after.
Three is where "a legitimate data-cleaning question" and "a description of a person" separate: *"phone is
unrecognised and name is empty"* is the first; *"lives in Ampenan, born in 1948, phone starts 0812"* is
the second.

**Flat, not a tree.** Arbitrary nesting of `all` and `any` can express anything, including a
one-person predicate assembled from individually-innocent parts. Deciding whether a *tree* is too
specific is an open-ended problem, and a check that is subtly wrong is worse than a cruder check that is
exactly right. Counting to three cannot be subtly wrong.

**No pattern argument, anywhere.** This is the project's most significant deviation from its own initial
design, and the reasoning belongs here because it will be proposed again:

A model-supplied regex is a side channel with real bandwidth. Not a theoretical one:

```
count_where(phone matches ^0812(\d))    → 91   … legal, above k
count_where(phone matches ^08121(\d))   → 12   … legal, above k
count_where(phone matches ^081213(\d))  →  8   … legal, above k
```

Continue until suppression stops you and you have most of a phone number, extracted through nothing but
legal counts, with no reveal requested and no rule broken. k-anonymity does not see it because every
answer is above the threshold; the budget bounds it but 12 digits is a lot of digits.

It is also a denial-of-service risk — catastrophic backtracking on a hostile pattern hangs the tab that
holds the user's only copy of their data.

So: `NamedFormat` is a closed enum, matched by hand-written recognisers in `lib/data/patterns.ts`.
Adding a format is a two-line PR and is the correct way to extend matching. Accepting a pattern from the
model is not, however carefully it is validated, because the vulnerability is not in the regex engine —
it is in the arbitrary granularity.

**`equals` with a literal is allowed, and that is a considered choice.** The agent can supply a value and
learn how many rows carry it. *"How many rows say `active`"* is the most ordinary question in data
cleaning and refusing it would break the product. What makes it safe is the same k-suppression as
everything else: a guess narrow enough to name one person returns `suppressed`. What it costs is that an
agent which already knows a value can confirm the value appears in a group of ≥ k rows. We accept that.

---

## Masking

`redact.ts` turns a value into its shape:

| Real value | Masked |
| --- | --- |
| `Ahmad Fauzi` | `Aaaaa Aaaaa` |
| `+6281234567890` | `+99999999999999` |
| `27/08/2026` | `99/99/9999` |
| `a.wijaya@example.co.id` | `a.aaaaaa@aaaaaaa.aa.aa` |

`9` for a digit, `A` for an uppercase letter, `a` for a lowercase letter, everything else literal.

**Punctuation and structure survive, and they have to.** An agent writing a date transform needs to know
whether the separator is `/` or `.`, and one writing a phone transform needs to see the `+`. That is the
whole informational content of a masked exemplar.

**Single-character leakage is real and bounded.** `a.aaaaaa@aaaaaaa.aa.aa` reveals that the local part
starts with a letter and contains a dot. In principle a very short value in a distinctive column could be
narrowed by its mask. In practice the mask is one of at most 10 exemplars per column, exemplars are drawn
only from format buckets that are themselves above k, and there is no way to ask for the mask of a
*specific* row. The alternative — masking punctuation too — makes exemplars useless for their only
purpose.

**Exemplars are capped at 10 and drawn one per bucket first.** Ten masks of the same format teach the
agent nothing on the tenth that it did not know on the second; one mask per format teaches it the shape
of the problem. `sample_shapes` therefore samples across buckets before sampling within them.

**Transform previews are masked pairs.** `{ "from": "99/99/9999", "to": "9999-99-99" }`. Enough to confirm
the transform does what was intended; not enough to read a record. An unmasked before-and-after would be
a bulk read wearing a preview's clothes.

---

## What is deliberately not implemented

Each of these is a good idea we chose against. If you are about to build one, this is the argument you
are arguing with.

**Differential privacy.** Calibrated noise on every aggregate, with a formal cumulative budget. The
right answer for a research release. Wrong here because a transform report has to be *exact* — "412 rows
will change" cannot be 412 ± 3 when the user is about to approve an edit to their file — and a system
that is noisy in some answers and exact in others is harder to reason about than one that is exact
everywhere and refuses more often.

**Free-text answers to `ask_human`.** A model given a text box asks open-ended questions and then has to
parse prose. Closed options make the question actionable and the answer unambiguous.

**Partial reveals** — last four digits, year only, domain only. Obviously right, and simply did not fit
in the week. The `maskColumn` transform already has a `keep` field with `lastFour` and `domain`, so the
masking primitives exist; what is missing is the request shape and the UI. Best available first
contribution.

**Caching identical queries so they don't charge budget twice.** Tempting and wrong: a cache turns the
budget into a limit on *distinct* questions, and differencing uses distinct questions. Repeating a
question should cost, because an agent that repeats questions is either confused or probing.

**Letting the human grant a whole column.** "Allow all reveals in `joinedAt`" would be convenient, and it
converts a considered decision into a switch someone flips once and forgets. The friction is the
feature.
