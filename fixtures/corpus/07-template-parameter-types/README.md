# 07-template-parameter-types

The parameter **type system**, exercised type by type, with each parameter both defaulted and
overridden so binding and defaulting are separately observable.

## Exercises

- Runtime (`parameters:` at pipeline level, with `displayName` and `values:` allowed-value lists)
  *and* template parameters of the same names — the two are different features that look alike.
- Types: `string` (with `values:`), `number` (with `values:`), `boolean`, `object` (nested
  mapping + list), `step` (a single step object), `stepList`. Complex defaults included.
- A `step`-typed parameter passed as a **script step** in one instantiation and as a **task step**
  in the other — same slot, structurally different values.
- Object indexing by path in a template expression: `parameters.settings.nested.key`.
- `${{ each tag in parameters.settings.tags }}` iterating a list *nested inside* an object
  parameter.
- Splicing forms side by side: `- ${{ parameters.customStep }}` (single step) versus
  `${{ each step in parameters.extraSteps }}` + `- ${{ step }}` (list).
- A parameter in a position that is not a string: `retryCountOnTaskFailure:
  ${{ parameters.retries }}` (number) and `${{ if parameters.verbose }}` (bare boolean
  truthiness, no `eq()`).
- A parameter used to build an **identifier** — `job: typed_${{ parameters.jobSuffix }}` — so a
  second instantiation must produce a differently-named job or the pipeline is invalid.
- Template functions over collections: `length()` and `join()`.
- A jobs template (`type: jobList` consumer at the `jobs:` level), complementing 05's steps
  template and 06's `extends`.

## Consumed by

E03-S02-T02 (typed parameter binding, coercion, defaults), E03-S01-T05 (scalar interpolation into
identifiers and non-string positions), E02 (`length`, `join`, truthiness), E01-S02-T02.
