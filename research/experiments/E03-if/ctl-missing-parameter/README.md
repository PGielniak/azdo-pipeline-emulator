# oracle probe — ctl-missing-parameter

Control for `elseif-not-evaluated` and `untaken-body-not-evaluated`: the same `parameters.missing` read in a position that is definitely reached. Without this the two laziness probes prove nothing — an expansion could just mean the read is harmless.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
