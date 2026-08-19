# oracle probe — sequence-position-valid

The probe that actually *distinguishes* merge from splice, which `sequence-position` could not: its object had one key, so both readings produce the same document. This one supplies two keys that together form a **valid step**. Merging into the item yields one working step; splicing into the parent sequence yields two items, the second of which is not a step at all.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
