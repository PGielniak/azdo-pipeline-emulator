# oracle probe — collision-literal-after

THE flagged question, second half: the insert first, then a literal key repeating it. If the two halves disagree, the rule is positional, not "the explicit key wins".

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
