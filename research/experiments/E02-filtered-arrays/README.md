# E02-S05-T04 — filtered-array evaluation matrix

Live Azure DevOps Pipelines preview, checked 2026-08-18. Each named transcript is one redacted
`previewRun: true` request/response pair produced by `pnpm expr-filtered-array-survey`. The probe
wraps the expression in `convertToJson(...)`, so the table shows the exact evaluated collection.

The matrix was designed from the filtered-array branches in the pinned open expression engine:
[`Index.cs` at actions/runner `258d6c85`](https://github.com/actions/runner/blob/258d6c857db3519913f7deb6004b60172f8043ae/src/Sdk/DTExpressions2/Expressions2/Sdk/Operators/Index.cs#L51-L225).
That source was a hypothesis only; all behavior below is adopted because the Azure service agreed.

| Cell | `.*` result | `[*]` result | Transcripts |
|---|---|---|---|
| Array terminal | all four elements, unchanged and ordered | identical | `array-terminal-dot`, `array-terminal-index` |
| Array → property | `[1, ""]`; absent members and primitive children omitted | identical | `array-property-dot`, `array-property-index` |
| Object terminal | values `[{"id":10},{"id":20}]` in authored order | identical | `object-terminal-dot`, `object-terminal-index` |
| Object → property | `[10,20]` | identical | `object-property-dot`, `object-property-index` |
| Null-producing expression | `[]` | identical | `expression-null-terminal-dot`, `expression-null-terminal-index` |
| Missing nested member | `[]` | identical | `missing-terminal-dot`, `missing-terminal-index` |
| Primitive target | `[]` | identical | `scalar-terminal-dot`, `scalar-terminal-index` |
| YAML null control | `[]`; YAML null had already normalized to empty String | identical | `yaml-null-terminal-dot`, `yaml-null-terminal-index` |
| Nested Array wildcard | flattened `[100,101,200]` | identical | `nested-filter-dot`, `nested-filter-index` |
| Object → child Array wildcard | flattened `["L1","L2","R1"]` | identical | `object-array-nested-dot`, `object-array-nested-index` |
| Mapped numeric index | first item of each child Array: `[100,200]` | identical | `mapped-numeric-index-dot`, `mapped-numeric-index-bracket` |

Two additional chain controls settle the filtered result's identity:

- `parameters.data.rows.*.id[0]` → `[]` (`index-after-primitive-map`): `[0]` is mapped into each
  primitive child; it does not select the first element of the filtered result.
- `parameters.data.mapping.*.absent` → `[]` (`missing-after-filter`): misses are omitted, never
  inserted as Null placeholders.

All 24 calls returned HTTP 200. Dot and bracket wildcard spellings were byte-identical in every
paired cell.
