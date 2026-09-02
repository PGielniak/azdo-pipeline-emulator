# E09-S03-T04 — variable groups, measured

Run: 2026-09-02 against the test organization. Organization, project and PAT redacted. **Variable
values are deliberately not recorded here** — that is the whole point of the task, and a transcript
that printed them would violate the rule it exists to prove.

## The response shape

```text
GET <org>/<project>/_apis/distributedtask/variablegroups?api-version=7.1
  -> HTTP 200, count 1

  group id=2  name=azdo-emu-corpus-group  type=Vsts
  group keys: createdBy, createdOn, description, id, isShared, modifiedBy,
              modifiedOn, name, type, variableGroupProjectReferences, variables

  variable corpusPlainValue     keys=['value']                isSecret=absent  value present
  variable corpusReadOnlyValue  keys=['isReadOnly','value']   isSecret=absent  value present
```

Two things matter, and both are easy to get wrong:

1. **The API returns non-secret values in plaintext** (C-E09-080). Both members above carry their
   `value`. The docs' own sample shows the contrast — `"key1": {"value": "value1"}` next to
   `"key2": {"value": null, "isSecret": true}` — so *secret* values are nulled by the service and
   everything else is not. The project's "never fetch variable-group values" rule (decision
   2026-07-30) is therefore something the client **does**, not something the API does for it.
2. **`isSecret` is absent, not `false`, on a non-secret variable** (C-E09-081). Neither live member
   has the key. Code written as `v.isSecret === false` would never be true; `undefined` is the
   "not secret" case. `isReadOnly` is the same — present only on the one variable that has it.

## What the client keeps

The parsed result carries `{name, isSecret, isReadOnly}` per variable and **no value field at all**
(C-E09-084). Dropping the value at the parse boundary — rather than carrying it and filtering later
— is what makes the guarantee testable: `packages/fetch/test/rest-variable-groups.test.ts` feeds a
response containing a plaintext value and asserts that string appears nowhere in the result, its
`JSON.stringify`, or the rendered `.env.example` block.
