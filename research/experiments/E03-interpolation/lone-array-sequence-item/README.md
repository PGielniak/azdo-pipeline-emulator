# oracle probe — lone-array-sequence-item

The template-expressions page's own Insertion example: a lone `${{ parameters.x }}` as a sequence item, fed a `stepList`. Establishes the baseline this task generalizes from.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
