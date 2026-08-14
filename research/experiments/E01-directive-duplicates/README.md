# E01-S01-T04 — duplicate template-expression keys

Live Azure DevOps preview probes captured 2026-08-14. Regenerate the two E01 transcripts with:

```console
pnpm duplicate-key-survey
```

| Cell | Outcome | Evidence |
|---|---|---|
| Two byte-identical recognized `${{ if }}` keys | HTTP 200; both mapping bodies survive expansion | `../E03-walk/dup-identical-if-keys.md` |
| Two byte-identical recognized `${{ each }}` keys | HTTP 200; both generated variables survive expansion | `dup-identical-each-keys.md` |
| Two byte-identical ordinary `${{ pair.key }}` keys | HTTP 400 after both resolve to `PROBE` | `dup-ordinary-expression-keys.md` |

Conclusion: duplicate-key parsing exempts recognized directive keys, not every key containing a
template expression. This corrects the scope of C-E01-023 without invalidating any of its measured
literal-key cells.
