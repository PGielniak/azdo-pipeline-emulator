# oracle probe — two-inserts-disjoint

Two `${{ insert }}` keys in one mapping with disjoint payloads. The keys are byte-identical, so this also re-tests C-E03-111 (identical directive keys accepted) for a second directive.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
