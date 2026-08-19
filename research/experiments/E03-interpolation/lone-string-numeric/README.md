# oracle probe — lone-string-numeric

A lone expression returning a String that *looks* numeric (`0123`). docs/02 §3 says the result is not re-parsed as YAML; if that holds, this stays a string rather than becoming 123.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
