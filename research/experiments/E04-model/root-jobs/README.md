# oracle probe — root-jobs

Does a root-level `jobs:` shorthand get wrapped in the synthetic `__default` stage, the way a root `steps:` does? The 147-expansion corpus this task inherited covers root `steps:` and root `stages:` and never probes root `jobs:`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this probe: it is asking, not asserting.
