# E09-S03-T07 — org yamlschema, re-measured for the caching policy

Run: 2026-09-02 against the test organization. Organization name and PAT redacted. The endpoint's
behavior was grounded by E01-S02-T03; this run exists to settle **how to cache it**, which is what
this task owns.

## Two consecutive fetches

```text
GET <org>/_apis/distributedtask/yamlschema?api-version=7.1     # org-scoped, no project segment
  fetch 1 -> HTTP 200  611,234 bytes  Content-Type: application/json; charset=utf-8; api-version=7.1
  fetch 2 -> HTTP 200  611,234 bytes

  byte-identical across the two calls: TRUE
  sha256 (both): 2c3f6556…

  $schema:  http://json-schema.org/draft-07/schema#
  $comment: v1.183.0
  top-level keys: $comment, $id, $schema, definitions, description, oneOf, title
```

**This refines C-E01-034 rather than retracting it.** That claim recorded three fetches inside ten
minutes *differing* — the `definitions.task.anyOf` alternatives reorder. Today's pair agreed. The
useful conclusion is the stronger one: instability is **intermittent**, and an intermittently
unstable body is exactly as useless for change detection as a permanently unstable one. A differing
hash cannot be distinguished from a reorder, and a matching hash proves only that these two calls
happened to agree. So the cache expires **by age**, never by digest (C-E09-090).

## Same length, same `$comment`, different bytes

```text
live document (2026-09-02):   $comment = v1.183.0   611,234 bytes   sha256 2c3f6556…
committed E01 snapshot:       $comment = v1.183.0   611,234 bytes   sha256 ffd81760…
  research/experiments/E01-orgschema/yamlschema.json
```

This is the cleanest form of the point (C-E09-091): **identical size, identical version marker,
different content**. It is C-E01-034's `definitions.task.anyOf` reordering seen across weeks instead
of minutes — and it rules out all three cheap staleness checks at once. `$comment` does not move
(C-E01-035). Length does not move. A digest moves, but for a reason that has nothing to do with the
schema being newer. Age is the only expiry left standing.

## The resulting policy

There is no service-side version to bust on, so the policy is ours (C-E09-092): use a cached
`schema/yamlschema-<org>.json` while it is younger than a TTL; `--refresh` forces a re-fetch
regardless of age; and a fetch failure over a merely *stale* entry falls back to that entry with a
warning rather than failing the convert — a validation schema a few days old beats a conversion that
will not run, and the consumer already degrades to the vendored schema when a document is unusable.
