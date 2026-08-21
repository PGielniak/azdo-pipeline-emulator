# oracle probe — pass-callee-scope

Is the caller's parameter visible inside the callee? The template dumps `parameters` wholesale, so the answer is the key set of the printed object: `p` alone means each file gets its own parameters frame, `p` + `outer` means the contexts merge.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
