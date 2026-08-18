# E03 iterative-insertion oracle survey

Run on 2026-08-18 with `pnpm each-survey` against the Pipelines preview endpoint, API `7.1`.
Calls are sequential. Every case directory contains the exact `probe.yml`, a redacted raw
`response.json`, the extracted `final.yml` when expansion succeeded, and a short outcome record.

| Probe | Outcome | Claim |
|---|---|---|
| `sequence-scalars` | 200 expanded | C-E03-144 |
| `sequence-objects` | 200 expanded | C-E03-144 |
| `mapping-pair-order` | 200 expanded | C-E03-145 |
| `mapping-numeric-key-order` | 200 expanded | C-E03-145 |
| `mapping-body` | 200 expanded | C-E03-146 |
| `nested-each` | 200 expanded | C-E03-147 |
| `step-list` | 200 expanded | C-E03-148 |
| `job-list-wrapping` | 200 expanded | C-E03-148 |
| `empty-sequence` | 200 expanded | C-E03-149 |
| `collection-expression` | 200 expanded | C-E03-150 |
| `sequence-item-index` | 200 expanded | C-E03-151 |
| `implicit-index-name` | 400 rejected | C-E03-151 |

The eleven successful input/`finalYaml` pairs are promoted to
`fixtures/oracle/directives/each-*.{input,final}.yml` and are permanent parity fixtures. The
rejection is kept here because no `finalYaml` exists for a rejected preview.
