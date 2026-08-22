# oracle probe — default-expression-literal-number-on-string

Isolates the two variables the previous pair confounded: `${{ 42 }}` is the same *lone literal expression* shape as the accepted `${{ 'x' }}`, now on a `string` parameter, so if this rejects the deciding factor is the parameter type and not the literal kind.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
