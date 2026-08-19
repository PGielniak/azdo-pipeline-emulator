# oracle probe — escape-literal

The doc's own escape spelling, `${{ 'my${{value' }}`. It is a lone expression whose result contains the opening delimiter, so it proves the quote-aware scan of C-E03-117 is required and that the result is not re-scanned for expressions.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
