# oracle probe — object-typed-raw

An `object`-typed root parameter given a raw JSON object. The CLI's `--parameter name=@file.json` produces exactly this shape (C-E13-009/010), so whether it can be sent unflattened decides what that flag can support.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- `templateParameters`: `{"config":{"key":"value"}}`
- Outcome: **HTTP 400 · rejected · typeKey=ArgumentNullException**
- Not predicted by this script: every probe here is asking, not asserting.
