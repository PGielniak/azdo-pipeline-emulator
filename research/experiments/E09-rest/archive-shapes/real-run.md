# E09-S02-T04 — what is inside the two archive snapshot formats

Run: 2026-09-02. Both fixtures are public or already-redacted: the GitHub tarball is
`octocat/Hello-World`, the ADO zip is the `azdo-emu-templates` fixture repository whose contents are
already listed in `../ado-git/real-run.md`. Nothing here needs redaction beyond the organization
name, which does not appear.

## GitHub tarball — `GET /repos/octocat/Hello-World/tarball/7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`

```text
tar -tzf:
  octocat-Hello-World-7fd1a60/
  octocat-Hello-World-7fd1a60/README

raw member headers (ustar magic b'ustar\x00'):
  typeflag='g'  size=52   name=pax_global_header
  typeflag='5'  size=0    name=octocat-Hello-World-7fd1a60/
  typeflag='0'  size=13   name=octocat-Hello-World-7fd1a60/README
```

Two things matter and neither is guessable:

1. **The prefix carries an abbreviated sha** — `7fd1a60`, seven characters — while the resolver
   pinned the full `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`. Computing the prefix from the pinned
   sha would never match (C-E09-050).
2. **The first member is a PAX global header**, typeflag `g`, not a file. A parser that trusts every
   header writes a stray `pax_global_header` into the tree (C-E09-052).

## ADO Items zip — the same route as `../ado-git/real-run.md` §4

```text
unzip -l:
  README.md
  cross/abs.yml
  cross/back-to-self.yml
  cross/leaf.yml
  cross/outer.yml
  cross/rel-self.yml

compression: every member compress_type=8 (deflate)
```

**No prefix at all** — entries are repository-relative (C-E09-051). So the two formats disagree
exactly about the thing an extractor has to get right, which is why the implementation strips a
*common* leading component rather than a per-format constant.

## Conclusion

One rule covers both: strip a single leading path component **only when every entry shares it**.
For the tarball that removes `octocat-Hello-World-7fd1a60/`; for the zip it is a no-op. Entry
typeflags other than regular-file are skipped, deflate and stored members are both handled, and
every destination is checked to be strictly inside the target directory before anything is written
(C-E09-054 — local hardening, not parity).

---

## End to end through the shipped code (2026-09-02)

The measurements above shaped the extractor; this runs the whole path — fetch, extract, read — with
the real service and the code that ships.

```text
resolveGitHubRef({octocat, Hello-World}, 'refs/heads/master')
  -> commit 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d
snapshotGitHubRepo(...)
  entry contents: snapshot.json, snapshot.tar.gz, tree
  tree contents:  README
  read tree/README -> "Hello World!\n"
```

The pinned commit is the full forty characters while the archive's prefix carried the abbreviated
`7fd1a60` — the case C-E09-050 exists for. `tree/README` rather than
`tree/octocat-Hello-World-7fd1a60/README` is the observable proof the derived prefix was stripped,
and the archive is kept alongside the tree so a re-extract needs no second download.
