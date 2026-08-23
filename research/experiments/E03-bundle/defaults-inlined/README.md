# oracle probe — defaults-inlined

Shape `defaults`, form `inlined`.

The template declares `parameters:` with a default and the reference passes none. A mechanical splice drops the declaration block (it is not legal inside a `steps:` list) and leaves `${{ parameters.greeting }}` resolving against the *parent* table. Does the service expand the inlined form at all, and if so to what?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- The outcome was **not** predicted by this script: every probe here is declared `either`,
  because the equivalence question is exactly what it is asking.
