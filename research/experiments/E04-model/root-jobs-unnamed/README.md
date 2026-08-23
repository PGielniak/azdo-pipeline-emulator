# oracle probe — root-jobs-unnamed

A root `jobs:` whose job carries no name. Does it get the same synthetic `Job` a bare `steps:` root gets, or something else?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this probe: it is asking, not asserting.
