# oracle probe — declared-unused-committed

Shape `declared-unused`, form `committed`.

The leaf declares `parameters:` with a default but never reads it. If the inlined form is identical, the guard is "does the template *use* `${{ parameters.* }}`", not "does it declare any" — a materially wider sound subset.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- The outcome was **not** predicted by this script: every probe here is declared `either`,
  because the equivalence question is exactly what it is asking.
