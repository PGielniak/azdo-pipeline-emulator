# L5 end-to-end samples

Sample pipelines converted and **run** inside a container that approximates a hosted ubuntu runner
(docs/06 §3, tier L5). `MANIFEST.json` says what each one must produce.

## Why these are not in `fixtures/corpus/`

`fixtures/corpus/` is oracle-bound: `fixtures/golden/MANIFEST.json` pins a `finalYamlSha256` per
entry, `scripts/corpus-oracle.ts` is the only thing allowed to talk to the service (decision 74),
and the nightly drift job re-`preview`s every entry. An L5 sample would inherit all of that for no
benefit — **L5 asks whether the generated project runs, not whether the expansion is faithful.**
Those are different questions with different failure modes, and mixing them would make a lapsed PAT
turn the E2E job red for a reason unrelated to E2E.

For the same reason every sample here is **template-free**: no `${{ }}`, no `extends`, no template
references. The offline expander and the service produce the same document for them, so the suite
converts with `--offline-expand` and needs no credentials at all.

## What each sample is for

| Sample | Image | Exercises |
|---|---|---|
| `01-shell-artifacts` | base | artifact publish/collect, `##vso[task.setvariable isOutput=true]`, `dependencies.*` across jobs |
| `02-node-app` | node | a real toolchain — `npm install`, `npm test` — and an artifact built from its output |
| `03-failure-and-conditions` | base | `continueOnError`, `condition: failed()`, and the **exit code** of a run that fails |

The third is the one a green-only suite cannot replace: it asserts the *shape* of a failing run,
including markers that must be **absent**, and pins the exit code — which `drift.ts` Phase B
deliberately only records, because on a hosted runner the toolset decides it (decision 75). Inside
a controlled image it is a fact about the runtime.
