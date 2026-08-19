# oracle probe — bare-sequence-item

The directive as a **bare scalar** sequence item, with no colon and no value. This is the real "not a mapping key" position — `sequence-position` turned out still to be a mapping key, of the one-key mapping the item is.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
