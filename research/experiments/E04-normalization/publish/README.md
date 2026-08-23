# oracle probe — publish

A shortcut for `PublishPipelineArtifact@1`. Its `artifact:` sibling names the artifact, so if the service desugars it the input names matter to E06-S05-T01.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Step keys in the expansion: `task`
- Verdict: desugared → `ecdc45f6-832d-4ad9-b52b-ee49e94659be@1`
- Not predicted by this script: every row is asking, not asserting.
