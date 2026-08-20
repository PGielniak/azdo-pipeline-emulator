# oracle probe — dot-slash

Is an explicit `./` prefix accepted as relative, or does it fail the "starts with /" test and then fail as a literal path segment? Undocumented.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
