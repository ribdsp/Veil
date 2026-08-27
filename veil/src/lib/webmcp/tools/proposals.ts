import type { TransformReport, TransformSpec } from '@/types/domain'

/**
 * The proposal ledger: what was dry-run, so a commit can be checked against it.
 *
 * Owner: Riko. Contract: docs/tools.md § propose_transform, § apply_transform.
 *
 * `apply_transform` takes a `proposalId` rather than a transform, and this is what an id refers to. The
 * point is not convenience. The human approves a diff — "1,204 rows change, 3 fail, here are five masked
 * examples" — and a commit that carried its own spec could be a *different* spec than the one that produced
 * that diff. Requiring the id means the thing approved and the thing applied are the same object.
 *
 * Lives in the tool layer because a proposal has no place in the guard: `TransformReport` has no id field
 * (`types/domain.ts` is frozen), and everything stored here came from the model's own arguments or from a
 * report that is already masked. There is no cell value in this module.
 *
 * Module-level, like the guard handle, and dies with the tab.
 */

export type Proposal = {
  readonly id: string
  readonly spec: TransformSpec
  /** `undefined` means the whole column, matching `guard.preview`. */
  readonly rows: readonly number[] | undefined
  readonly report: TransformReport
  /** The file the dry run described, so a commit against a different one can be refused. */
  readonly source: string | null
  readonly committed: boolean
}

/**
 * How many proposals are remembered.
 *
 * A bound because the count is driven by the model: an agent that dry-runs in a loop should not grow the
 * tab's memory without limit. Old proposals fall off the front, and a commit against a forgotten id gets
 * the same "propose it again" answer as a commit against an invented one — which is the correct answer,
 * since a human cannot approve a diff nobody can still show them.
 */
const MAX_PROPOSALS = 100

const ledger = new Map<string, Proposal>()

/** Record a dry run and return the id `apply_transform` will ask for. */
export function recordProposal(
  spec: TransformSpec,
  rows: readonly number[] | undefined,
  report: TransformReport,
  source: string | null,
): string {
  const id = `proposal_${crypto.randomUUID().slice(0, 8)}`
  ledger.set(id, { id, spec, rows, report, source, committed: false })

  while (ledger.size > MAX_PROPOSALS) {
    const oldest = ledger.keys().next()
    if (oldest.done === true) break
    ledger.delete(oldest.value)
  }

  return id
}

export function findProposal(id: string): Proposal | null {
  return ledger.get(id) ?? null
}

/**
 * Mark a proposal committed.
 *
 * A new record rather than a mutated one, so nothing that read a `Proposal` sees it change underneath.
 * Replaces the entry in place in the map's order, which keeps eviction oldest-first.
 */
export function markCommitted(id: string): void {
  const existing = ledger.get(id)
  if (existing === undefined) return
  ledger.set(id, { ...existing, committed: true })
}

/** Drop everything. For loading a different file: a proposal about the old one must not be committable. */
export function clearProposals(): void {
  ledger.clear()
}
