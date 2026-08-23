# oracle probe — checkout

PLAN D4 emits `checkout` natively, so what matters here is only the *shape* the model receives: if the service rewrites it into a task, E05 cannot match on the keyword.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Step keys in the expansion: `task`
- Verdict: desugared → `6d15af64-176c-496d-b583-fd2ae21d4df4@1`
- Not predicted by this script: every row is asking, not asserting.
