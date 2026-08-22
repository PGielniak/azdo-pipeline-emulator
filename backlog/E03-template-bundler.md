# E03 — Local template bundler

Phase: P1 · Depends on: E00, E01 · Design: docs/02 §5, docs/05 §4
Primary grounding set: learn.microsoft.com/azure/devops/pipelines/process/templates · …/process/runtime-parameters · the `preview` endpoint as the authority for how inlined content expands (E00-S04).

> **Replaces the original "template engine" epic (docs/07).** The old E03 reimplemented
> `if`/`each`/`insert`/`extends` locally to byte parity (walker, conditionals, each, insert,
> normalizer). That work is **demoted** to the offline fallback and marked `[~]` in E12-cleanup.
> This epic is now the **mechanical bundler**: it packs local, uncommitted `@self` template files
> into the `yamlOverride` so the **service** expands them. We inline files; we never expand
> directives or evaluate `${{ }}` ourselves.

## E03-S01 — As a pipeline developer, editing a local template file is visible to the expansion, so I can debug multi-file pipelines without committing.
Acceptance: a root pipeline referencing local `@self` templates converts from an uncommitted working tree.

- [ ] **E03-S01-T01 — Detect `@self` template references**
  **Do:** `packages/engine/src/template/bundle.ts` walks the parsed raw DOM (E01) and finds `extends.template`, `stages/jobs/steps` `- template:` references, and a `@self`-style repository alias; record each with its `file:line`.
  **Ground:** templates doc (…/process/templates) for the reference syntax + `resources.repositories` doc; reference shapes are the only behavior here — no expansion.
  **Done:** unit tests list references across root/stage/job/step levels from a fixture.
- [ ] **E03-S01-T02 — Recursive local inliner**
  **Do:** resolve each `@self` reference against the local working tree (relative to the root file), inline the file's content, recurse into nested `@self` references; detect cycles and report them.
  **Ground:** oracle experiment: confirm that a `yamlOverride` whose body contains inlined template content expands identically to the committed multi-file form (one redacted probe pair under `research/experiments/E03-bundle/`); this pins *our* inlining mechanics, not server behavior.
  **Done:** a two-file pipeline with a nested template converts with no `@self` references left in the override; a cycle produces a diagnostic with file:line.
- [ ] **E03-S01-T03 — Parameter pass-through**
  **Do:** pass `templateParameters` (and `parameters:` at the `extends` boundary) through to the expansion call (E00-S04) as the `templateParameters` request field; leave parameter *binding* to the service.
  **Ground:** preview request shape already grounded (C-E00-018 includes `templateParameters`); runtime-parameters doc for the parameter syntax.
  **Done:** a pipeline with `- template: t.yml` + `parameters: {…}` converts and the expansion reflects the values (asserted against the returned `finalYaml`).
- [ ] **E03-S01-T04 — Cross-repo (`@other`) references**
  **Do:** detect template references to repos other than `@self`; for v1 emit a clear convert-time diagnostic ("cross-repo template — resolves against the committed repo; see E09"), never a silent wrong expansion.
  **Ground:** `resources.repositories` doc for the alias form; C-E03-110 (position gating measured).
  **Done:** an `@other` reference produces the diagnostic and stops (or continues with an explicit warning) — no silent fallback.

## E03-S02 — As a pipeline developer, I can see exactly what was sent to the service, so surprises are debuggable.
Acceptance: the bundled override and its provenance are written to the output.

- [ ] **E03-S02-T01 — Bundled-override provenance**
  **Do:** write the exact `yamlOverride` sent to `preview` (secrets redacted) plus a map of `local path → inlined location` and file hashes into the output (e.g. `pipeline.bundled.yml` + `bundle.json`).
  **Ground:** docs/04 §10 (provenance comments) and D7 (secret redaction) — reuse `redact()` from the fetch package.
  **Done:** output contains the redacted override and the path map; a template edit is attributable by hash.
- [ ] **E03-S02-T02 — Missing-file & cycle diagnostics**
  **Do:** missing template file and circular includes produce E01-style diagnostics (file:line, hint), never a raw exception.
  **Ground:** docs/01 §1 diagnostic contract (E01-S01-T03).
  **Done:** snapshot tests for missing-file and cycle cases.
