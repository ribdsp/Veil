import type { ToolDefinition } from '../tool-types'

import { askHuman } from './ask-human'
import { aggregate } from './aggregate'
import { applyTransform } from './apply-transform'
import { countWhere } from './count-where'
import { crosstab } from './crosstab'
import { describeDataset } from './describe-dataset'
import { findDuplicates } from './find-duplicates'
import { findIssues } from './find-issues'
import { profileColumn } from './profile-column'
import { proposeTransform } from './propose-transform'
import { requestReveal } from './request-reveal'
import { sampleShapes } from './sample-shapes'
import { submitCleanupReport } from './submit-cleanup-report'
import { undoLast } from './undo-last'

/**
 * Every tool Veil exposes, in the order a model should meet them.
 *
 * Owner: Vicko. Contract: docs/tools.md.
 *
 * Order is not cosmetic. Hosts commonly present tools in registration order, and a model that reads
 * `describe_dataset` first behaves very differently from one that reads `request_reveal` first. The
 * sequence below is the workflow we want: orient, then measure, then find problems, then propose, then —
 * only if nothing else worked — ask a person.
 *
 * `request_reveal` sits near the end deliberately. It is the tool a model reaches for when it is
 * uncertain, and every place it appears earlier in a list is a place it gets reached for sooner.
 */
export const allTools: readonly ToolDefinition[] = [
  // Orient
  describeDataset,
  profileColumn,
  sampleShapes,

  // Measure
  countWhere,
  aggregate,
  crosstab,

  // Find problems
  findIssues,
  findDuplicates,

  // Change things
  proposeTransform,
  applyTransform,
  undoLast,

  // Involve the human
  requestReveal,
  askHuman,

  // Finish
  submitCleanupReport,
]

/** Names of the tools that require a trusted origin. Derived, so it cannot drift from the definitions. */
export const trustedToolNames: readonly string[] = allTools
  .filter((tool) => tool.trusted === true)
  .map((tool) => tool.name)
