# E03-S04-T03 — does the service reject what our strict validator rejects?

Each row injects one mutation into a **known-good expansion** (a committed corpus
`final.yml`, which the service itself produced), so the mutation is the only difference
between an accepted and a rejected document. A row that comes back *accepted* is a
diagnostic family we must not raise as an error on an expanded document.

| Mutation | Our family | Outcome | Verdict |
|---|---|---|---|
| `unknown-key` | `SCHEMA_UNKNOWN_KEY` | HTTP 400 · rejected · typeKey=PipelineValidationException | **rejected** — the service agrees |
| `bad-type` | `SCHEMA_TYPE` | HTTP 400 · rejected · typeKey=PipelineValidationException | **rejected** — the service agrees |
| `unknown-task` | `SCHEMA_UNKNOWN_TASK` | HTTP 400 · rejected · typeKey=PipelineValidationException | **rejected** — the service agrees |
