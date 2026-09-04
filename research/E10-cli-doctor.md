# E10 — CLI, config & doctor: grounding claims

## Claim-ID blocks

| Block | Task | Notes |
| --- | --- | --- |
| `C-E10-001` … `C-E10-029` | E10-S04 doctor | |
| `C-E10-030` … `C-E10-049` | E10-S03 auth UX | |

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

---

## E10-S03-T01 — `auth login` / `auth status` UX (`C-E10-030..034`)

Recorded 2026-09-04. This is a UX task over E09's implementations, so its grounding is **this
repository's own code plus one live walkthrough** — the Ground field asks for "E09-S01
implementations + their pinned sources", and the four claims below are what reading them changed.

[C-E10-030] **`authStatus` consults only the credential *store*, and nothing in this repository ever
writes it — so `auth status` would have answered "signed out" for every user alive.**
`authStatus(orgUrl, options)` did `store.load(normalized)` and returned `{ kind: 'signed-out' }` when
that missed. `AzureCredentialStore.save()` exists and has **no production caller**: the only arm that
would write it is the device-code flow, which is E09-S01-T01 and unbuilt. Meanwhile a user with
`AZDO_PAT` set is authenticated perfectly well — and per C-E09-023 that is the *default* case, not an
edge one. **Consequence:** `AuthStatusOptions` gains a `credential` field so the CLI can probe the
credential `selectAzureCredential` actually returns. The alternative — re-deriving the 302/401/403
mapping in the CLI — would have duplicated grounded E09 logic in an unguarded place.
  — `packages/fetch/src/auth/status.ts`, `storage.ts`; `grep -rn '\.save(' packages/*/src` returns
    nothing outside tests (checked 2026-09-04)

[C-E10-031] **`auth login` cannot cache a token, and for the working arm it should not.** Its
description was "sign in and cache a refresh token". No implemented arm writes the store (C-E10-030);
the `az` arm reuses a session `az login` created, and the `pat` arm reads an environment variable —
**caching that one to disk would persist a secret the user chose to keep in their environment**,
which is a decision the tool has no business making for them. **Consequence:** the command's honest
job is *select, probe, report* — which mode works, which declined and why — and its description now
says that. Recorded as a Do-field correction (decision 83) rather than implemented as promised.
  — same modules; `select.ts` `tryInteractive` is the sole `options.store` reader (checked 2026-09-04)

[C-E10-032] **The auto chain picks a mode this organization refuses while a working one sits in the
same environment — measured, and the reason `auth status` probes further.** `AUTH_MODE_ORDER` is
`interactive → az → pat`, so an existing `az` session wins selection. Against the test organization
that token is rejected with **HTTP 302** (C-E09-022, an MSA-backed org) while the `AZDO_PAT` in the
same shell returns **200** on the same URL seconds later. **Consequence:** reporting only the refusal
would tell a user who *can* authenticate that they cannot. On a rejection the command probes the
remaining modes and, when one authenticates, prints `works --mode pat …` and makes that the hint.
Deliberately a *report*, not a change to selection: `convert` uses `selectAzureCredential`'s answer,
so silently reporting a different mode would make this command disagree with the tool it explains.
  — live walkthrough, `research/experiments/E10-auth/walkthrough.md` (2026-09-04)

[C-E10-033] **There is no GitHub sign-in to front, and none is planned.**
`resolveGitHubCredential` has three arms — `gh-cli`, `env`, `anonymous` — and `github.ts`'s own
header records that "OAuth device flow is deferred there until demand, so this module has three arms
and no more". **Consequence:** the Do field's "`--github` variant" is an invented surface for
`login` and is refused with what to do instead; it survives on **`status`**, where reporting which of
the three arms supplied the credential is real, testable UX. `anonymous` is reported as a *working*
state — public templates resolve without a token — so it never fails the command.
  — `packages/fetch/src/auth/github.ts` (module header, `resolveGitHubCredential`) (checked 2026-09-04)

[C-E10-034] **"Non-tty behaviour" here is the absence of terminal-dependent output, not a fallback
for it.** The Do field asks for a spinner; the only thing that would justify one is polling the
device-code endpoint, and that flow does not exist (E09-S01-T01). Every other operation is a single
request. **Consequence:** the command emits plain lines and no ANSI escape on a TTY *or* off it —
tested by asserting the absence of `\x1b` in both streams — and the data/diagnosis split does the
work a spinner would not: the table goes to stdout so `auth status | grep mode` works, the verdict to
stderr through the CLI's one error path.
  — `packages/cli/test/auth.test.ts` (checked 2026-09-04)

---

## E10-S04-T01 — the `doctor` command wiring (`C-E10-035..036`)

Recorded 2026-09-04, completing the task whose engine landed 2026-09-02. The probe table, version
comparison, remediation and report were done and tested then; the blocker note said what remained
was "the `--json` flag and the CLI wiring that reads `manifest.json` `tools[]`". One of those two
turned out to be a defect rather than a call site.

[C-E10-035] **`manifest.json`'s `tools[]` was always empty, so the command it exists for would have
been confidently wrong.** `aggregateTools` shipped with E10-S04-T02's contract and had **no
caller**: `buildManifest` in `packages/cli/src/convert/convert.ts` passed `expansion`, `env` and
`warnings` to `serializeManifest` and nothing else, and `ManifestOptions.tools` defaults to `[]`.
**Consequence:** `doctor` would have reported "This pipeline needs no external tools" for a project
full of `az`, `kubectl` and `helm` steps — a wrong answer stated with confidence, which is worse
than the `NotImplementedError` it replaced. This is the **third** instance in this repository of a
module built, tested, and never called: the others are `resolveTaskInputs` (C-E08-073) and the
device-code arm's `AzureCredentialStore.save()` (C-E10-030). Convert now calls it, and the proof is
end to end rather than structural: a two-step pipeline is converted for real and its manifest is
read back, then handed to `doctor`.
  — `packages/cli/src/convert/convert.ts` `buildManifest`;
    `packages/engine/src/model/manifest.ts` (`tools: options.tools ?? []`);
    `packages/cli/test/doctor-command.test.ts` (checked 2026-09-04)

[C-E10-036] **An absent `tools[]` and an empty one mean different things, and only one of them is an
answer.** The manifest schema makes `tools` optional. **Empty** means the pipeline genuinely uses no
task that shells out — common, and a real result. **Absent** means the manifest predates this field,
i.e. a project generated by an older build. **Consequence:** treating the two alike would reproduce
C-E10-035's failure for exactly the projects most likely to hit it, so `readManifestTools` refuses
an absent `tools[]` and says to re-run `convert`, while an empty one prints "This pipeline needs no
external tools." Both messages name the directory, because every failure on this path is the user
having pointed at something that is not a generated project.
  — `packages/engine/schema/manifest.schema.json` (`tools` is not in `required`);
    `packages/cli/src/doctor/command.ts` (checked 2026-09-04)
