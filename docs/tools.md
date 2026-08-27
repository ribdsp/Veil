# The 14 tools

The contract between Veil and any agent. This document is the specification; the code in
`veil/src/lib/webmcp/tools/` implements it. If they disagree, that's a bug in one of them — say which
in your PR.

Conventions throughout:

- Every response is `{ content: [{ type: 'text', text }] }`, where `text` is indented JSON. Indented
  because models read nested JSON noticeably more reliably that way, and the cost is a few dozen
  tokens.
- Every JSON key is camelCase.
- Every schema sets `additionalProperties: false`. A misspelled argument should be an error the agent
  can read, not a silently ignored field.
- Every response carries `remainingQueries` for the columns it touched.
- **A refusal is a normal response, not an error.** `isError` is reserved for a malformed call. Being
  told "that answer describes 3 people, so I won't give it" is the tool working correctly.

---

## Origin layering

Ten tools are registered for every agent. Four are registered with
`exposedTo: [trusted origins]`, from `NEXT_PUBLIC_VEIL_TRUSTED_ORIGINS`:

| Trusted tool | Why it is gated |
| --- | --- |
| `apply_transform` | it edits the user's data |
| `undo_last` | it edits the user's data |
| `request_reveal` | it is the only path to a real value |
| `submit_cleanup_report` | it ends the run and produces the export |

An agent from an unlisted origin sees the ten analysis tools and can do most of the work with them —
it can find every problem and propose every fix. What it cannot do is commit anything or ask to see
anything.

With the list empty, everything is exposed to everyone. That is the right default for local development
and the wrong one for a deployment whose URL you have shared. See `docs/threat-model.md` (T4) for why
this is defence in depth rather than a defence.

---

## Analysis

### `describe_dataset`

Start here. Shape of the whole file, plus the guard's own settings so the agent knows the rules it is
playing by.

**Arguments:** none.

```json
{
  "rowCount": 4812,
  "columns": [
    { "id": "customerId", "type": "text", "emptyCount": 0, "distinctCount": "unique" },
    { "id": "name", "type": "text", "emptyCount": 12, "distinctCount": 4104 },
    { "id": "phone", "type": "text", "emptyCount": 193, "distinctCount": 4102 },
    { "id": "joinedAt", "type": "mixed", "emptyCount": 0, "distinctCount": 1877 },
    { "id": "city", "type": "text", "emptyCount": 4, "distinctCount": 38 }
  ],
  "minGroupSize": 5,
  "queryBudgetPerColumn": 12
}
```

`distinctCount: "unique"` means one distinct value per row — the column is a per-person key. Reported
as a word rather than a number so it cannot be differenced against.

### `profile_column`

The workhorse. Everything about one column's shape.

```json
{ "column": "phone" }
```

```json
{
  "column": "phone",
  "type": "text",
  "emptyCount": 193,
  "distinctCount": 4102,
  "minLength": 9,
  "maxLength": 16,
  "formats": [
    { "format": "phoneE164", "count": 2818, "share": 0.61 },
    { "format": "phoneLocalId", "count": 1524, "share": 0.33 },
    { "format": "phoneDigitsOnly", "count": 185, "share": 0.04 },
    { "format": "unrecognised", "count": 92, "share": 0.02 }
  ],
  "truncated": false,
  "remainingQueries": 11
}
```

At most 8 buckets, largest first, tail folded into `unrecognised` with `truncated: true`. Buckets below
k are folded too — a format that only 2 values match would name those 2 values' owners as "the odd
ones".

### `sample_shapes`

Masked exemplars. What a transform will have to handle, without what it will handle.

```json
{ "column": "joinedAt", "limit": 6 }
```

```json
{
  "column": "joinedAt",
  "shapes": ["9999-99-99", "99/99/9999", "99.99.9999", "99 Aaa 9999", "9999-99-99 99:99", "Aaaa"],
  "note": "Characters are masked: 9 = digit, A = uppercase letter, a = lowercase letter, other characters are literal.",
  "remainingQueries": 10
}
```

`limit` is capped at 10. The `note` field is not decoration — without it, models occasionally read
`9999-99-99` as a literal string in the data and propose a transform that matches it.

### `count_where`

How many rows match a query.

```json
{
  "conditions": [
    { "kind": "matchesFormat", "column": "phone", "format": "unrecognised" },
    { "kind": "isEmpty", "column": "name" }
  ],
  "join": "all"
}
```

Answered:

```json
{ "count": 47, "remainingQueries": 9 }
```

Suppressed:

```json
{
  "count": "suppressed",
  "code": "belowK",
  "reason": "Between 1 and 4 rows match. Reporting an exact count for a group smaller than 5 would describe individuals. Try removing a condition or grouping instead.",
  "remainingQueries": 9
}
```

Note the range in the reason — *"between 1 and 4"* — rather than silence. The agent learns the group is
non-empty and small, which is enough to say "a handful of rows need a human", and not enough to isolate
anyone.

Condition kinds: `equals`, `isEmpty`, `matchesFormat`, `compare`, `lengthBetween`. At most 3 conditions,
one `join`. There is no nesting and no pattern argument anywhere — see
[`privacy-guard.md`](privacy-guard.md).

### `aggregate`

Group-by. `fn` is one of `count`, `sum`, `mean`, `min`, `max`; `over` is required for all but `count`.

```json
{ "groupBy": "city", "fn": "count" }
```

```json
{
  "groups": [
    { "key": "Mataram", "count": 1204, "value": 1204 },
    { "key": "Denpasar", "count": 890, "value": 890 },
    { "key": "Surabaya", "count": 415, "value": 415 }
  ],
  "other": { "groupCount": 14, "rowCount": 61 },
  "truncated": true,
  "remainingQueries": 11
}
```

At most 25 groups. Everything below k and everything past the cap goes into `other` — **merged, not
dropped**, so the numbers still sum to `rowCount`. An agent whose groups don't add up concludes it was
given a filtered dataset, and every number it reports afterwards is wrong in a way nobody can see.

### `crosstab`

Joint counts across two columns. Useful, and the single most re-identifying output in the app, so every
cell is suppressed independently.

```json
{ "rows": "city", "columns": "status" }
```

```json
{
  "rowKeys": ["Mataram", "Denpasar", "__other__"],
  "columnKeys": ["active", "churned", "pending"],
  "cells": [[1102, 84, 18], [790, 92, 8], [402, "suppressed", 61]],
  "suppressedCells": 1,
  "truncated": true,
  "remainingQueries": 10
}
```

Charged against the budget of both columns.

### `find_issues`

Quality scan. Issue codes against row ids.

```json
{ "columns": ["joinedAt", "name"] }
```

```json
{
  "issues": [
    { "code": "mixedFormat", "column": "joinedAt", "rowIds": [12, 44, 61], "affectedCount": 412, "truncated": true },
    { "code": "impossibleDate", "column": "joinedAt", "rowIds": [903, 1288, 4401], "affectedCount": 3, "truncated": false },
    { "code": "leadingWhitespace", "column": "name", "rowIds": [7, 19], "affectedCount": 88, "truncated": true }
  ],
  "remainingQueries": 9
}
```

At most 100 row ids per issue; `affectedCount` is the true total. Row ids are **not** k-suppressed and
that is deliberate: a row id is a position in a file, it identifies nobody on its own, and it is what
lets the agent correlate findings across tools. The full codebase list of codes is in
`types/domain.ts`.

Omit `columns` to scan everything, which charges every column one query.

### `find_duplicates`

Near-duplicate records.

```json
{ "columns": ["name", "email", "phone"], "threshold": 0.85 }
```

```json
{
  "pairs": [
    { "a": 41, "b": 402, "score": 0.94, "matchedColumns": ["name", "phone"] },
    { "a": 1180, "b": 1181, "score": 0.88, "matchedColumns": ["email"] }
  ],
  "truncated": false,
  "remainingQueries": 8
}
```

At most 50 pairs. Ids, scores and which columns agreed — never the values that agreed, which would be
two people's records side by side.

---

## Transforms

### `propose_transform`

A dry run. Nothing changes.

```json
{ "spec": { "kind": "normaliseDate", "column": "joinedAt", "to": "dateIso" } }
```

```json
{
  "proposalId": "tr_7f3a",
  "unchangedCount": 4397,
  "changedCount": 412,
  "failedCount": 3,
  "failedRowIds": [903, 1288, 4401],
  "examples": [
    { "from": "99/99/9999", "to": "9999-99-99" },
    { "from": "99.99.9999", "to": "9999-99-99" },
    { "from": "99 Aaa 9999", "to": "9999-99-99" }
  ],
  "destructive": false,
  "remainingQueries": 7
}
```

The `examples` are masked. That is enough to confirm the transform does what the agent intended, and not
enough to read a record. `failedRowIds` are the rows no rule handles — the usual honest reason for a
reveal request.

`spec.kind` is one of: `trimWhitespace`, `collapseSpaces`, `changeCase`, `normaliseDate`,
`normalisePhone`, `normaliseNumber`, `padLeft`, `replacePlaceholderWithEmpty`, `dropColumn`,
`maskColumn`. There is no free-form expression, template or script variant, and there will not be one.

### `apply_transform` — trusted

```json
{ "proposalId": "tr_7f3a" }
```

Takes a proposal id, not a spec, so the thing applied is exactly the thing previewed.

```json
{ "applied": true, "transformId": "tr_7f3a", "changedCount": 412, "undoable": true }
```

`dropColumn` and `maskColumn` are `destructive: true` and **block for human approval** before applying,
even though undo exists — they remove information rather than reshaping it, and a user who did not
notice deserves to be asked. Everything else applies immediately and is journaled.

### `undo_last` — trusted

**Arguments:** none. Reverts the most recent applied transform using its stored previous values, so the
revert is exact rather than a best-effort inverse.

```json
{ "undone": true, "transformId": "tr_7f3a", "restoredCount": 412 }
```

A granted reveal cannot be undone. Nothing can un-see a value; the journal entry stands.

---

## The human gates

Both of these **block**. The agent's tool call does not return until a person acts or the gate times
out, and both time out to the safe answer.

### `request_reveal` — trusted

The petition. One cell, and a reason.

```json
{
  "column": "joinedAt",
  "row": 903,
  "reason": "This value matches no date layout I can detect and normaliseDate fails on it. Seeing one example lets me decide whether these three rows are a fourth format or genuine corruption."
}
```

Granted:

```json
{ "granted": true, "column": "joinedAt", "row": 903, "value": "31/02/2025" }
```

Refused:

```json
{
  "granted": false,
  "reason": "You don't need to read a customer record to tell me three dates are broken — flag them for me instead."
}
```

**A refusal is not an error and it is not a retry signal.** The agent is expected to finish the job
without the value: find a structural route, or report the three rows as needing a person. Asking again
in a different shape is the behaviour this tool exists to discourage, and the description says so.

`reason` must be non-empty. A request without a justification is refused before a human is disturbed.
Timeout: the gate resolves `{ granted: false, reason: 'no response' }`. An unattended Veil reveals
nothing.

### `ask_human`

For questions that aren't about a value.

```json
{
  "question": "The status column contains \"N/A\" 61 times. Is that a missing value or a real category?",
  "options": ["Missing — treat as empty", "A real category — leave it", "Not sure, skip it"]
}
```

```json
{ "answer": "Missing — treat as empty" }
```

Closed options, no free text. A model given a text box will ask open-ended questions and then have to
parse prose; a model given three options asks a question it can act on. Timeout returns the last option,
which is why the last option should always be the one that changes nothing.

---

## Ending the run

### `submit_cleanup_report` — trusted

The run has an end, and the end produces an artifact.

```json
{
  "summary": "Normalised 412 dates to ISO, trimmed whitespace in 88 names, merged no duplicates.",
  "resolved": ["joinedAt: 412 rows normalised to dateIso", "name: 88 rows trimmed"],
  "needsHuman": [
    "joinedAt rows 903, 1288, 4401: no recognisable date format; reveal refused, left unchanged",
    "rows 41/402 and 1180/1181: likely duplicates at 0.94 and 0.88 — merging is a judgement call"
  ],
  "revealsRequested": 1,
  "revealsGranted": 0
}
```

Veil renders it beside the export buttons: cleaned CSV, and the audit journal as JSON.

The `needsHuman` field is the one worth defending. A cleaning agent that reports only what it fixed is
telling you half of something, and the half it omits is the half that matters. Requiring the field
makes the omission impossible rather than impolite — and in practice an agent that has been refused a
reveal writes a much better `needsHuman` list than one that was never told no.
