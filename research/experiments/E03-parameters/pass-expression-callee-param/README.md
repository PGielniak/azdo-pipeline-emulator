# oracle probe — pass-expression-callee-param

The mirror of `default-expression-parameter` on the *caller* side: the argument mapping is an ordinary template-expression slot, so `${{ parameters.outer }}` there is fine (`pass-expression`). Does the same hold when the expression names the *callee* parameter?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
