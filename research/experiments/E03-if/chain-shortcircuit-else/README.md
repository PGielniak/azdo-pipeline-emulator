# oracle probe — chain-shortcircuit-else

A won `if`, a raising `elseif`, then an `else`. Resolving the `else` must not reach past the winner — this is the probe that fixes the *order* chain members are evaluated in.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
