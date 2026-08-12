# 10-monorepo-triggers-pools

The monorepo pipeline: heavy trigger configuration, container jobs, and agent selection. Almost
none of this *runs* locally — which is exactly why it is in the corpus. It is the fixture the
**coverage report** (E07) is measured against, because every unsupported knob here must be
reported rather than silently dropped.

## Exercises

- `trigger:` in full: `batch`, branch include/exclude with wildcards, **path** filters
  include/exclude (the monorepo mechanism), and tag filters.
- `pr:` with `autoCancel` and its own path filters — a different filter set from `trigger`.
- `schedules:` with a cron expression, `displayName`, branch filter and `always: false`.
- `resources.containers` and a job running **inside** the container (`container: builder`) with
  `options:` and `env:` on the resource — the D11 sandbox has to reconcile a container job with an
  already-containerized run.
- `services:` (sidecar container) on another job.
- Pool selection two ways: a pipeline-level `vmImage` and a job-level self-hosted
  `pool: name/demands` — demands are unsatisfiable locally and must surface in coverage.
- Job knobs: `timeoutInMinutes`, `cancelTimeoutInMinutes`, `workspace: clean: all`.
- All three shell step shortcuts (`script`, `bash`, `powershell`) plus the tasks two of them
  desugar to (`Bash@3`, `PowerShell@2`), including `failOnStderr`, `errorActionPreference`,
  `pwsh: true`, `targetType: inline` and `workingDirectory` — the group-A task surface of docs/03.

## Consumed by

E07 (coverage report: unsupported/approximated features), E09 (`Bash@3`, `PowerShell@2`, shell
shortcuts), E14-S04 (sandbox vs container jobs), E04 (triggers and resources in the model).
