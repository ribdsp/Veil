# Fixtures

Every CSV in this repository is generated here. There are no real datasets in Veil, and there is no
process for adding one.

```bash
node fixtures/generate.mjs --rows 5000 --messy 0.25 > veil/public/samples/customers.csv
```

| Flag | Default | Meaning |
|---|---|---|
| `--rows` | `5000` | Number of data rows. |
| `--messy` | `0.2` | Share of rows carrying at least one defect, `0`–`1`. |
| `--seed` | `20260827` | PRNG seed. Same seed, same file. |

## Why generated

Not because a real file would be less convincing — it would be more. Because there is no version of
"I removed the sensitive columns first" that survives a week of commits, and a dataset committed to git
is in git forever, in every clone and every fork.

`.gitignore` blocks `*.csv`, `*.xlsx` and `*.xls` everywhere except `veil/public/samples/`, so the
accident takes a deliberate `git add -f` and the correct path is the easy one.

## What the mess is for

The defects are not arbitrary. Each one exists so that a specific tool has something true to find, and
so that the demo shows a refusal rather than only successes:

- **Four phone formats in one column** — the opening move. The agent normalises them without reading one.
- **Three date formats, some ambiguous** — `01/02/2026` cannot be resolved by looking harder, only by
  asking. This is why `ask_human` exists.
- **`1.234,56` beside `1234.56`** — the failure a naive `parseFloat` turns into a value 1,000× too small.
- **One dominant city, two with fewer than five rows** — without a group under *k*, nothing in the demo
  ever gets suppressed, and suppression is the most convincing thing Veil does.
- **A 95%-empty notes column** — every real export has one.
- **~2% near-duplicate names** — `find_duplicates` needs real pairs, not synthetic-looking ones.

## Adding a defect

Add it to the generator, then add the recogniser or issue code that finds it. A defect nothing detects
makes the sample file dirtier without making the demo better, and it will be mistaken for a generator
bug by whoever reads the CSV next.

Do not adapt a file you found on the machine, and do not paste rows of anything real into a test as a
fixture literal.
