# E05 — emitter: grounding claims

The emitter's earlier tasks recorded **no** claims on purpose: the service has no filesystem, no
`.env` and no README, so the scaffolder, the step/entry-point emitters and the `.env.example`
synthesizer are internal spec, recorded as decisions in `docs/06` §5 (60–64) rather than as claims.
This file starts with the first emitter task that *does* reproduce a service behavior: the run-number
(`name:`) formatter.

## Claim-ID blocks

| Block | Task | Notes |
| --- | --- | --- |
| `C-E05-001` … `C-E05-049` | E05-S03-T01 — run-number formatter | run-number token table, `Rev` semantics, local deltas |
| `C-E05-050` … | *unallocated* | take a block before numbering on a parallel branch |

---

## Run number / build number (`name:`)

Source, deep-verified 2026-08-25:
<https://learn.microsoft.com/azure/devops/pipelines/process/run-number>
(`git_commit_id` `1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32`, `ms.date` 2025-08-12,
`updated_at` 2026-05-07).

[C-E05-001] The default run-number format, used when a YAML pipeline declares no `name:`, is
  `$(Date:yyyyMMdd).$(Rev:r)`.
  — run-number (checked 2026-08-25)
  — "The default value for an Azure Pipelines run number is `$(Date:yyyyMMdd).$(Rev:r)`."

[C-E05-002] A pipeline that declares no name gets a unique integer as its run name.
  — run-number (checked 2026-08-25)
  — "If you don't specify a build name in YAML pipelines … each run gets a unique integer as its
    name."

[C-E05-003] The run-number format is the **pipeline-level** `name:` property, and `name:` is not
  supported in templates or stages.
  — run-number (checked 2026-08-25)
  — "In YAML pipelines, you can customize the run number format by using the `name` property at the
    pipeline level of the YAML file. The `name` property isn't supported in templates or stages."

[C-E05-004] The run-number tokens are usable **only** in the run number; they resolve nowhere else in
  a pipeline.
  — run-number (checked 2026-08-25)
  — "You can use these tokens only to define run numbers. They don't work anywhere else in a
    pipeline."

[C-E05-005] The run-number token table, verbatim (token → example value):
  `$(Build.DefinitionName)` → `CIBuild`; `$(Build.BuildId)` → `752`; `$(Date:yyyyMMdd)` → `20240506`;
  `$(DayOfMonth)` → `6`; `$(DayOfYear)` → `126`; `$(Hours)` → `21`; `$(Minutes)` → `7`;
  `$(Month)` → `5`; `$(Rev:r)` → `2`; `$(Seconds)` → `3`; `$(SourceBranchName)` → `main`;
  `$(TeamProject)` → `Fabrikam`; `$(Year:yy)` → `24`; `$(Year:yyyy)` → `2024`.
  — run-number (checked 2026-08-25), "Run number tokens" table.

[C-E05-006] The `$(DayOfMonth)`, `$(Month)`, `$(Minutes)` and `$(Seconds)` tokens are **not**
  zero-padded, while `$(Date:yyyyMMdd)` is: the table's own example values are `6`, `5`, `7` and `3`
  for a run at 21:07:03 on 6 May 2024, whose `$(Date:yyyyMMdd)` is `20240506`.
  — run-number (checked 2026-08-25), "Run number tokens" table (derived from the example column).

[C-E05-007] `$(Date:…)` accepts formats other than `yyyyMMdd`; the only second example the page gives
  is `$(Date:MMddyy)`.
  — run-number (checked 2026-08-25)
  — "A date format. You can also specify other date formats, such as `$(Date:MMddyy)`."

[C-E05-008] `$(Rev:r)` is "position in the number of runs that day" and exists to make every
  completed build's name unique; it works **only** in a build-number field.
  — run-number (checked 2026-08-25)
  — "Position in the number of runs that day. Use `$(Rev:r)` to ensure that every completed build has
    a unique name." / "The `$(Rev:r)` revision variable works only in a build number field."

[C-E05-009] `Rev` increments by one when a build completes **if nothing else in the build number
  changes**, and resets to `1` when any other part of the build number changes — the reset is keyed
  on the rest of the rendered number, not on the calendar day.
  — run-number (checked 2026-08-25)
  — "When a build completes, if nothing else in the build number changes, the `Rev` integer value
    increases by one." / "`$(Rev:r)` resets to `1` when any other part of the build number changes."

[C-E05-010] The reset rule covers a version change as well as a date change: with format
  `1.0.$(Rev:r)` and last number `1.0.3`, changing the format to `1.1.$(Rev:r)` makes the next number
  `1.1.1`.
  — run-number (checked 2026-08-25)
  — "`$(Rev:r)` also resets to `1` if you change the version. … if you change the version to
    `1.1.$(Rev:r)`, the next build number is `1.1.1`."

[C-E05-011] Additional `r` characters zero-pad `Rev`: `$(Rev:rr)` produces `01`, `02`, …
  — run-number (checked 2026-08-25)
  — "If you want to show prefix zeros in the run number, you can add more `r` characters to the `Rev`
    token. For example, specify `$(Rev:rr)` if you want the `Rev` number to begin with `01`, `02`."

[C-E05-012] Both predefined and user-defined variables may appear in the run number; the page's own
  example mixes `$(Build.DefinitionName)`, `$(Build.DefinitionVersion)`, `$(Build.RequestedFor)`,
  `$(Build.BuildId)` and a user-defined `$(My.Variable)`.
  — run-number (checked 2026-08-25)
  — "You can use both predefined and user-defined variables in your run number."

[C-E05-013] Time values in the run number are **UTC** on Azure DevOps Services. (On Server they are
  the application-tier machine's local time — out of scope, PLAN: on-prem is not supported.)
  — run-number (checked 2026-08-25)
  — "What time zone are the build number time values expressed in? … The time zone is UTC."

[C-E05-014] A run number is at most 255 characters, may not contain `"`, `/`, `\`, `:`, `<`, `>`,
  `'`, `|`, `?`, `@` or `*`, and may not end with `.`.
  — run-number (checked 2026-08-25)
  — "Run numbers can be up to 255 characters. You can't use the characters … and you can't end the
    number with `.`."

[C-E05-015] When an **expression** sets the run number, `$(Build.BuildId)`, `$(Build.BuildUri)` and
  `$(Build.BuildNumber)` are unusable because their values are not yet set when pipeline expressions
  are evaluated. (Not implemented here and not implementable here: `${{ }}` in `name:` is resolved by
  the service before we ever see the document — PLAN D3.)
  — run-number (checked 2026-08-25)
  — "If you use an expression to set the run number, you can't use the `$(Build.BuildId)`,
    `$(Build.BuildUri)`, or `$(Build.BuildNumber)` tokens, because their values aren't set yet."

[C-E05-016] `Build.BuildId` is the internal, immutable Run ID, unique across the organization —
  a different thing from `Build.BuildNumber`, which is the formatted name.
  — run-number (checked 2026-08-25)
  — "An internal, immutable ID, also called the `Run ID`, that's unique in the Azure DevOps
    organization."

[C-E05-017] A root-level YAML variable is available to every job, while a job-level variable with
  the same name overrides the stage- and root-level values for that job.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/variables (checked 2026-08-25)
  — "At the root level, to make it available to all jobs in the pipeline." / "Variables at the job
    level override variables at the root and stage level."

### E05-S01-T05 grounding composition

C-E04-082/083 establish the full pipeline → stage → job precedence and isolation rule, including
the fact that preview expansion leaves the three blocks for the local runtime to layer. C-E05-017
re-checks the two parts this repair directly encodes: root values reach all jobs, and a job value
shadows its inherited value. The eager metadata-preserving store copy is a local mechanism recorded
in docs/06 §5 decision 68; it introduces no additional Azure behavior or oracle requirement.

### Local deltas (documented deviations, not measured behavior)

The emulator has no server, no organization and no queue, so several things cannot be reproduced
faithfully. Each is a deliberate deviation, recorded here so it is not mistaken for parity:

[C-E05-020] **Δ `Rev` increments at run start, not at run completion.** C-E05-009 ties the increment
  to build *completion*; locally the number must exist before the first step runs (it is
  `Build.BuildNumber`, which steps read), and there is no server to revise it afterwards. Consequence:
  a run that is aborted before its first step still consumes a revision, where the service would not.

[C-E05-021] **Δ `Rev` is keyed on the rendered rest-of-the-number in a single local counter file**
  (`.work/.state/rev`, holding the revision and the key it belongs to). This implements C-E05-009/010
  exactly — any change to any other part resets to `1` — without a server-side history: the store
  remembers one key, so alternating between two formats resets each time rather than resuming each
  format's own series.

[C-E05-022] **Δ `Build.BuildId` is a local monotonic run counter** (`.work/.state/run-counter`, the
  same counter `run.sh` already keeps for its run directory), not an organization-unique Run ID
  (C-E05-016). It is unique within the generated project and nowhere else.

[C-E05-023] **Δ `$(DayOfYear)` is emitted unpadded.** C-E05-006 establishes that the standalone
  numeric tokens are unpadded, but the page's only `DayOfYear` example is `126` — three digits — so
  it does not discriminate padded from unpadded below day 100. Unpadded is chosen for consistency
  with the other standalone tokens; `date -u +%j` is zero-padded to three digits and is therefore
  stripped (`10#` arithmetic, so `008` is not read as octal).

[C-E05-024] **Δ `$(Date:…)` supports a mapped subset of the .NET custom date/time specifiers**
  (`yyyy`, `yy`, `MM`, `dd`, `HH`, `mm`, `ss`), which covers C-E05-001's default and C-E05-007's two
  documented examples. The page documents no grammar, so any other specifier is a conversion warning
  rather than a guess — the emitter refuses to invent .NET format semantics from memory.

[C-E05-025] **Δ Only the documented `Rev:r`/`Rev:rr`/… spelling is supported.** The E05-S03-T01 task
  text also names `$(Rev:.r)`, a Classic-era spelling the page does not document in any form; the
  preview endpoint cannot settle it either, since `name:` is evaluated at queue time and comes back
  as literal text in `finalYaml`. Any `$(Rev:…)` spelling that is not one-or-more `r` characters is
  emitted as a conversion warning and rendered literally, rather than implemented from memory
  (BACKLOG.md §3).

~~[C-E05-026] **Δ The `.env` run-identity override reaches the run number under its `.env`
spelling.** The variable store keys on the variable name as written, folded to lower case
(`azdo__canonical_var_name`), with no dot/underscore mapping — so the `.env` entry
`BUILD_SOURCEBRANCH` that `.env.example` emits (docs/04 §10, decision 63(b)) is stored under that
literal name and is **not** reachable as `Build.SourceBranch`. `azdo_seed_branch_name` therefore
consults both spellings before deriving `Build.SourceBranchName` for the run number. This is a local
patch for one name, not a fix: the general gap — `.env` names never mapping back to their dotted
variable names, and pipeline-scope variables never reaching the `job-<id>` scope steps read from —
is filed as **E05-S01-T04** and **E05-S01-T05**.~~

**Superseded 2026-08-25 by E05-S01-T04 / docs/06 §5 decision 67.** The emitter now carries an exact
`.env` spelling → original variable name alias table into `run.sh`; `BUILD_SOURCEBRANCH` is written
once as `Build.SourceBranch`, and `azdo_seed_branch_name` no longer reads the workaround spelling.
The separate pipeline→job scope gap remains E05-S01-T05.
