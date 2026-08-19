# oracle probe — lone-string-yamlish-quoted

The corrected form of `lone-string-yamlish`: the host scalar is double-quoted, so the document parses and the engine really is asked to place a String whose text is YAML.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
