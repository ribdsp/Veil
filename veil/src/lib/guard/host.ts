import type {
  Author,
  Dataset,
  JournalEventKind,
  RevealDecision,
  RevealRequest,
  TransformReport,
  TransformSpec,
} from '@/types/domain'

/**
 * The one seam between the guard and the page.
 *
 * Owner: Riko.
 *
 * `lib/guard` has to do three things it cannot do itself: ask a human to approve a write, ask a human to
 * reveal a cell, and write to the journal. All three live in React — the store, the dialogs, the timeline —
 * and `lib/` may not import React or the store (CONTRIBUTING.md § code conventions). So the page installs
 * these functions once at startup and the guard calls them through this file.
 *
 * A seam rather than a direct import, and the direction matters: `lib/guard → lib/store` would put the whole
 * store one import away from the module that holds the dataset, and `app/` imports `lib/`, never the reverse.
 *
 * ## Absent means refused
 *
 * Every default below is the answer that discloses least, and it is the default precisely because the
 * interesting failure is not "the host said no" but "the host was never installed". A guard whose approval
 * seam is missing and which therefore approves everything would pass every test in this repo and write to the
 * user's file without asking, and the bug would look like a wiring oversight rather than the data loss it is.
 *
 *   `askApproval` → not approved, reason `no response`
 *   `askReveal`   → not granted, reason `no response`
 *   `record`      → nothing, safely: see below
 *   `callerIsTrusted` → allowed, noted. See below.
 *
 * `record` doing nothing is the one default that is not a refusal, and it is safe for a specific reason: the
 * two events that must never be silent are a granted reveal and a committed write, and neither can happen
 * without a host to grant or approve it. With no host there is nothing to journal.
 *
 * `callerIsTrusted` allowing an unknown caller matches `register-tools.ts`, whose own note says: if the host
 * does not tell us the origin, allow it and journal it. Refusing instead would disable `apply_transform`,
 * `undo_last` and `request_reveal` in every environment that does not report an origin — including the
 * WebMCP inspector — and each of those three is gated by a human decision anyway, which is where the actual
 * authority lives. This flag narrows who may *ask*; the gate decides what happens.
 */

/** What the human is being asked to approve: this spec, on this many rows, with this measured effect. */
export type ApprovalRequest = {
  spec: TransformSpec
  /** The dry run of exactly what will be written, computed immediately before asking. */
  report: TransformReport
  /** The agent's stated reason, verbatim, for the human to judge. */
  reason: string
  /** Rows targeted: a count, or `'all'` when the transform covers the file. */
  rows: number | 'all'
}

export type ApprovalDecision = { approved: boolean; reason: string }

/** A journal line the guard wants written. Mirrors `JournalEntry` minus the fields the journal itself owns. */
export type GuardEvent = {
  kind: JournalEventKind
  subject: string
  detail: string
  irreversible: boolean
  author: Author
}

export type GuardHost = {
  askApproval: (request: ApprovalRequest) => Promise<ApprovalDecision>
  askReveal: (request: RevealRequest) => Promise<RevealDecision>
  record: (event: GuardEvent) => void
  /** Called after a commit or an undo, so the store can re-render from the new dataset. */
  datasetChanged: (dataset: Dataset) => void
  callerIsTrusted: () => boolean
}

const NO_HOST: GuardHost = {
  askApproval: async () => ({
    approved: false,
    reason:
      'no response — nothing is listening for approvals, so this write was refused rather than performed ' +
      'unapproved',
  }),
  askReveal: async () => ({
    granted: false,
    reason: 'no response — nothing is listening for reveal requests',
  }),
  record: () => undefined,
  datasetChanged: () => undefined,
  callerIsTrusted: () => true,
}

let installed: Partial<GuardHost> = {}

/**
 * Install the page's implementations. Called once, from `app/tool-surface.tsx`.
 *
 * Partial on purpose: a test that only cares about approval installs `askApproval` and leaves the reveal seam
 * refusing, which is the state it should be in. Repeated calls merge, so the page can add a seam as the
 * component that owns it mounts.
 */
export function installGuardHost(part: Partial<GuardHost>): void {
  installed = { ...installed, ...part }
}

/** Drop every installed seam. For tests, and for the page tearing down a session. */
export function clearGuardHost(): void {
  installed = {}
}

/** The current host, with the fail-closed defaults filled in. Module-internal by convention. */
export function host(): GuardHost {
  return { ...NO_HOST, ...installed }
}

/**
 * Whether the caller may use a tool marked `trusted`.
 *
 * Exported separately from `host()` so the tool layer can ask this one question without being handed
 * `datasetChanged` and a way to swap the dataset underneath the guard. Tools import this; nothing else.
 */
export function callerIsTrusted(): boolean {
  return host().callerIsTrusted()
}

/**
 * Whether a host was installed at all. `describe_dataset` says so, because "no journal" is worth knowing.
 */
export function hostInstalled(): boolean {
  return Object.keys(installed).length > 0
}

/**
 * Journal the fact that a tool was called.
 *
 * The other narrow export, for the same reason as `callerIsTrusted`: a tool needs to be able to say "I was
 * called" without being handed `datasetChanged` and a way to swap the dataset underneath the guard. Every event
 * a tool could want to record is a `toolCalled`, so the kind is not a parameter — the events that carry weight
 * (`transformApplied`, `revealGranted`, `answerSuppressed`) are recorded by the guard itself, at the moment it
 * decides them, where they cannot be forgotten by a tool author.
 *
 * No-ops with no host. A missing journal line about a call the agent also has in its own transcript is not the
 * failure worth engineering against.
 */
export function noteToolCall(subject: string, detail: string): void {
  host().record({ kind: 'toolCalled', subject, detail, irreversible: false, author: 'agent' })
}
