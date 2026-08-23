# oracle probe — plain-inlined

Shape `plain`, form `inlined`.

Parameterless include: does splicing a template's `steps:` into the parent expand identically to letting the service read the same file from the repository? This is the soundness base case for the whole bundler.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- The outcome was **not** predicted by this script: every probe here is declared `either`,
  because the equivalence question is exactly what it is asking.
