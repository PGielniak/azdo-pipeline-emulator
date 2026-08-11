# 03-dependencies-and-conditions

Cross-job and cross-stage data flow: output variables produced by a logging command in one job and
consumed as a condition in another. This is the fixture that proves the emulator models *results*
and *outputs*, not just command order.

## Exercises

- `##vso[task.setvariable ...;isOutput=true]` behind a **named step** (`name: flags`), and the two
  reference dialects that read it back: `dependencies.<job>.outputs['<step>.<var>']` within a
  stage and `stageDependencies.<stage>.<job>.outputs[...]` across stages.
- The same value consumed **two ways**: mapped into a stage-level `variables:` entry with a
  runtime expression `$[ ... ]`, and inlined directly into a job `condition:`.
- A non-output `setvariable` in the same job, to keep the isOutput distinction honest.
- Result-based conditions: `eq(dependencies.web.result, 'Skipped')` (a *skipped* dependency is not
  a failed one), plus `succeeded()`, `not(failed())`, `always()`, `succeededOrFailed()`.
- Fan-in `dependsOn` over two jobs where one is expected to be skipped — so the summary job must
  still run, which is the classic condition bug.
- A multi-line stage `condition:` combining `succeeded('build')` (named-stage form) with a
  `dependencies.<stage>.result` comparison.
- Failure knobs that change control flow rather than output: job-level `continueOnError`,
  step-level `continueOnError`, `retryCountOnTaskFailure`, `timeoutInMinutes`.
- `variables['Build.Reason']` index syntax next to `variables.apiChanged` dotted syntax.

## Consumed by

E02 (condition functions, `dependencies`/`stageDependencies` contexts), E04 (dependency graph),
E06 (logging commands, result tracking, retries/continueOnError), E05 (skip propagation).
