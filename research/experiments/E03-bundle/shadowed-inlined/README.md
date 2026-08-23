# oracle probe — shadowed-inlined

Shape `shadowed`, form `inlined`.

The dangerous one. The leaf reads `${{ parameters.greeting }}` and declares its own default; the **root** declares a parameter of the same name with a different value. Committed, the leaf's own scope wins. Inlined, the reference resolves against the root's table — and because the name exists there, the service does not raise `Key not found`. If both halves return 200 with different values, a mechanical splice is **silently** wrong here, not loudly, and the guard cannot rely on the service to catch it.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- The outcome was **not** predicted by this script: every probe here is declared `either`,
  because the equivalence question is exactly what it is asking.
