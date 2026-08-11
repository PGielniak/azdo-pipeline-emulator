# 06-extends-each-joblist

The governance-template shape: a platform team owns the whole pipeline skeleton via `extends:`,
product teams hand their jobs in as a `jobList` parameter, and mandated steps are wrapped around
whatever they passed. It is the single most template-heavy shape in real use and the hardest for
an expander to get right.

## Exercises

- `extends:` with `parameters:` — the root document contributes **no stages of its own**; the
  entire structure comes from the template.
- A `jobList` parameter carrying full job objects (with `displayName`, `dependsOn`, `steps`).
- The key/value re-emission idiom `${{ each pair in job }}` + `${{ if ne(pair.key, 'steps') }}` —
  copying every property of a passed-in job *except* `steps`, so the template can wrap the steps
  it was given. This forces `each` over a **mapping** (pairs), not just a sequence.
- `- ${{ job.steps }}` splicing a step sequence into the middle of a step list, between a mandated
  pre-step and a mandated post-step.
- A nested template reference (`scan.yml`) *inside* an `each` body, parameterized per iteration.
- `${{ each stage in parameters.deployStages }}` generating whole **stages** from an `object`
  parameter, with `dependsOn` naming a statically-authored stage.
- A conditionally inserted **key** (`${{ if ... }}: condition: ...`) — insertion at mapping level,
  not sequence level.
- A template-level `variables:` block that survives into every generated stage.

## Consumed by

E03-S01-T02/T03/T04 (conditional insertion, `each` over sequences *and* mappings, `${{ insert }}`
semantics), E03-S02-T03 (`extends`), E04 (stages synthesized by iteration), E01-S02-T02.
