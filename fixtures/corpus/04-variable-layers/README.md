# 04-variable-layers

Every variable mechanism in one pipeline, arranged so the **precedence** between layers is
observable rather than asserted: the same name (`solution`, `buildConfiguration`) is defined at
more than one level and printed where the layers meet.

## Exercises

- Both `variables:` forms — the mapping form (stage/job) and the `- name:/value:` list form
  (pipeline level, which is the only form that can also carry `readonly:` or `- group:`).
- Layer precedence: pipeline → stage → job for the same name.
- `readonly: true` on a pipeline variable that a *stage* then redefines. The service's verdict:
  it **expands without complaint and keeps both** — the readonly pipeline variable and the stage
  variable that overrides it (C-E12-023). `readonly` is therefore a run-time property, not a
  compile-time constraint, and the expanded document is not a resolved variable table.
- The three syntaxes side by side: macro `$(x)`, compile-time `${{ variables.x }}`, runtime
  `$[ counter(...) ]`. The compile-time read is placed inside a job that overrides the name, and
  the answer is not the obvious one: it resolves to the **job-level** value (C-E12-024), so the
  template-expression `variables` context is layered rather than a pipeline-level snapshot.
- `$$(...)` escaping directly beside a real macro (`$(Build.BuildId)`) — the "unmatched literal"
  case docs/04 calls out for the runtime's macro pass.
- Variables surfacing as **environment variables** in a `bash:` step (`$SOLUTION`,
  `$BUILDCONFIGURATION`: upper-cased, dots to underscores), plus step-level `env:` including one
  whose value is itself a macro.
- `task.setvariable` without `isOutput` read by a later step **in the same job** (the other half of
  fixture 03, which covers the cross-job case).
- A parameter feeding a variable (`${{ parameters.environmentName }}`) and a `format()` template
  expression producing one.
- `name:` — the build-number format with `$(Date:...)`/`$(Rev:.r)`, whose tokens are a different
  substitution language from step macros.
- `- group:` — a variable group reference in the pipeline-level list. PLAN D5 emits group *names*
  into `.env.example` and never fetches values, so what the converter needs from a group is
  exactly what is visible here.

## Precondition: the group must exist

The service rejects an unknown group **before parsing finishes**: *"An error occurred while
loading the YAML build pipeline. Variable group  was not found or is not authorized for use."*
(C-E12-015) — so this entry only has an oracle pair because `scripts/oracle-provision.ts` created
and authorized `azdo-emu-corpus-group` (two dull non-secret values) in the oracle project.

Note the empty slot where the group name should be: the message names **no group at all**, so a
pipeline referencing five groups tells the author nothing about which one failed. A diagnostic the
converter can beat cheaply.

## Consumed by

E02 (compile-time vs runtime evaluation), E04 (variable layer model), E06 (macro pass, env var
naming, `setvariable`), E08 (variable-group names → `.env.example`).
