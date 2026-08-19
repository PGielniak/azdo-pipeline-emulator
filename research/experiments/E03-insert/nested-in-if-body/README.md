# oracle probe — nested-in-if-body

An `${{ insert }}` inside the body of a winning `${{ if }}` — the ordinary composition of the two directives, as opposed to the sibling case that breaks.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
