# oracle probe — self-alias-relative-nested

Does `@self` reset the resolution base to the repository root, or keep the including file's directory? `../leaf.yml@self` from `/e03-refs/dir/` resolves under "keep" and escapes the root under "reset" — the root-file spelling cannot tell the two apart.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
