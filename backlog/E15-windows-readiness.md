# E15 — Windows host readiness (seam now, implementation future)

Phase: seam guard **P2**; implementation **Future** (decision 2026-07-30) · Depends on: E05 · Design: docs/04 §9, PLAN roadmap "Future".
Primary grounding set: docs/04 §9 seam requirement; for the future stories: yaml-schema Windows-relevant pages, `Tasks/CmdLineV2`/`PowerShellV2` Windows code paths, agent Windows handler differences (pin when picked up).

## E15-S01 — As the project owner, the emitter is provably target-OS-abstract from P2, so Windows support later is additive, not a rewrite. (do during P2)
- [ ] **E15-S01-T01 — Emitter backend seam**
  **Do:** `ScriptBackend` interface (script extension, shebang/preamble, path join, env-set syntax, runner invocation) with `BashBackend` as sole impl; all emission goes through it; `PwshBackend` stub throwing "future" with pointer here.
  **Ground:** docs/04 §9 decision text; seam design reviewed against the *differences list* compiled from real sources: collect (and pin) 5 concrete bash-vs-pwsh emission differences from `Tasks/PowerShellV2` vs `Tasks/BashV3` sources to prove the interface covers them.
  **Done:** architecture test: no module outside the backend emits shell syntax (lint rule/grep gate in CI).
- [ ] **E15-S01-T02 — Target-OS plumbing end-to-end**
  **Do:** `pool` inference → job `targetOs` → backend selection → manifest field → coverage warning for Windows-targeted jobs emitted via bash (degraded claim).
  **Ground:** pool/vmImage label list from the hosted-agents doc (…/pipelines/agents/hosted — quote current `vmImage` values; pin).
  **Done:** fixture with mixed-OS stages: correct backend chosen per job; warnings present.

## E15-S02 — As a Windows user, Windows-targeted jobs run natively on my Windows host. (Future — do not start before re-prioritization)
- [ ] **E15-S02-T01 — `PwshBackend` + `runtime.psm1`**
  **Do:** pwsh mirror of the runtime contract (run_step lifecycle, store, `##vso` parsing) with shared conformance tables from E06.
  **Ground:** same doc claims as E06 (IDs reusable) + PowerShell-specific semantics pinned from Microsoft PowerShell docs; `PowerShellV2` task source for preamble parity.
  **Done:** E06 conformance suite passes under pwsh on Windows CI runner.
- [ ] **E15-S02-T02 — cmd semantics for `script:` on Windows + Windows E2E leg**
  **Ground:** `CmdLineV2` Windows code path (pin) for exact cmd invocation; windows-latest CI runner for E2E.
  **Done:** Windows corpus pipeline green on windows CI.
