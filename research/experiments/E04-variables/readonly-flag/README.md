# oracle probe — readonly-flag

Does `readonly: true` survive expansion so the model can carry it to the manifest and runtime?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this probe: it is asking, not asserting.
