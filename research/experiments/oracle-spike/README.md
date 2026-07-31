# Oracle spike — preview endpoint transcripts (E00-S03-T02)

Live request/response pairs from the Azure DevOps Pipelines **preview** endpoint, captured
2026-07-31. These files are the grounding artifact for the oracle itself: they prove the route,
the api-version, the `finalYaml` field name, and every failure mode the tooling depends on.

Regenerate with `pnpm oracle-probe` (needs `.env.oracle`, see `research/oracle-setup.md`).
`previewRun` is always `true`, so no run is ever queued.

All transcripts pass through `redact()` before being written: the PAT is matched by its fixed
`AZDO` signature (C-E00-021) and the organization is replaced with `{org}`. The latter is not
cosmetic — see `missing-template.md`, where the service quotes the anchor repository's full
clone URL back at us.

## Success shape

`five-line.md` is the canonical pair. A 5-line pipeline expands to the service's canonical
form, which is worth internalizing because it is what every golden fixture will be compared
against:

- bare `steps:` gains an implicit `stages: - stage: __default` → `jobs: - job: Job`
- `script:` becomes `task: CmdLine@2` with `inputs.script`
- `trigger: none` becomes `trigger: {enabled: false}`
- the 200 body contains **exactly one** field, `finalYaml` (C-E00-022)

## Failure modes

| Probe | HTTP | `typeKey` | Shape of `message` |
|---|---|---|---|
| `malformed-yaml` | 400 | `PipelineValidationException` | `/azure-pipelines.yml (Line: 3, Col: 3): While parsing a block mapping, did not find expected key.` |
| `unknown-root-key` | 400 | `PipelineValidationException` | `/azure-pipelines.yml (Line: 1, Col: 1): Unexpected value 'stepz'` |
| `bad-expression` | 400 | `PipelineValidationException` | `… (Line: 2, Col: 6): Unrecognized value: 'nosuchfunc'. Located at position 1 within expression: …` |
| `missing-template` | 400 | `PipelineValidationException` | `/azure-pipelines.yml: File /does-not-exist.yml not found in repository {org}… branch … version …` |
| `unknown-task` | 400 | `PipelineValidationException` | `A task is missing. … (Task version 9, job 'Job', step ''.)` |

Error bodies are a uniform envelope:
`{$id, innerException, message, typeName, typeKey, errorCode, eventId}` (C-E00-023).

Two consequences for the engine:

1. **Not every rejection is positional.** `malformed-yaml`, `unknown-root-key` and
   `bad-expression` carry `(Line: N, Col: M)`; `missing-template` carries only a file, and
   `unknown-task` carries neither — it identifies job and step instead. A diff harness that
   assumes a parseable position will crash on the last two.
2. **The positional prefix is exactly the format E01-S01-T03 already renders**
   (`<file> (Line: N, Col: M): <message>`, C-E01-007/008), now confirmed against the live
   service rather than against a documentation string.

## Transport-level failures (not reachable via `yamlOverride`)

These two are the dangerous ones, because neither uses the status code you would predict. They
are reproduced by hand-mutating the config rather than by a probe; observed 2026-07-31:

**Invalid PAT → `302`, not `401`/`403`.** The service redirects towards
`https://spsprodweu2.vssps.visualstudio.com/_signin?realm=dev.azure.com&…` with
`content-type: text/html`. A client that follows redirects reports a cheerful **200 containing
an HTML login form** — which is why `preview()` sets `redirect: 'manual'` and treats 3xx as
`unauthenticated` (C-E00-025).

**Nonexistent `pipelineId` → `500`, not `404`.**
`{"typeKey": "PipelineNotFoundException", "message": "The pipeline '999999' does not exist"}`.
So a 5xx from this endpoint is not automatically a transient service fault and must not be
blindly retried (C-E00-026).

## The silent-fallback trap

An **empty or omitted `yamlOverride` returns HTTP 200** — carrying the expansion of the
pipeline's *committed* YAML, i.e. the anchor (`script: echo oracle anchor`), not an error and
not an empty document (C-E00-024). A bug that empties the override therefore produces a
plausible-looking expansion of the wrong pipeline, and a golden fixture generated that way
would be silently, permanently wrong. `preview()` rejects an empty override client-side before
it reaches the wire.
