# oracle probe — number-float-binding

Number formatting through binding: `1.0` and `0.5` to `number`, and `1.0` to `string` — C-E03-182 measured shortest-round-trip rendering for *interpolation*; binding is a different conversion (C-E03-322 already shows Boolean→String differs).

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
