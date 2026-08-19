# oracle probe — chain-elseif-after-insert

The same break tested against an `elseif` rather than an `else`, so the rule is not recorded from one keyword alone.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
