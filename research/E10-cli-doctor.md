# E10 — CLI, config & doctor: grounding claims

## Claim-ID blocks

| Block | Task | Notes |
| --- | --- | --- |
| `C-E10-001` … `C-E10-029` | E10-S04 doctor | |

---

## E10-S04-T01 — the doctor probe table (`C-E10-001..006`)

Recorded 2026-09-02. The Ground field asks that **each probe command be cited from the tool's own
docs**, because a doctor that invents a version command reports a missing tool that is installed.
Two of the five are additionally confirmed against the local installations.

[C-E10-001] **`az version` prints JSON with the CLI version under the key `azure-cli`.** The
command's own help: "az version : Show the versions of Azure CLI modules and extensions in **JSON
format by default** or format configured by --output." Confirmed live against Azure CLI 2.89.1,
which printed `{"azure-cli": "2.89.1", "azure-cli-core": "2.89.1", …}`. **`az --version` is *not*
used**: it prints prose plus warnings, and parsing it would break on the "You have N update(s)
available" banner this machine emits.
  — `az version -h` (Azure CLI 2.89.1, checked 2026-09-02) and
    https://learn.microsoft.com/en-us/cli/azure/reference-index?view=azure-cli-latest
    (`git_commit_id` `8b680860f395c637c57e0feeee26c7d4735b2776`)

[C-E10-002] **`docker version --format '{{.Client.Version}}'` prints the client version alone.**
`docker version --help`: "-f, --format string   Format output using a custom template". Confirmed
live: `29.7.2` on one line. The **client** field is the one to read — a `docker version` with no
daemon still reports the client, so a probe that read the server version would call Docker missing
whenever the daemon is merely stopped.
  — `docker version --help` (Docker 29.7.2, checked 2026-09-02)

[C-E10-003] **`kubectl version --client -o json` reports the client without contacting a cluster.**
`--client` is what keeps the probe offline; without it `kubectl version` attempts to reach the API
server and a doctor run would hang or fail on an unreachable cluster rather than on a missing
binary. Version is under `.clientVersion.gitVersion`.
  — https://kubernetes.io/docs/reference/kubectl/generated/kubectl_version/ (checked 2026-09-02).
    **Not confirmed live: `kubectl` is not installed on this machine** (C-E10-006).

[C-E10-004] **`helm version --template '{{.Version}}'` prints the version alone**, and
`helm version --short` prints it with a leading `v` plus a build-metadata suffix. The template form
is preferred for the same reason as docker's: one value, no parsing.
  — https://helm.sh/docs/helm/helm_version/ (checked 2026-09-02).
    **Not confirmed live: `helm` is not installed** (C-E10-006).

[C-E10-005] **`pwsh -v` prints `PowerShell <version>`.** A single line, so the version is the second
whitespace-separated field.
  — https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh
    (checked 2026-09-02). **Not confirmed live: `pwsh` is not installed** (C-E10-006).

[C-E10-006] **Scope note — three of the five probes are doc-grounded only.** `az` and `docker` are
installed here and their output was captured; `kubectl`, `helm` and `pwsh` are not, so their command
shapes rest on vendor documentation rather than measurement. Recorded rather than implied, because
"probe table tests with canned outputs" (the Done criterion) is satisfied either way and the
distinction matters if one of the three ever changes its output format. **To close it:** install the
three and re-run the probes.

## Live verification of the shipped engine (2026-09-02)

Run through `packages/cli/src/doctor/probe.ts` against this machine, which has `az` and `docker`
installed and `helm`/`kubectl`/`pwsh` absent — the four statuses in one run:

```text
[missing] helm
    needed by: deploy/web/030
    → https://helm.sh/docs/intro/install/ — or `curl … get-helm-3 | bash`
[?]       terraform
    needed by: deploy/web/040
    → azdo-emu has no version probe for `terraform`; check it yourself before running.
[ok]      az 2.89.1 (needs ≥ 2.0.0)
[ok]      docker 29.7.2 (needs ≥ 20.0.0)

Some tools need attention.        ok=false
```

The two versions match the canned fixtures the unit tests use byte for byte (`2.89.1`, `29.7.2`),
which is the point of running it: the tests would still pass if the probe *commands* were wrong, and
this shows they are not. `terraform` is deliberately in the fixture to exercise the `unprobed`
path — the doctor says it does not know rather than assuming the tool is fine.

---

## E10-S04-T02 — the doctor↔task contract (`C-E10-007..010`)

Recorded 2026-09-02.

[C-E10-007] **`AzureCLIV2` resolves `az` on PATH itself**, which is direct evidence of the
requirement rather than an inference from the task's name: `const azPath = tl.which('az', false);`.
Its login arguments in the same file also re-confirm C-E08-006/009 —
`login --service-principal -u "…" …="…" --tenant "…" --allow-no-subscriptions`.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/093f47b9598eb48af6a972dbc2b223c244b344b9/Tasks/AzureCLIV2/azureclitask.ts
    (L367; checked 2026-09-02)

[C-E10-008] **`minimumAgentVersion` is an *agent* version and must never become a tool minimum.**
Measured across the priority set's `task.json` files: `AzureCLIV2` declares `2.0.0`, `DockerV2`
`2.172.0`, `AzurePowerShellV5` `2.115.0`, while `HelmDeployV0` and `KubernetesManifestV1` declare
none. These are versions of the *Azure Pipelines agent*, not of `az`, `docker` or `pwsh` — reading
`2.172.0` as "Docker ≥ 2.172.0" would demand a version of Docker that has never existed and report
every installation as outdated. **This is precisely the invention the task's Ground field forbids
("doctor never invents versions").**
  — the five `task.json` files at the pin above; checked 2026-09-02

[C-E10-009] **No task in the priority set declares a minimum version for the CLI it shells out to.**
`demands` is empty (`[]`) on all four that carry the field, and none of the five states a CLI
version anywhere in its manifest. **Consequence:** every requirement this contract registers carries
**no `min`** — the doctor reports presence, not a version floor, until a task research note supplies
a real one. That is the honest reading of "requirement values cite the task research notes"; the
alternative is a fabricated floor that fails working setups.
  — same five `task.json` files

**Addendum 2026-09-03 (E11-S04-T02) — enforcement of C-E10-008/009 is split across two places,
deliberately.** `checkToolContract` rejects a `min` whose `because` does not match
`/C-E\d{2}-\d{3}/`. That is a **shape** check, not an existence check: it proves the floor cites
*something claim-shaped*, and it cannot prove the claim exists, because the contract has no business
reading `research/` at runtime. The gap was not theoretical — the contract's own tests cited
`C-E08-042` and `C-E08-043`, invented ids inside an *unallocated* block, and passed. The existence
half now lives in `scripts/claim-coverage.sh`, where a test citing an undefined claim is an
**orphan** and fails `--check` outright (docs/06 §5 decision 77). Anyone tightening "doctor never
invents versions" should change the repo-level gate, not teach the contract to read the research
notes.

[C-E10-010] **The contract is ours: a task that shells out must declare the tool.** No source
requires this — it is the check the Do field asks for ("CI check: every task declaring CLI calls
declares requirements"), and it exists so a task added later cannot silently become a step that
fails at run time with `command not found` instead of failing the doctor before the run.
  — project policy; no source claims otherwise
