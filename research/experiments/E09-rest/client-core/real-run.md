# E09-S03-T01 — api-version negotiation and throttling headers, measured

Run: 2026-09-02 against the test organization. Organization and project names and the PAT are
redacted; the route (`_apis/git/repositories`) is a cheap read chosen only because it always returns
something.

## api-version negotiation

```text
GET <org>/<project>/_apis/git/repositories                       # api-version OMITTED
  -> HTTP 200
     Content-Type: application/json; charset=utf-8; api-version=7.1

GET <org>/<project>/_apis/git/repositories
    Accept: application/json;api-version=7.1                     # version in the header
  -> HTTP 200, count=2

GET <org>/<project>/_apis/git/repositories?api-version=99.0
  -> HTTP 400
     {"message":"The requested REST API version of 99.0 is out of range for this server. The latest
       REST API version this server supports is 7.2.",
      "typeName":"Microsoft.VisualStudio.Services.WebApi.VssVersionOutOfRangeException"}
```

Three readings, and the first is the one that matters:

1. **The docs' "API version must be specified with every request" is a contract, not an
   enforcement** (C-E09-061). Omitting it returned 200, not an error — so an omission is a silent
   floating dependency on whatever the server picks today, which is a far worse failure mode than a
   rejection because nothing surfaces until the server moves. The client pins on every request.
2. **The negotiated version comes back in `Content-Type`** (C-E09-062), which turns the pin from an
   assertion into something checkable. The client parses it and reports it.
3. **An out-of-range version fails usefully** (C-E09-063), naming the server's ceiling — **7.2**
   here, above the 7.1 this project pins, so the pin is conservative rather than stale.

## Throttling headers on an ordinary response

```text
GET <org>/<project>/_apis/git/repositories?api-version=7.1
  response headers matching /ratelimit|retry-after/i:  (none)
  present instead: x-tfs-processid, x-tfs-session
```

**None of the seven documented rate-limit headers appear on an unthrottled 200** (C-E09-065), which
is consistent with the page's own "If available" qualifier. Every one is therefore optional and the
client must be correct when all are missing — it is, because the delay it applies is
`Retry-After ?? 0`.

This section is a negative result, and it is the reason the `Retry-After` handling is written the way
it is: the header could not be observed here, so the behavior is taken from the page's explicit
statement (C-E09-064) that it "still returns HTTP 200", not from a measurement. That the header is
absent on a healthy call is exactly what makes the 200-carrying case easy to overlook.
