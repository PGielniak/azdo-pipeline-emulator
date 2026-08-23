# oracle probe — powershell

Documented as `PowerShell@2`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Step keys in the expansion: `task`
- Verdict: desugared → `PowerShell@2`
- Not predicted by this script: every row is asking, not asserting.
