# oracle probe — cross-bare-inside

**The central design question.** A bare name inside a template read from the aliased repo: does the repository context stay switched (reads `templates`), or fall back to the root repository (reads `self` and fails)?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
