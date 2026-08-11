// E01-S02-T03 — pin the org-specific YAML schema the service serves, so the per-org injection
// point (packages/engine/src/frontend/org-schema.ts) is verified against a *real* response and not
// against an assumption about its shape.
//
// Route (C-E01-029): GET {org}/_apis/distributedtask/yamlschema — organization-scoped, no project
// segment. The optional `validateTaskNames` toggle is fetched too, because the delta between the
// two responses is itself the evidence for what the service means by "unknown task" (C-E01-033).
//
// Run: node scripts/org-schema.ts   (pnpm org-schema)
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorizationHeader, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E01-orgschema');
const API_VERSION = '7.1';

interface Fetched {
  readonly label: string;
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

async function get(orgUrl: string, pat: string, label: string, query: string): Promise<Fetched> {
  const url = `${orgUrl.replace(/\/+$/, '')}/_apis/distributedtask/yamlschema?${query}`;
  const res = await fetch(url, {
    method: 'GET',
    // Never follow: an unauthenticated call answers 302 to a sign-in page, which a redirect-
    // following client reports as a 200 of HTML (C-E00-023).
    redirect: 'manual',
    headers: { accept: 'application/json', authorization: authorizationHeader(pat) },
  });
  return {
    label,
    url,
    status: res.status,
    contentType: res.headers.get('content-type') ?? '(none)',
    body: await res.text(),
  };
}

type Json = Record<string, unknown>;

function at(node: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>(
    (current, key) =>
      typeof current === 'object' && current !== null ? (current as Json)[key] : undefined,
    node,
  );
}

function taskAlternatives(schema: unknown): unknown[] {
  const alternatives = at(schema, 'definitions', 'task', 'anyOf');
  return Array.isArray(alternatives) ? alternatives : [];
}

function taskNames(schema: unknown): string[] {
  const alternatives = at(schema, 'definitions', 'task', 'properties', 'task', 'anyOf');
  if (!Array.isArray(alternatives)) return [];
  return alternatives.flatMap((alternative: unknown) => {
    const values = at(alternative, 'enum');
    return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
  });
}

const env = await loadEnvFile('.env.oracle');
const orgUrl = env.AZDO_ORG_URL;
const pat = env.AZDO_PAT;
if (!orgUrl || !pat) {
  throw new Error('org-schema needs AZDO_ORG_URL and AZDO_PAT (see research/oracle-setup.md)');
}

const withValidation = await get(orgUrl, pat, 'default', `api-version=${API_VERSION}`);
const withoutValidation = await get(
  orgUrl,
  pat,
  'validateTaskNames=false',
  `validateTaskNames=false&api-version=${API_VERSION}`,
);

for (const fetched of [withValidation, withoutValidation]) {
  if (fetched.status !== 200) {
    throw new Error(`${fetched.label}: HTTP ${fetched.status} — ${fetched.body.slice(0, 300)}`);
  }
}

const redacted = redact(withValidation.body, { orgUrl, pat });
const schema = JSON.parse(redacted) as Record<string, unknown>;
const strict = taskNames(schema);
const looseSchema: unknown = JSON.parse(withoutValidation.body);
const loose = taskNames(looseSchema);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'yamlschema.json'), redacted);

const sha = createHash('sha256').update(redacted).digest('hex');
const looseExtra = JSON.stringify(taskAlternatives(looseSchema).slice(-1)[0], null, 2);

const readme = `# E01-S02-T03 — org \`yamlschema\` response (pinned)

Produced by \`node scripts/org-schema.ts\`. Re-run to re-verify; the committed
\`yamlschema.json\` **is** the fixture the injection test validates against, so a diff here is a
real change in what the organization serves.

## Request

\`\`\`http
GET https://dev.azure.com/{org}/_apis/distributedtask/yamlschema?api-version=${API_VERSION}
Authorization: Basic base64(":{pat}")
Accept: application/json
\`\`\`

Organization-scoped — there is **no project segment** in this route (C-E01-029).

## Response

| | default | \`validateTaskNames=false\` |
|---|---|---|
| status | ${withValidation.status} | ${withoutValidation.status} |
| content-type | \`${withValidation.contentType}\` | \`${withoutValidation.contentType}\` |
| bytes | ${withValidation.body.length} | ${withoutValidation.body.length} |
| task names | ${strict.length} | ${loose.length} |

- \`$schema\`: \`${String(schema['$schema'])}\`
- \`$id\`: \`${String(schema['$id'])}\`
- \`$comment\`: \`${String(schema['$comment'])}\`
- sha256 (committed file): \`${sha}\`

### What \`validateTaskNames=false\` changes

Exactly one extra alternative is appended to \`definitions.task.anyOf\` (and a bare
\`{"type":"string"}\` to \`definitions.task.properties.task.anyOf\`); the task list itself is
unchanged. The extra alternative accepts *any* task name with *any* inputs:

\`\`\`json
${looseExtra}
\`\`\`

## Redaction

Body scanned before commit: no organization name, project name, PAT, e-mail address or GUID
appears in it (the only URLs are \`github.com\`, \`json-schema.org\` and \`store.xamarin.com\`,
all inside task descriptions). \`redact()\` is applied regardless.
`;
await writeFile(path.join(OUT_DIR, 'README.md'), readme);

const marketplace = strict.filter((name) => /^replacetokens@/i.test(name));
console.log(
  `wrote ${OUT_DIR}/yamlschema.json (${redacted.length} bytes, sha256 ${sha.slice(0, 16)}…)\n` +
    `  task names: ${strict.length} strict / ${loose.length} with validateTaskNames=false\n` +
    `  marketplace tasks seen: ${marketplace.join(', ') || '(none)'}`,
);
