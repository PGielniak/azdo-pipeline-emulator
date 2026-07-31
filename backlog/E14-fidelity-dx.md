# E14 — Fidelity & DX: real-task mode, sandbox, container jobs, parallelism, debug shell

Phase: P6, except E14-S04-T01/T02 (sandbox wrapper) which run at P2 tail per BACKLOG §5 · Depends on: E09 (registry), E06 (runtime), E08 (task download); E14-S04-T01/T02 need only E05+E06 · Design: docs/03 §6, docs/04 §2 & §9, PLAN D11
Primary grounding set: `microsoft/azure-pipelines-task-lib` `node/` (the host protocol we must emulate — env contract, command protocol, tool cache) · `microsoft/azure-pipelines-agent` handlers (`src/Agent.Worker/Handlers` — NodeHandler; pin) · container-jobs doc (…/process/container-phases) · service-containers doc (…/process/service-containers).

## E14-S01 — As a pipeline developer, I can opt a task into running its *real* implementation locally, so complex tasks behave byte-faithfully.
Acceptance: Node task host per docs/03 §6, opt-in per task via config.

- [ ] **E14-S01-T01 — Task package acquisition**
  **Do:** download+cache task zips per version via the DistributedTask tasks endpoint (E08-S03-T05); integrity note in lockfile; license note (in-box tasks MIT — record; marketplace zips cached per-org only, never redistributed).
  **Ground:** live download samples (route + zip layout committed as listing); zip layout claims vs a pinned in-box task's repo folder (should match `Tasks/<X>` structure).
  **Done:** fixture task zip cached & unpacked; lockfile entries.
- [ ] **E14-S01-T02 — task-lib host emulation**
  **Do:** runner invoking the task's Node target with: `INPUT_*`/`ENDPOINT_*`/`SECRET_*`/`SECUREFILE_*` env (exact encodings), agent well-known env (`AGENT_TEMPDIRECTORY`, `AGENT_TOOLSDIRECTORY`, `SYSTEM_DEFAULTWORKINGDIRECTORY`, …), stdout `##vso` flowing into our E06 parser, exit-code → result rules.
  **Ground:** task-lib `node/task.ts` + `node/internal.ts` — pin every env-name transform and variable-read path we emulate (`getInput`, `getVariable`'s env fallback, `getEndpointAuthorization*`); agent NodeHandler (pin) for the env the agent actually sets and node version selection; each emulated var = one claim.
  **Done:** `CmdLineV2` and `CopyFilesV2` real packages run under the host with outputs identical to our transpiled handlers on the same fixtures (differential test).
- [ ] **E14-S01-T03 — Config & emission integration (`tasks.execute`)**
  **Do:** per-task opt-in switches emission to a host-invoking step (requires Node at runtime — README warning per docs/03 §6); coverage tier for hosted tasks = `exact` with claim referencing the differential test.
  **Ground:** the `exact` tier claim must cite the E14-S01-T02 differential-test artifact for that task (no differential run → no `exact` tier); Node runtime version requirement cited from the agent NodeHandler's node-selection code pinned in T02.
  **Done:** e2e: same pipeline converted twice (transpile vs execute) both green; README warning present; tier claim links resolve.

## E14-S02 — As a pipeline developer, container jobs and service sidecars run via Docker, so containerized pipelines work locally.
- [ ] **E14-S02-T01 — Container job runtime**
  **Do:** job container lifecycle (`docker create/start` long-running, steps via `docker exec` with per-step env file), workspace bind-mount **at identical absolute paths**, image pull policy, `options`/`env`/`mapDockerSocket` inputs, registry auth from `.env` (resources.containers endpoints).
  **Ground:** container-phases doc (quote: what the agent mounts and how steps execute in the container) + agent container implementation (locate `ContainerOperationProvider` in agent repo; pin the mount/exec logic — mirror the documented mounts we can support, list deltas).
  **Done:** bats+docker: fixture container job green; mount/env parity claims tested; deltas in coverage gaps.
- [ ] **E14-S02-T02 — `services:` sidecars + `step.target`**
  **Do:** shared network, alias resolution, readiness note (no health gating unless documented — verify), per-step `target:` routing host/container.
  **Ground:** service-containers doc (quote ports/volumes/alias semantics); step `target` from yaml-schema page.
  **Done:** fixture: app container + postgres sidecar test passes; target-routing bats.

## E14-S03 — As a pipeline developer, waiting and debugging get first-class tools, so local iteration is strictly better than cloud iteration.
- [ ] **E14-S03-T01 — `--parallel` job scheduler**
  **Do:** run independent jobs concurrently (bounded), interleaved-log strategy (prefixed lines + separate files), deterministic summary; `maxParallel` honored for matrices.
  **Ground:** dependency semantics claims from E04-S03-T02 (cite); `maxParallel` from jobs doc (quote).
  **Done:** bats: diamond graph timing test; logs readable; failure propagation per claims.
- [ ] **E14-S03-T02 — `--shell-at <step>`**
  **Do:** materialize the exact step env (vars, PATH, cwd, masked-secret handling choice documented) and exec `$SHELL`; banner shows step context.
  **Ground:** env-materialization claims from E06-S01-T02 (cite — same code path, no divergence allowed: guard test).
  **Done:** manual walkthrough + automated env-diff test (shell env ≡ step env).
- [ ] **E14-S03-T03 — Masking & UX hardening pass**
  **Do:** masker perf on large logs, multi-secret overlap ordering, `##[group]` folding renderer, `--verbose`/`System.Debug` polish.
  **Ground:** agent SecretMasker behaviors already claimed in E06-S06-T01 (extend claims for overlap ordering from its source; pin).
  **Done:** perf budget test (≥ 50MB log < 10s overhead); overlap tests.

## E14-S04 — As a pipeline developer, my whole local run executes inside an isolated sandbox container by default, so debugging never pollutes my host and the environment approximates the hosted agent. (D11, decided 2026-07-30. T01/T02 run at P2 tail — they need only E05+E06; T03 lands with E14-S02 at P6.)
Acceptance: dogfood pipeline green under `--sandbox` with state/logs/artifacts identical to a `--host` run; nothing installed on or exported to the host; `--host` remains first-class.

- [ ] **E14-S04-T01 — Whole-run sandbox wrapper (`lib/sandbox.sh`)**
  **Do:** all entry points accept `--sandbox|--host` (default `auto`: sandbox when docker/podman detected and job target-OS is linux; fallback to host with a one-line notice). Wrapper creates/starts **one long-lived container per run**, bind-mounts the project root at the identical absolute path, mounts a named volume over the tool cache (`Agent.ToolsDirectory`), preserves TTY, then re-execs the same entry point inside; `--only-step`/`--resume`/`--shell-at` `exec` into the same container; `.env` sourced only inside. Plain bash, no converter dependency (D2).
  **Ground:** docker engine CLI reference (`container create/start/exec`, bind mounts) + podman equivalents — pin doc pages in `research/E14-fidelity-dx.md`; internal: PLAN D11 + docs/04 §9 (no ADO behavior is emulated here — record that explicitly as the scope note).
  **Done:** bats+docker: fixture project runs green with `--sandbox` and its `.work/` state, logs and artifacts are equivalent to a `--host` run (diff test); auto-fallback notice asserted; `--sandbox` without a runtime = clear error; shellcheck-clean.
- [ ] **E14-S04-T02 — Sandbox image selection, `environment/Dockerfile`, `doctor --sandbox`**
  **Do:** default `vmImage`→image mapping (ubuntu-latest first) with config `output.execution.image` / `--sandbox-image` override; optional emitted `environment/Dockerfile` seeded from manifest `tools` entries; chosen image+digest recorded in `manifest.json` + lockfile; `doctor --sandbox` runs its checks inside the image.
  **Ground:** `actions/runner-images` ubuntu manifest (what hosted images actually preinstall — pin commit); evaluate nektos/act's hosted-approximation images as default candidates (pin repo + image list; record the decision with rationale as claims); hosted-agents doc page (REFERENCES).
  **Done:** default-image decision recorded as claims; converted fixture pins image+digest in manifest+lockfile; doctor-in-sandbox bats test; generated README documents image provenance and override path.
- [ ] **E14-S04-T03 — Docker-using pipelines inside the sandbox (socket policy; composition with container jobs)**
  **Do:** `output.execution.dockerSocket: auto|share|none` — `share` mounts the host socket so `Docker@2`/container jobs become sibling containers (path-correct via the host-backed project mount); `auto` shares only when the manifest says the pipeline needs docker, emitting a README + coverage warning stating the isolation tradeoff; `none` degrades docker-dependent steps with remediation notes. Verify the E14-S02 container-job lifecycle works from inside the sandbox.
  **Ground:** cite E14-S02-T01 mount/exec claims (same machinery); docker docs on socket mounting (pin); DinD alternative explicitly evaluated with the accept/reject rationale recorded (VERIFY → experiment if pursued).
  **Done:** fixture with a `Docker@2` build green in sandbox under `share`; `none` produces documented degraded steps; warnings present in README + coverage report; sibling path-correctness bats test.
