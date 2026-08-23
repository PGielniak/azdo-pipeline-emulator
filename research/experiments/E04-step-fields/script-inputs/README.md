# oracle probe — script-inputs

`workingDirectory` and `failOnStderr` are named in this task's Do as common step fields, but the steps-task schema page does not list them. Where do they actually land?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this probe: it is asking, not asserting.
