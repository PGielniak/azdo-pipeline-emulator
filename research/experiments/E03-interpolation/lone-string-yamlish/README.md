# oracle probe — lone-string-yamlish

The stronger no-re-parse probe: a String whose text is itself YAML (`a: b`). Re-parsing would turn one scalar into a mapping; not re-parsing keeps the two characters.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
