# oracle probe — whitespace-around-lone-string

The positive control for `whitespace-around-lone-object`: the same surrounding spaces with a String result, which cannot fail conversion. Whether the spaces survive says directly whether the service trims the host scalar before deciding, or treats the whole thing as mixed content and keeps the literal text.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
