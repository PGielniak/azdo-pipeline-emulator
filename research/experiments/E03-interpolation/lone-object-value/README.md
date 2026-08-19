# oracle probe — lone-object-value

A mapping value that is exactly one expression returning an **object**. docs/02 §3 says this is inserted structurally rather than stringified; the template-expressions page states the array case only, so the mapping case is measured here.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
