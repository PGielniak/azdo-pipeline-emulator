# E03-S05-T01 — normalizer: claims and rule list

Claim format per BACKLOG.md §3. IDs sequential, never reused.

The **Ground** for this task is empirical: "every normalizer rule cites the sample that motivated
it." The samples are the ten corpus pairs from E12-S01-T02, and the experiments behind the claims
below are reproducible with `node scripts/normalizer-survey.ts` (transcript:
`research/experiments/E03-normalizer/survey.md`).

## Claims

[C-E03-001] **`finalYaml` is a fixpoint**: re-submitting a committed expansion as `yamlOverride`
returns it byte-for-byte. Measured over all ten corpus goldens — 1/10 round-trips as-is and the
other 9 do once the single output-only shape of C-E03-002 is undone, i.e. **10/10 modulo one
rewrite**. Consequences, both load-bearing for this task: the service's expansion *is* a canonical
form, so normalization maps our side onto it rather than inventing a third form; and the service
applies no further rewriting on a second pass, so a normalizer that agrees with it once will keep
agreeing.
  — research/experiments/E03-normalizer/survey.md §1 (live preview, checked 2026-08-11)

[C-E03-002] **`trigger:`/`pr:` `none` is authored-only; `{enabled: false}` is output-only.** The
service expands `trigger: none` to `trigger:\n  enabled: false`, then **rejects that same text as
input**: `"/azure-pipelines.yml (Line: 2, Col: 3): Unexpected value 'enabled'"`. It is the only
shape in the corpus that fails to round-trip — nine of ten goldens are rejected for this and
nothing else, and entry 10 (which authors real trigger filters) round-trips untouched. So the two
spellings are one pipeline and the normalizer must fold them; and a `preview-diff` implementation
must never feed a `finalYaml` back to the endpoint expecting it to be accepted.
  — research/experiments/E03-normalizer/survey.md §1 (live preview, checked 2026-08-11)

[C-E03-003] Scalar shorthands for resource references are promoted to mappings on expansion:
`container: builder` → `container:\n  alias: builder`, and a services entry `redis: builder` →
`redis:\n  alias: builder` (the same promotion one level deeper). Sibling of C-E12-017's
`environment: <name>` → `{name: …}`.
  — fixtures/oracle/10-monorepo-triggers-pools.final.yml vs
    fixtures/corpus/10-monorepo-triggers-pools/pipeline.yml (live preview, checked 2026-08-11)

## Rule list

Implementation: `packages/engine/src/normalize/normalize.ts` (`normalizeExpandedYaml`), rule ids
exported as `RULES` and asserted one-by-one in `packages/engine/test/normalize/normalize.test.ts`.

| Rule | What it erases | Canonical form | Claim |
|---|---|---|---|
| N1 | `trigger: none` / `pr: none` vs `{enabled: false}` | `{enabled: 'false'}` | C-E03-002 |
| N2 | mapping-form `variables:` vs list form | `- name:/value:` list | C-E12-021 |
| N3 | scalar `dependsOn:` vs list | one-element list | C-E12-021 |
| N4 | scalar `environment:` vs mapping | `{name}` | C-E12-017 |
| N5 | scalar `container:` / `services.<k>` vs mapping | `{alias}` | C-E03-003 |
| N6 | task reference spelled as a GUID vs by name | the name, where one exists | C-E12-019 |
| N7 | YAML booleans/numbers in value positions (`null` exempt) | the string form | C-E01-020 |
| N8 | key order, quoting, comments, line wrapping | sorted keys, one serializer | C-E03-001 |

### Notes that keep the rules honest

- **N6 unifies exactly one pair.** `ecdc45f6-832d-4ad9-b52b-ee49e94659be` resolves live to
  `PublishPipelineArtifact`; the `checkout` (`6d15af64…`) and `download` (`30f35852…`) GUIDs return
  404 from the task catalogue and have **no** name spelling, so the table deliberately omits them —
  inventing a name would make the diff lie. `download:`'s task is also *not*
  `DownloadPipelineArtifact@2`; they are different tasks and must not be folded (C-E12-019).
- **Sequence order is never sorted.** Step and job order is semantic; only mapping keys are sorted.
- **The normalizer does not expand.** The service wraps a `steps:`-only document in
  `stages: __default` / `job: Job` (C-E00-022) and desugars shortcuts into tasks (C-E12-019/020) —
  those are E03-S01..S04's job. A normalizer that did them too would let a broken expander pass
  `preview-diff`, which is the one failure mode this whole layer exists to prevent.
- **N7 is broad on purpose, and that is the rule most likely to need narrowing.** It stringifies
  *every* leaf rather than a list of known-numeric keys, which is sound only while "pipeline values
  are strings" (C-E01-020) holds everywhere. Every numeric/boolean leaf in the corpus goldens
  (`retryCountOnTaskFailure`, `timeoutInMinutes`, variable `value:`, `readonly`, `condition: false`)
  sits in such a position, so nothing in the corpus argues against it today. `null` is exempt: a key
  present with no value and a key set to `''` are different documents, and folding them would hide
  the kind of drift this layer exists to catch.
- **Idempotence is tested, not assumed**, over every committed golden. It is not a formality: the
  first implementation applied N3/N4/N5 to list *items* as well as to the owning key, so
  `dependsOn: [a]` grew a level of nesting on every pass. The idempotence suite caught it.

## Injected defaults — catalogue as discovered

The task asks for server-injected defaults to be catalogued "as discovered". §2 of the survey lists
every key path present in an expansion and absent from the authored input, suffix-matched so the
`stages: __default` position shift does not swamp the list. Today all of it falls into rules
already listed (shortcut→task rewrites, the shape promotions above) or into template-generated
content, so **no rule is owed to an injected default yet**. Re-run the survey when the corpus
grows; a genuinely new default gets a claim and a rule here before it gets code.
