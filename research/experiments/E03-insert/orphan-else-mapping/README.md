# oracle probe — orphan-else-mapping

E03-S01-T02 measured its orphan rejection only in **sequence** position, so the second sentence of the orphan rejection (`Unexpected value '<key>'`) is unverified for a mapping. This task makes a broken chain report that rejection in mapping position too, so the mapping-position wording has to be measured rather than assumed to match.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
