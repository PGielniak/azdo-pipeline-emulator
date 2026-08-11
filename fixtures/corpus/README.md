# Corpus v1 (E12-S01-T02)

Ten pipelines patterned on the shapes docs/06 §3 lists, each one **accepted by the real Azure
DevOps service**. The service's expansion of each is committed beside it in `fixtures/oracle/`.

## The rule

> A corpus entry without its oracle pair is invalid.

It is enforced, not merely stated. `scripts/corpus-oracle.ts` exits non-zero if the service rejects
an entry, and `test/corpus.test.ts` fails when a committed pair does not match the hash of the
input it was produced from — so editing a fixture without re-verifying turns the suite red instead
of leaving a stale golden that quietly disagrees with the service.

## Layout

```
fixtures/corpus/<entry>/pipeline.yml     the document submitted as `yamlOverride`
fixtures/corpus/<entry>/templates/*.yml  templates, pushed to the oracle repo before preview
fixtures/corpus/<entry>/README.md        what the entry exercises and which epics consume it
fixtures/oracle/<entry>.final.yml        the service's `finalYaml`, redacted
fixtures/oracle/MANIFEST.json            input hash + fetch date per pair
```

`fixtures/corpus/` mirrors the oracle repository's `/corpus/` directory. That is not cosmetic: the
service resolves `template:` references **against the repository**, treating the override as
though it were the pipeline definition's own file (C-E12-011), so a template reference has to be
spelled `/corpus/<entry>/templates/x.yml` to name the same file locally and server-side. References
*inside* a template resolve relative to that template instead (C-E12-012) and are spelled as bare
sibling names.

## Refreshing

```sh
node scripts/corpus-oracle.ts              # all entries
node scripts/corpus-oracle.ts 05-steps-template-nested
node scripts/oracle-provision.ts           # once: environments + variable group the corpus needs
```

Goldens are **redacted** (`redact()`: organization name and PAT → placeholders, CLAUDE.md rule 4).
Any re-verification — E12-S02-T02's `--update`, E12-S03's nightly `preview-diff` — must redact the
fresh response before diffing, or every entry that mentions the organization diffs forever.

## The entries

| Entry | Shape | Headline feature |
|---|---|---|
| `01-matrix-multi-config` | multi-config build | `strategy: matrix`/`parallel`, matrix variable in `pool` |
| `02-artifact-handoff` | artifacts across stages | `publish`/`download` **and** the tasks they desugar to |
| `03-dependencies-and-conditions` | cross-job data flow | output variables, `dependencies`/`stageDependencies`, result conditions |
| `04-variable-layers` | variable precedence | all three syntaxes, `readonly`, `- group:`, build-number format |
| `05-steps-template-nested` | shared CI templates | four levels of steps templates, both path-resolution bases |
| `06-extends-each-joblist` | governance template | `extends` + `jobList` + `each` over mapping pairs |
| `07-template-parameter-types` | parameter type system | every parameter type, defaulted **and** overridden |
| `08-deployment-runonce` | deployment | `runOnce` with every lifecycle hook, plus `rolling` |
| `09-multi-checkout` | multiple repositories | repo resource, three checkout modes, `@alias` template |
| `10-monorepo-triggers-pools` | monorepo | trigger/pr/schedule filters, container + services, demands |

## What corpus v1 deliberately does not cover

- **Cross-project / GitHub repository resources** and service connections — they need org objects
  and credentials this project does not create (E08 territory). Entry 09 aliases the oracle repo
  itself instead.
- **Canary / `deployment` on VM or Kubernetes resources** — the resource types need real
  infrastructure registered in the environment; entry 08 covers `runOnce` and `rolling`.
- **Matrix multiplication.** Not an omission in the fixture but a limit of the instrument: the
  service does not expand `strategy` at all (C-E12-018), so no oracle pair can ever prove job
  multiplication. That behaviour belongs to a real run (L6).

docs/06 §3 targets ≥30 corpus pipelines eventually; v1 is the first ten, and every future bug
report is supposed to arrive as an eleventh.
