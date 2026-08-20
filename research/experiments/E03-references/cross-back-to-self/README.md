# oracle probe — cross-back-to-self

The documented `@self` scenario: a template in the shared repo reaching back into the consumer repository. Proves `@self` means the root pipeline's repo, not "current repo".

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
