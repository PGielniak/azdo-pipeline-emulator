# oracle probe — defaults-committed

Shape `defaults`, form `committed`.

The template declares `parameters:` with a default and the reference passes none. A mechanical splice drops the declaration block (it is not legal inside a `steps:` list) and leaves `${{ parameters.greeting }}` resolving against the *parent* table. Does the service expand the inlined form at all, and if so to what?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- The outcome was **not** predicted by this script: every probe here is declared `either`,
  because the equivalence question is exactly what it is asking.
