# E09-S03-T02 — runs and artifacts, measured

Run: 2026-09-02 against the test organization. Organization, project and PAT redacted; pipeline and
run ids are kept because they are meaningless outside the org and make the run reproducible by its
owner.

## 1. Runs-List has no filters, and omits the field a filter would need

```text
GET <org>/<project>/_apis/pipelines/20/runs?api-version=7.1
  -> 200, 8 runs
     first item keys: _links, createdDate, finishedDate, id, name, pipeline,
                      result, state, templateParameters, url
     id=527 name=20260812.8 state=completed result=failed
     "resources" present on the list item: FALSE
```

The endpoint's documented URI parameters are only `organization`, `project`, `pipelineId`,
`api-version` — **there is no branch or tag filter to pass** (C-E09-067). And the list item does not
carry `resources`, even though the `Run` definition documents it (C-E09-068). So a branch filter is
necessarily client-side *and* costs one extra request per candidate run.

## 2. Runs-Get supplies the branch — and two undocumented fields

```text
GET <org>/<project>/_apis/pipelines/20/runs/527?api-version=7.1
  -> 200
     keys: _links, createdDate, finishedDate, id, name, pipeline, resources,
           result, state, tags, templateParameters, url, yamlDetails
     resources.repositories.self.refName = refs/heads/main
     resources.repositories.self.version = ddef690f…
     resources.repositories.self.repository.type = azureReposGit
```

`tags` and `yamlDetails` appear on the live response but are **not** in the reference page's `Run`
definition (C-E09-069). `tags` is the field a `resources.pipelines` `tags:` filter needs, so the tag
arm reads something the docs do not mention.

## 3. A missing artifact is a clean 404

```text
GET <org>/<project>/_apis/pipelines/20/runs/527/artifacts
      ?artifactName=drop&$expand=signedContent&api-version=7.1
  -> HTTP 404
     {"message":"An Artifact with name \"drop\" was not found.",
      "typeKey":"ArtifactNotFoundException",
      "typeName":"Microsoft.Azure.Pipelines.WebApi.ArtifactNotFoundException, …"}
```

"No such artifact" is therefore distinguishable from any other failure without guessing (C-E09-072).

## 4. The download half — not measured, and why

Every pipeline in the organization was enumerated and every one of its runs checked for artifacts:

```text
13 pipelines, 29 completed runs, runs carrying at least one artifact: 0
```

That is not an accident of sampling. Every oracle experiment this project has run used
`previewRun: true`, which validates and expands a pipeline **without executing it**, so no run has
ever produced an artifact. Getting a fixture requires queueing a real build in a personal
organization — an outward-facing write, and one that consumes the owner's CI minutes, so it was not
taken unilaterally (C-E09-073).

Consequently: the runs list, the run detail, and the artifact-metadata 404 above are **measured**;
the signed-URL download and the `.cache/artifacts/` write are covered by unit tests against the
documented `SignedUrl` shape only. Section 4 of this transcript is the thing to re-run once a
pipeline with a `PublishPipelineArtifact` step has executed once.
