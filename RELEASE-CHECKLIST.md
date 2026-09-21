# Release gate

The checklist a release candidate must walk before it is tagged (E11-S05-T02, docs/06 §3).

**Every line names the CI job or artifact that proves it.** That is the whole design: a gate whose
lines are judgements ("tests look fine") cannot be walked by anyone but its author, and cannot be
audited afterwards. A line you cannot resolve to a run id is a line that fails.

**Copy this file into the release issue and fill the `evidence` column in.** Walks are recorded, not
remembered — the first one is `research/release-gate/rc-2026-09-21.md` and is the worked example.

---

## How the six tiers map onto CI jobs

docs/06 §3 defines six test layers; the repo has **three** workflows. The mapping is not one line
per tier, and saying so here is deliberate — a checklist that implies a job per tier is overstating
its own granularity.

| Tier | What it establishes | Where it actually runs |
|---|---|---|
| **L1** expression unit | the function/coercion table, against *both* backends | inside the `test` job (vitest `engine` project + the bats conformance file) — **no job of its own** |
| **L2** expansion goldens | the **offline fallback** agrees with the service's pinned `finalYaml` — re-scoped by E12-S03-T01, so this is conformance, *not* a gate on the shipped path (which is the service's own expansion, PLAN D3) | inside the `test` job — **no job of its own** |
| **L3** service drift | the pinned `finalYaml` still matches what the service returns *today* | `Oracle nightly` workflow, its own schedule |
| **L4** runtime unit | `runtime.sh` behaviours under bats, on ubuntu **and** macOS with bash ≥ 4 | inside the `test` job (the bats half) |
| **L5** E2E | a converted project actually runs in a controlled image; artifacts, exit codes, log markers | `e2e (L5, containers)` job |
| **L6** real-run parity | the same fixture on the **real service** and locally produce the same facts | `Real-run parity (L6)` workflow, manual dispatch only |

So "L1–L4 green" resolves to **one** `test` job matrix plus the nightly, not four separate results.

---

## The checklist

| # | Line | Evidence to record | Resolves to |
|---|---|---|---|
| 1 | **L1/L2/L4 green** on the release commit | `ci.yml` run id + all 4 `test` matrix legs `success` | `gh run list --workflow=ci.yml --branch main` |
| 2 | **L5 green** on the release commit | the `e2e (L5, containers)` job of that same run | `gh run view <id> --json jobs` |
| 3 | **L3 nightly green ≥ 3 consecutive days** | the **three nightly runs immediately preceding** the RC, each `success`, by run id and date | `gh run list --workflow=oracle-nightly.yml` |
| 4 | **L6 spot-check** (majors only) | `Real-run parity (L6)` run id, whose log says `PARITY across N facts`, and its `realrun-report` artifact | `gh run view <id> --log` |
| 5 | **Residual risk stated** | the §"What this gate does not establish" section below, filled in for this RC | this file |

### Line 3 is the one with a trap

"Three consecutive days" means the **three nightlies immediately preceding the RC**, not three green
days found anywhere in the history. And a red nightly must be **triaged**, never waited out: follow
`research/drift-runbook.md`. A lapsed PAT reports as *every corpus entry rejected* with a 302, not
as an auth error (C-E00-025) — so "the nightly is red" and "the service drifted" are different
findings and the runbook separates them.

### Line 4 costs money

`Real-run parity (L6)` is the only job here that spends **hosted-agent minutes on the owner's
organization**, which is why it is `workflow_dispatch` only and why the gate asks for it on majors
rather than every release. It accepts a `reuse_run` input: re-reading a finished run re-validates
the whole CI path — secrets, build, extraction, comparison, artifact upload — for **zero** new
minutes, and is the right way to satisfy this line when an earlier run of the same fixture is still
current.

---

## What this gate does **not** establish

A checklist of green things tells a release manager nothing about what is still dark. These are the
known limits, and they are part of the walk:

- **L6 covers one fixture.** `fixtures/e2e/01-shell-artifacts` only — one pipeline shape. L5 has
  four samples; L6 has one. Parity on it is not parity in general.
- **The corpus is short of its target.** docs/06 §3 asks for ≥ 30 pipelines; `fixtures/corpus/`
  has twelve.
- **Blocked tasks are not deferred work, they are unverified surface.** Most are "built, one Done
  criterion needs a live resource". Count them at walk time (`grep -c '^- \[!\]' backlog/E*.md`)
  and name the epics: the deployment set (E08) and the auth fetchers (E09) are the big ones, and
  both are exactly where a user's real pipeline goes.
- **Open `VERIFY` claims** are behaviour cells recorded as unsettled. List them at walk time
  (`grep -n VERIFY research/*.md`).
- **Known cosmetic defects** carried knowingly — e.g. an unnamed step summarised by its task GUID
  (E11-S05-T03).

A line here is not a blocker. It is what the release notes have to be honest about.
