# E06-S03-T01 — shell-step default working directory (real run)

This hosted Ubuntu probe separates `Build.SourcesDirectory` from
`System.DefaultWorkingDirectory`: two checkouts use custom paths and the second checkout is marked
`workspaceRepo: true`. The repository name is redacted in the committed YAML.

- Probe pipeline: `oracle-run-step-wd-probe` → `/experiments/run-step-wd.yml`
- Run: id 542, state `completed`, result `succeeded`
- Resource authorization: the probe pipeline was authorized only for the duplicated oracle
  repository after the first run reached the protected-repository checkpoint.

## Probe YAML

See `working-directory.yml` beside this transcript.

## Relevant log lines

```text
CASE bash PWD=/home/vsts/work/1/repo/workspace BUILD=/home/vsts/work/1/s SYSTEM=/home/vsts/work/1/repo/workspace
CASE script PWD=/home/vsts/work/1/repo/workspace BUILD=/home/vsts/work/1/s SYSTEM=/home/vsts/work/1/repo/workspace
CASE pwsh PWD=/home/vsts/work/1/repo/workspace BUILD=/home/vsts/work/1/s SYSTEM=/home/vsts/work/1/repo/workspace
```

## Interpretation

- The default current directory for all three inline shell shortcuts equals
  `System.DefaultWorkingDirectory` when that variable is retargeted by `workspaceRepo: true`.
- It does not equal `Build.SourcesDirectory` in this case. The Bash@3, CmdLine@2, and PowerShell@2
  reference pages' `Build.SourcesDirectory` default sentence is therefore incomplete for current
  Azure DevOps Services behavior.
- This confirms the existing `run_step` design default rather than requiring a design correction.

Checked 2026-08-19 with credentials loaded from the ignored `.env.oracle`; no token, organization,
project, requester, or repository identity is stored here.
