# oracle probe — lone-object-value-quoted

Is "exactly one expression" a property of the *text* or of the YAML **style**? The same structural insertion as `lone-object-value`, with the host scalar double-quoted and no surrounding whitespace. If quoting alone demoted it to mixed content it would reject the way `whitespace-around-lone-object` does.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
