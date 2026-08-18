# Directive oracle fixtures

Every `*.input.yml` is the exact `yamlOverride` sent to the Azure DevOps Pipelines preview API;
its matching `*.final.yml` is the returned `finalYaml`. E03-S01 tests compare local expansion with
these service outputs after removing only pipeline shapes outside the directive under test.

The `each-*` fixtures were captured on 2026-08-18 by `pnpm each-survey` and ground
C-E03-144..151. Full redacted request/response transcripts live under
`research/experiments/E03-each/`.
