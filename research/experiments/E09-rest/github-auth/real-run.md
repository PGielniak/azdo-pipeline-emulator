# E09-S01-T04 — GitHub authentication live request matrix

Run: 2026-08-28 against `api.github.com`.

This transcript records only request shapes, response status, and non-sensitive payload shape.
The token, `Authorization` value, redirect locations, private owner/repository/path, private payload,
and the selected account are deliberately not recorded.

## Credential probe

```text
command: gh auth token --hostname github.com
exit: 0
stdout: <non-empty token; redacted before capture>
```

## Public fixture

Fixture: `octocat/Hello-World`, path `README`, ref `master`.

```text
GET /repos/octocat/Hello-World/contents/README?ref=master
Authorization: <absent>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10

status: 200
shape: JSON object; type=file; size=13

GET /repos/octocat/Hello-World/tarball/master
Authorization: <absent>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
redirect handling: manual

status: 302
Location: <redacted>
```

## Private fixture

An accessible, non-empty private repository was selected programmatically from the authenticated
account. Its identity and path are intentionally omitted.

```text
GET /repos/<private-owner>/<private-repo>/contents/<private-path>?ref=<default-branch>
Authorization: <absent>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10

status: 404

GET /repos/<private-owner>/<private-repo>/contents/<private-path>?ref=<default-branch>
Authorization: Bearer <redacted>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10

status: 200
shape: JSON object; type=file; size=75

GET /repos/<private-owner>/<private-repo>/tarball/<default-branch>
Authorization: Bearer <redacted>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
redirect handling: manual

status: 302
Location: <redacted>
```

## Conclusion

The measured boundary is public anonymous access plus authenticated private access for both request
families. The implementation may safely fall back to anonymous when neither `gh auth token` nor
`GITHUB_TOKEN` yields a credential, provided it never forwards a bearer token beyond the GitHub API
origin while following the tarball redirect.

---

## Second run — through the implemented chain (2026-09-02, E09-S01-T04 Done criterion)

The section above measured raw requests *before* the implementation existed. This section re-runs the
same public/private matrix **through `packages/fetch/src/auth/github.ts`**, so the Done criterion
("fetch of a public and a private fixture repo path") is evidenced by the code that ships rather than
by a hand-built request. Redaction discipline is unchanged: the token, the private owner/repository/
path, and the redirect `Location` are not recorded. The private fixture was again selected
programmatically from the authenticated account.

```text
resolveGitHubCredential() -> source=gh-cli          # gh auth token succeeded; token not printed

fetchGitHubContents('octocat','Hello-World','README','master', anonymous)
  -> source=anonymous status=200 type=file size=13
fetchGitHubTarball('octocat','Hello-World','master', anonymous)
  -> source=anonymous status=302 archive bytes=265

fetchGitHubContents(<private-owner>,<private-repo>,<private-path>,<default-branch>, anonymous)
  -> GitHubFetchError status=404 source=anonymous
     "GitHub contents request returned HTTP 404: not found, or private and this request was
      unauthenticated"
fetchGitHubContents(<private-owner>,<private-repo>,<private-path>,<default-branch>, chain)
  -> source=gh-cli status=200 type=file size=13
fetchGitHubTarball(<private-owner>,<private-repo>,<default-branch>, chain)
  -> source=gh-cli status=302 archive bytes=199698 location host=codeload.github.com
```

## Conclusion (second run)

Both fixture families succeed end to end through the chain, and the anonymous-on-private answer is
404 — reported as "not found, or private and this request was unauthenticated" rather than as a
missing repository, so the fetchers built on this (E09-S02-T02) do not inherit a misleading error.

The private tarball is the load-bearing measurement: the redirect was taken manually and the
**storage request carried no `Authorization` header**, yet returned the full 199,698-byte archive of
a *private* repository from `codeload.github.com`. The signed storage URL therefore carries its own
grant, which confirms in practice what C-E09-015 states in principle — the GitHub credential never
has to cross origins, so it never does.
