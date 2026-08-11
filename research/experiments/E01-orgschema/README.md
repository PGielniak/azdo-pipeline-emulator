# E01-S02-T03 — org `yamlschema` response (pinned)

Produced by `node scripts/org-schema.ts`. Re-run to re-verify; the committed
`yamlschema.json` **is** the fixture the injection test validates against, so a diff here is a
real change in what the organization serves.

## Request

```http
GET https://dev.azure.com/{org}/_apis/distributedtask/yamlschema?api-version=7.1
Authorization: Basic base64(":{pat}")
Accept: application/json
```

Organization-scoped — there is **no project segment** in this route (C-E01-029).

## Response

| | default | `validateTaskNames=false` |
|---|---|---|
| status | 200 | 200 |
| content-type | `application/json; charset=utf-8; api-version=7.1` | `application/json; charset=utf-8; api-version=7.1` |
| bytes | 611170 | 611314 |
| task names | 269 | 269 |

- `$schema`: `http://json-schema.org/draft-07/schema#`
- `$id`: `https://github.com/Microsoft/azure-pipelines-vscode/blob/main/service-schema.json`
- `$comment`: `v1.183.0`
- sha256 (committed file): `ffd8176082221de6174a9f436a9418f44a031009b7c5363f24255961d96267ea`

### What `validateTaskNames=false` changes

Exactly one extra alternative is appended to `definitions.task.anyOf` (and a bare
`{"type":"string"}` to `definitions.task.properties.task.anyOf`); the task list itself is
unchanged. The extra alternative accepts *any* task name with *any* inputs:

```json
{
  "properties": {
    "task": {
      "type": "string"
    },
    "inputs": {
      "additionalProperties": true
    }
  },
  "firstProperty": [
    "task"
  ],
  "required": [
    "task"
  ]
}
```

## Redaction

Body scanned before commit: no organization name, project name, PAT, e-mail address or GUID
appears in it (the only URLs are `github.com`, `json-schema.org` and `store.xamarin.com`,
all inside task descriptions). `redact()` is applied regardless.
