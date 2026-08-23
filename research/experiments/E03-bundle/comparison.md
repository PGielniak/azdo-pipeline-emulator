# E03-S06-T02 — committed vs mechanically inlined

Is a mechanical splice equivalent to the committed multi-file form? Comparison is on the
**normalized** expansion (`normalizeExpandedYaml`, E03-S05-T01), so formatting is not
mistaken for divergence.

| Shape | committed | inlined | verdict |
|---|---|---|---|
| `plain` | HTTP 200 · expanded | HTTP 200 · expanded | **identical** (normalized) |
| `defaults` | HTTP 200 · expanded | HTTP 400 · rejected · typeKey=PipelineValidationException | **not comparable** — committed: HTTP 200 · expanded; inlined: HTTP 400 · rejected · typeKey=PipelineValidationException |
| `passed` | HTTP 200 · expanded | HTTP 400 · rejected · typeKey=PipelineValidationException | **not comparable** — committed: HTTP 200 · expanded; inlined: HTTP 400 · rejected · typeKey=PipelineValidationException |
| `nested` | HTTP 200 · expanded | HTTP 200 · expanded | **identical** (normalized) |
| `declared-unused` | HTTP 200 · expanded | HTTP 200 · expanded | **identical** (normalized) |
| `shadowed` | HTTP 200 · expanded | HTTP 200 · expanded | **divergent** (normalized) |
