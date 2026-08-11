# 08-deployment-runonce

Deployment jobs — the priority shape for E10 and the one place where a "job" has an internal
lifecycle instead of a flat step list.

## Exercises

- `deployment:` jobs with `environment:` (two different environments, neither of which needs to
  pre-exist for the service to accept the YAML — see below).
- `strategy: runOnce` with **every** lifecycle hook: `preDeploy`, `deploy`, `routeTraffic`,
  `postRouteTraffic`, and `on: failure` / `on: success`. Each hook is its own step list, so the
  emitter cannot treat a deployment job as "steps with extra keys".
- `strategy: rolling` with `maxParallel` and a subset of hooks, so the two strategies can be
  diffed against each other in one expansion.
- Artifact flow into a deployment job: a deployment job **auto-downloads** artifacts unless told
  otherwise, and here `preDeploy` also downloads explicitly — the expansion shows what the service
  makes implicit.
- A plain `job:` depending on a `deployment:` by name (`dependsOn: production`) with
  `condition: always()`, reading `$(Agent.JobStatus)`.
- Job-scoped `variables:` on a deployment job, read from inside a hook's steps.
- A **template expanded into a lifecycle hook** (`deploy.steps` → `templates/deploy-steps.yml` →
  `health-check.yml`): template expansion has to work at a nesting depth that only deployment jobs
  reach, and the hook's steps are the template's, not the job's.

## Precondition: the environments must exist

Like a variable group (fixture 04), an `environment:` is validated at load time — *"Environment
corpus-staging could not be found. The environment does not exist or has not been authorized for
use."* (C-E12-017). `scripts/oracle-provision.ts` creates and authorizes `corpus-staging` and
`corpus-production`; both are empty of resources.

## Consumed by

E04-S03 (deployment runOnce in the semantic model), E10 (deployment strategies), E06 (auto-download
behaviour, `Agent.JobStatus`), E07 (strategy coverage reporting).
