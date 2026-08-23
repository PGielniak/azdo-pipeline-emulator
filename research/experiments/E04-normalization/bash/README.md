# oracle probe — bash

Documented as a shortcut for `Bash@3`. Does the service rewrite it, or does the shorthand reach the agent intact?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Step keys in the expansion: `task`
- Verdict: desugared → `Bash@3`
- Not predicted by this script: every row is asking, not asserting.
