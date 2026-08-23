# oracle probe — script

The one case already measured (C-E00-017/018, C-E04-002). Kept in the matrix as the control: if this stops coming back as `CmdLine@2` the whole delegation assumption has moved.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Step keys in the expansion: `task`
- Verdict: desugared → `CmdLine@2`
- Not predicted by this script: every row is asking, not asserting.
