# oracle probe — self-alias-relative

Does `@self` reset the resolution base to the repo root, or is the path still relative to the including file? A bare name plus `@self` distinguishes them.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
