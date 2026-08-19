# oracle probe — mixed-boolean

Boolean in **mixed content**: `pre-${{ true }}-post`. The conversion table says `True`; this checks the casing survives into the document rather than being lower-cased by YAML output.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
