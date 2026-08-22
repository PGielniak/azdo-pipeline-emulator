# oracle probe — type-tmpl-stringlist

Both process pages state flatly: "The `stringList` data type isn't available in templates. Use the `object` data type in templates instead." The vendored schema disagrees (C-E03-300/302). This probe is the arbiter.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
