# oracle probe — cross-rel-self

The base-directory question across a repository switch: `../e03-refs/leaf.yml@self` written in `/cross/rel-self.yml` (templates repo). Resolving proves the including file's directory is carried into the target repository; a rejection proves `@self` resets the base to `/`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
