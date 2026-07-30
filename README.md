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
