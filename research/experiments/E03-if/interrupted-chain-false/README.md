# oracle probe — interrupted-chain-false

The control for `interrupted-chain`: same shape with a false `if`. If the `else` body appears, the chain survived the intervening item; if nothing appears, the `else` was dropped instead.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
