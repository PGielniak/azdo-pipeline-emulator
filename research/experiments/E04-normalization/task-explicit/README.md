# oracle probe — task-explicit

Control: an already-canonical `task:` step must pass through untouched, so a difference in any row above is attributable to the shorthand and not to the expansion in general.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Step keys in the expansion: `task`
- Verdict: desugared → `CmdLine@2`
- Not predicted by this script: every row is asking, not asserting.
