# azdo-pipeline-emulator

Convert any Azure DevOps YAML pipeline into a **self-contained project of local scripts** — same structure, same variable/condition/artifact semantics — so pipelines can be debugged on your machine instead of by push-and-pray.

```
azdo-emu convert azure-pipelines.yml -o ./local-run
cd local-run && cp .env.example .env    # fill secrets / service connections
./run.sh                                # or a single stage, job, or step
```

Resolves templates (including from other Azure DevOps / GitHub repos), multi-repo checkouts and pipeline artifacts at convert time using Azure DevOps interactive sign-in or GitHub auth. Everything secret becomes a documented `.env` entry — never baked into scripts.

**Status: planning → ready to implement.** Start with [PLAN.md](PLAN.md) (architecture, decisions, roadmap). Implementation work is broken down in **[BACKLOG.md](BACKLOG.md)** (session pick-up protocol, grounding rules, epic index → `backlog/E00`–`E15`); primary sources live in [research/REFERENCES.md](research/REFERENCES.md). Detail design docs:

1. [Pipeline model & schema coverage](docs/01-pipeline-model-and-schema.md)
2. [Template & expression engine](docs/02-template-and-expression-engine.md)
3. [Task catalog & handlers](docs/03-task-catalog.md)
4. [Generated project & runtime spec](docs/04-generated-project-and-runtime.md)
5. [Fetching, auth & lockfile](docs/05-fetching-and-auth.md)
6. [CLI, testing & roadmap](docs/06-cli-testing-roadmap.md)

## Development

pnpm monorepo, Node ≥ 22 (`engines`-enforced; pnpm version pinned via `packageManager`).

```
packages/
  cli/      — azdo-emu CLI entry (TypeScript)
  engine/   — YAML front end, expressions, templates, semantic model
  fetch/    — REST fetchers, auth, cache & lockfile
  emit/     — generated-project emitter
  runtime/  — bash runtime library sourced by emitted scripts (bats-tested, shellcheck-clean)
fixtures/   — pipeline YAML fixtures for golden/parity tests
research/   — grounding evidence: claim notes, experiments, REFERENCES.md
```

TypeScript packages are strict-mode, built with tsup (`dist/`, ESM + d.ts), tested with vitest;
`packages/runtime` is plain bash ≥ 4 tested with bats. Everyday commands:

```
pnpm install     # bootstrap workspace (downloads shellcheck binary on first install)
git config core.hooksPath .githooks   # once per clone: pre-commit grounding guard
pnpm build       # tsup build of all TS packages
pnpm test        # vitest unit tests + bats runtime tests
pnpm lint        # eslint + prettier --check + shellcheck (runtime bash)
pnpm typecheck   # tsc --noEmit per package
```

Work is picked up per [BACKLOG.md](BACKLOG.md) §1; every task follows the Grounding Protocol
(§3) — evidence lands in `research/` before implementation.
