# 01-matrix-multi-config

Multi-configuration builds: the shape almost every real repo has, and the one where a job in the
authored YAML is not a job in the expanded YAML.

## Exercises

- `strategy: matrix` with three legs, each contributing **matrix variables** (`imageName`,
  `buildConfiguration`) that the legs' steps read as macros — so expansion must multiply the job
  and inject per-leg variables.
- `maxParallel` alongside the matrix (a scheduling knob that must survive expansion even though a
  local run has nothing to schedule).
- A matrix variable used **inside `pool:`** (`vmImage: $(imageName)`), i.e. a variable consumed by
  agent selection rather than by a step — the local emitter's `vmImage` approximation (D11
  sandbox) has to cope with a value that is not known statically.
- Job-scoped `variables:` layered on top of matrix variables (`artifactSuffix`).
- `strategy: parallel` (slicing) in a second job, with `System.JobPositionInPhase` /
  `System.TotalJobsInPhase`, which are the only way a sliced job knows which slice it is.
- A `dependsOn` on a *matrixed* job — the dependency names the authored job, not its legs.

## Consumed by

E04 (job multiplication in the semantic model), E05 (one script directory per expanded job),
E06 (`System.*` job-position variables), E07 (matrix/parallel strategies in the coverage report).
