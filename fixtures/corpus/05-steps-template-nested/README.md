# 05-steps-template-nested

Four levels of steps templates (`pipeline.yml` → `build.yml` → `test.yml` → `publish-results.yml`),
which is what a shared-CI repo actually looks like, and the fixture that pins **both** template
path-resolution bases at once.

## Exercises

- Root-absolute references from the root document (`/corpus/05-steps-template-nested/templates/…`)
  — the only spelling that means the same file locally and server-side (C-E12-011).
- Bare-name references **inside** a template (`test.yml` from `build.yml`), which resolve relative
  to the containing template's directory (C-E12-012). One fixture, two resolution rules.
- Typed template parameters: `string` with a default, `object` carrying a list, `boolean`, and an
  empty `stepList` whose `${{ each step in ... }}` loop must expand to nothing.
- The same template instantiated **twice with different parameters** in two jobs — the expanded
  output has to differ per instantiation, which is where naive caching breaks.
- `${{ each }}` over a list parameter, generating one step per item with the item in the
  `displayName` (so provenance mapping has to survive iteration).
- `${{ if }}` / `${{ else }}` conditional insertion whose branches contain a *template reference*
  in one arm and a plain step in the other.
- A parameter value threaded three levels down (`configuration` → `build.yml` → `test.yml`).
- A real task with `condition: succeededOrFailed()` at the deepest level.

## Repo mirror

The `templates/` files are pushed to the oracle repository at `/corpus/05-steps-template-nested/`
by `scripts/corpus-oracle.ts` before the preview call — the service reads templates from the repo,
never from the request body.

## Consumed by

E03-S01 (walker, `each`, conditional insertion), E03-S02 (reference resolution, typed parameter
binding), E01-S02-T02 (one of the template-using pipelines its tolerance list needs).
