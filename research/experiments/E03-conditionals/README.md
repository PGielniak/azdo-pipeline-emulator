# E03-S01-T02 — conditional insertion matrix

Live Azure DevOps Pipelines preview, checked 2026-08-18. `pnpm template-conditionals-survey`
submits every probe sequentially, writes the redacted transcript beside this file, and promotes
every successful case to an input/`finalYaml` pair under `fixtures/oracle/directives/`.

| Behavior | Probes | Result |
|---|---|---|
| First branch wins | `sequence-if-wins`, `sequence-elseif-wins`, `sequence-else-wins` | Exactly one body is spliced |
| No match and no else | `sequence-no-match-no-else`, `mapping-no-match-no-else` | Directive bodies contribute nothing |
| Mapping insertion | `mapping-elseif-wins` | Winning entries merge at the directive position |
| Nested expansion | `nested-sequence-chain`, `nested-mapping-chain` | Selected bodies recurse in both container shapes |
| A new if resets state | `adjacent-independent-if` | The following else belongs to the newest if |
| Ordinary sibling between clauses | `interrupted-else-sequence`, `interrupted-elseif-sequence`, `interrupted-else-after-true`, `interrupted-else-mapping` | Sibling remains; clause still belongs to the earlier if |
| Primitive/Null truthiness | `condition-truthiness-primitives` | Nonempty String/nonzero Number true; empty String/zero/Null false |
| Collection truthiness | `condition-truthiness-collections`, `condition-truthiness-empty-collections` | Array/Object true even when empty |
| Condition short-circuiting | `condition-short-circuit-after-if`, `condition-short-circuit-after-elseif` | Later elseif conditions are not evaluated after a winner |
| Sequence mapping body | `sequence-mapping-body` | Inserted as one sequence item |
| Orphan/duplicate clauses | `orphan-else-sequence`, `orphan-elseif-sequence`, `duplicate-else-sequence` | Rejected: directive not supported in this context |
| Mapping sequence body | `mapping-sequence-body` | Rejected: `Expected a mapping` |

The surprising cell is the interrupted chain: clause association is stateful over the whole
containing sequence/mapping, not adjacency-based. An ordinary step or key does not close it.
