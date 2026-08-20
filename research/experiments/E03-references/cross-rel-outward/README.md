# oracle probe — cross-rel-outward

The base-directory rule pointing outward: `cross/leaf.yml@templates` written in `/e03-refs/dir/`. Reaching `cross-leaf` proves a repository switch resets the base to `/` rather than carrying the including file's directory into the target repository.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
