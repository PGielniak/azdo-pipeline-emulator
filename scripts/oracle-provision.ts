// E12-S01-T02 — provision the org objects the corpus references.
//
// Two corpus shapes are rejected *at YAML load time* unless the object they name already exists
// and is authorized for the pipeline: `environment:` on a deployment job (C-E12-017) and
// `- group:` in `variables:` (C-E12-015). Neither is a property of the YAML the converter has to
// emulate — they are preconditions for the oracle being able to answer at all.
//
// Everything created here is empty of secrets and deletable from project settings: two
// environments with no resources, and one variable group holding a single non-secret dummy value.
// The script is idempotent — run it any number of times; it creates only what is missing.
//
// Owner-facing note: this is the only script in the repo that creates org objects. `.env.oracle`
// must therefore hold a PAT with the manage scopes named in the docs below; the read-only Build
// scope the runbook documents is enough for everything else.
//
// Run: node scripts/oracle-provision.ts
import {
  authorizationHeader,
  configFromEnv,
  type OracleConfig,
} from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';

/** Environments the corpus deployment jobs target. */
const ENVIRONMENTS = ['corpus-staging', 'corpus-production'];
/** Variable group referenced by fixtures/corpus/04-variable-layers. Names only — never values. */
const VARIABLE_GROUP = 'azdo-emu-corpus-group';

const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);
const org = config.orgUrl.replace(/\/+$/, '');
const project = encodeURIComponent(config.project);

async function api(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorizationHeader(config.pat),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text };
}

function require2xx(what: string, res: { status: number; text: string }): void {
  if (res.status < 200 || res.status >= 300) {
    const safe = res.text.split(config.pat).join('{pat}').slice(0, 300);
    throw new Error(`${what}: HTTP ${res.status} ${safe}`);
  }
}

/**
 * Authorize the anchor pipeline to use a resource. Creating an object is not enough — the
 * "has not been authorized for use" half of the rejection is this call
 * (PATCH pipelinepermissions/{resourceType}/{resourceId}, api-version 7.1-preview.1).
 */
async function authorize(resourceType: string, resourceId: string | number): Promise<void> {
  const res = await api(
    `${org}/${project}/_apis/pipelines/pipelinepermissions/${resourceType}/${resourceId}` +
      `?api-version=7.1-preview.1`,
    {
      method: 'PATCH',
      body: JSON.stringify({ pipelines: [{ id: config.pipelineId, authorized: true }] }),
    },
  );
  require2xx(`authorize ${resourceType} ${resourceId}`, res);
}

async function ensureEnvironment(name: string, cfg: OracleConfig): Promise<void> {
  const list = await api(
    `${org}/${project}/_apis/distributedtask/environments?name=${encodeURIComponent(name)}&api-version=7.1`,
  );
  require2xx(`list environments`, list);
  const existing = ((list.body as { value?: { id: number; name: string }[] }).value ?? []).find(
    (e) => e.name === name,
  );

  let id = existing?.id;
  if (id === undefined) {
    const created = await api(
      `${org}/${project}/_apis/distributedtask/environments?api-version=7.1`,
      {
        method: 'POST',
        body: JSON.stringify({ name, description: `azdo-emu corpus fixture (E12-S01-T02)` }),
      },
    );
    require2xx(`create environment ${name}`, created);
    id = (created.body as { id: number }).id;
  }
  await authorize('environment', id);
  console.log(
    `environment ${name.padEnd(20)} ${existing === undefined ? 'created' : 'present'} (id ${id}), authorized for pipeline ${cfg.pipelineId}`,
  );
}

async function ensureVariableGroup(name: string): Promise<void> {
  const list = await api(
    `${org}/${project}/_apis/distributedtask/variablegroups?groupName=${encodeURIComponent(name)}&api-version=7.1`,
  );
  require2xx('list variable groups', list);
  const existing = ((list.body as { value?: { id: number; name: string }[] }).value ?? []).find(
    (g) => g.name === name,
  );

  let id = existing?.id;
  if (id === undefined) {
    // The project reference is required on create: the org-scoped route needs to know which
    // project the group belongs to.
    const projectInfo = await api(`${org}/_apis/projects/${project}?api-version=7.1`);
    require2xx('read project', projectInfo);
    const projectId = (projectInfo.body as { id: string }).id;

    const created = await api(`${org}/_apis/distributedtask/variablegroups?api-version=7.1`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: 'azdo-emu corpus fixture (E12-S01-T02) — contains no secrets',
        type: 'Vsts',
        // Deliberately dull, non-secret values: PLAN D5 says the converter emits group *names*
        // into .env.example and never fetches values, so the corpus needs a group to exist, not
        // a group to contain anything.
        variables: {
          corpusPlainValue: { value: 'plain-value', isSecret: false },
          corpusReadOnlyValue: { value: 'read-only-value', isSecret: false, isReadOnly: true },
        },
        variableGroupProjectReferences: [
          { name, description: '', projectReference: { id: projectId, name: config.project } },
        ],
      }),
    });
    require2xx(`create variable group ${name}`, created);
    id = (created.body as { id: number }).id;
  }
  await authorize('variablegroup', id);
  console.log(
    `variable group ${name.padEnd(18)} ${existing === undefined ? 'created' : 'present'} (id ${id}), authorized`,
  );
}

for (const name of ENVIRONMENTS) await ensureEnvironment(name, config);
await ensureVariableGroup(VARIABLE_GROUP);
