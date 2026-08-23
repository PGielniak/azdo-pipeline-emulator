# oracle probe — nested-inlined

Shape `nested`, form `inlined`.

Root -> mid -> leaf, all parameterless. Recursion plus the path question: `mid.yml` names the leaf, and once both are inlined no reference is left to rebase. Confirms the recursive case is the plain case applied twice rather than a new shape.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- The outcome was **not** predicted by this script: every probe here is declared `either`,
  because the equivalence question is exactly what it is asking.
