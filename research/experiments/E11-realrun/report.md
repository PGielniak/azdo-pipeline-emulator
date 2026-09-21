# L6 — the same fixture on the real service and locally (E11-S05-T01)

Every tier below this one compares the emulator against itself. This one runs
`fixtures/e2e/01-shell-artifacts/` — **the L5 fixture, read from its own path rather than
copied**, so the two tiers cannot drift — on the real service and locally, and diffs three
classes of fact.

- Service run: id 553, result `succeeded`
- Artifact route (measured, not assumed): `build/builds/{id}/artifacts?artifactName=drop -> resource.downloadUrl (PipelineArtifact)`
- Facts compared: 13
- **PARITY**

## Timeline records the comparator dropped

Listed by exact name and counted. A record matching neither an authored step nor this list is
**an error, not a drop** — a loose filter would also swallow a real step whose name shifted,
and the report would then claim a parity it had not measured.

- `Finalize Job` ×2
- `Checkout oracle@main to s` ×1
- `Initialize job` ×2
- `Post-job: Checkout oracle@main to s` ×1
- `Post-job: Checkout` ×1

## Step results

| step | service | local |
|---|---|---|
| `verify[0]` (service “Checkout”, local “6d15af64-176c-496d-b583-fd2ae21d4df4”) | `skipped` | `Skipped` |
| `verify[1]` (service “Download”, local “30f35852-3f7e-4c0c-9a88-e127b4f97211”) | `succeeded` | `Succeeded` |
| `verify[2]` “Confirm the output variable crossed and the artifact arrived” | `succeeded` | `Succeeded` |
| `compile[0]` “Stage build output” | `succeeded` | `Succeeded` |
| `compile[1]` “Publish the staged directory” | `succeeded` | `Succeeded` |

## Markers (the fixture’s variable dump)

| marker | service | local |
|---|---|---|
| `E2E-MARKER cross-job output variable is app` | yes | yes |
| `E2E-MARKER downloaded artifact content is built` | yes | yes |
| `E2E-MARKER job variable wins greeting=hello-from-job` | yes | yes |
| `E2E-MARKER pipeline variable stageLabel=build-stage` | yes | yes |
| `E2E-MARKER staged build.txt` | yes | yes |

## The negative: jobs that must not run, markers that must not appear

Asserted, not inferred from an empty union. A job that does not run contributes no steps to
either side, so a comparison keyed on what *is* present would report parity by **mutual
absence** — the same error the unexpected-record guard prevents, on the negative side.

- Jobs that did not run — service: `must_not_run`, local: `must_not_run`
- Forbidden marker `E2E-MARKER must not appear` — service: absent, local: absent

## Artifact contents (sha256 per path, never archive bytes)

| path | service | local |
|---|---|---|
| `build.txt` | `56f6e6304d02d413` | `56f6e6304d02d413` |

## Every timeline record

| type | name | result |
|---|---|---|
| `Task` | `Finalize Job` | `succeeded` |
| `Task` | `Checkout oracle@main to s` | `succeeded` |
| `Phase` | `compile` | `succeeded` |
| `Task` | `Initialize job` | `succeeded` |
| `Task` | `Checkout` | `skipped` |
| `Task` | `Stage build output` | `succeeded` |
| `Task` | `Publish the staged directory` | `succeeded` |
| `Job` | `compile` | `succeeded` |
| `Task` | `Download` | `succeeded` |
| `Task` | `Confirm the output variable crossed and the artifact arrived` | `succeeded` |
| `Job` | `verify` | `succeeded` |
| `Task` | `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Task` | `Finalize Job` | `succeeded` |
| `Phase` | `verify` | `succeeded` |
| `Phase` | `must_not_run` | `skipped` |
| `Task` | `Post-job: Checkout` | `succeeded` |
| `Stage` | `build` | `succeeded` |
| `Task` | `Initialize job` | `succeeded` |
| `Checkpoint` | `Checkpoint` | `succeeded` |
