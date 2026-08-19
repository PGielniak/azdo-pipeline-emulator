# oracle probe — whitespace-around-lone-object

THE boundary probe: an object expression with **surrounding spaces inside the scalar**. If the lone-expression test trims, this is a structural insertion; if it does not, this is mixed content and an object has to be stringified. Our `loneExpression` trims, so a rejection here would mean that helper is wrong for exactly the case it was written for.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
