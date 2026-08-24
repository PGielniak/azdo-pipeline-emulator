// E04-S03-T03 — the deployment-job output-variable naming quirk, encoded.
//
// A runOnce deployment job registers output variables under a key whose first segment is **not** the
// lifecycle hook that produced it. The doc and a hosted run (run 548) agree, and the hook-name
// spelling is the one that *fails*:
//
// - without a targeted resource the first segment is the **job name** (`A1.setvarStep.myOutputVar`),
//   never the hook (`deploy.setvarStep.myOutputVar` → empty) — C-E04-151/153;
// - with one it is `Deploy_<resourceName>` (`Deploy_vmsfortesting.setvarStepTwo.myOutputVarTwo`) —
//   C-E04-152;
// - canary/rolling use a different first segment (`<hook>_<increment>`, `<hook>_<resource>`) and are
//   reserved for E08 — C-E04-154.
//
// This module records the runOnce half of that quirk as the one place E02/E05/E06 should ask "what
// key did this deployment step register its output under". It is a pure function over the model so
// the answer stays attached to the fields the model actually carries (`environment`, `id`).
import type { Job } from './types.js';

/**
 * The output-variable key a step in a runOnce deployment job registers its variable under — the
 * inner `outputs['…']` segment, without the `dependencies.<job>` / `stageDependencies.<stage>.<job>`
 * path the caller adds around it.
 *
 * The first segment is the job's own name (C-E04-151) unless the environment targets a resource, in
 * which case it is `Deploy_<resourceName>` (C-E04-152). The doc phrases the trigger as "runOnce plus
 * a resourceType", but the key is built from `resourceName`, and the two always co-occur in a valid
 * `environment:` block (C-E04-145).
 */
export function runOnceOutputVariableKey(job: Job, stepName: string, variableName: string): string {
  const first =
    job.environment?.resourceName !== undefined ? `Deploy_${job.environment.resourceName}` : job.id;
  return `${first}.${stepName}.${variableName}`;
}
