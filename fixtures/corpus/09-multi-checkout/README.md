# 09-multi-checkout

Two repositories in one workspace, plus a template loaded **through a repository alias** — the
shape that breaks any emulator assuming "one repo, one sources directory".

## Exercises

- A `resources.repositories` entry (`type: git`, `name:`, `ref:`) and the alias it defines.
- Three checkout modes across three jobs: explicit multi-checkout (`checkout: self` +
  `checkout: tools`), `checkout: none`, and **no checkout step at all** (implicit `self`) — the
  three cases the runtime must distinguish, and the reason the multi-checkout job's sources land
  in `s/<name>` subdirectories while the implicit job's land directly in `s`.
- Every checkout option worth emulating: `clean`, `fetchDepth: 0` (full history),
  `fetchTags`, `submodules: recursive`, `persistCredentials`, `lfs`, and `path:`.
- `workspace: clean: outputs` at job level, a different cleaning concept from `checkout.clean`.
- `Build.SourcesDirectory` / `Build.Repository.LocalPath` in a job where the multi-checkout rule
  has moved them.
- A cross-repo template reference `…@tools` — resolved through the alias rather than the file
  system, and carrying a parameter.

## Why the alias points at the oracle repository

The service resolves repository resources at preview time, so the alias must name a repository it
can actually reach; the corpus therefore aliases the oracle project's own repo (`name: oracle`)
under a second alias. That is enough to exercise alias resolution, `@alias` template loading and
multi-checkout path rules — what it deliberately does not exercise is *cross-project* or GitHub
`endpoint:` resolution, which needs org objects this project does not create (E08 territory).

## Consumed by

E03-S02-T01 (`@alias` reference resolution), E06 (checkout options, sources layout), E08 (repo
resources, credentials), E04 (repository model).
