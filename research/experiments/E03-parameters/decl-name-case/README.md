# oracle probe — decl-name-case

Declared `myParam`, read as `${{ parameters.MYPARAM }}` — the expression language's ordinal-ignore-case object lookup (C-E02-045) should apply, but parameters are a service-built context.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
