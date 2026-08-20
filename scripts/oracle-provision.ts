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
/**
 * Second Azure Repos Git repository, so E03-S02-T01 can exercise a cross-repo `@alias` template
 * reference. The oracle cannot answer the `@alias`/`@self` half of reference resolution with one
 * repo: the whole question is which repository a path is read from. Seeded with a single
 * placeholder file so the branch exists; `scripts/reference-survey.ts` pushes the probe tree.
 */
const TEMPLATE_REPO = 'azdo-emu-templates';

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

/**
 * Create the template repository if absent, give it a first commit if it is still empty (a repo
 * with no default branch cannot be pushed to with a normal `oldObjectId`), and authorize it for
 * the anchor pipeline. A repository resource the pipeline may not read is rejected the same way
 * an unauthorized environment is, so the authorize call is not optional.
 */
async function ensureTemplateRepository(name: string): Promise<void> {
  const list = await api(`${org}/${project}/_apis/git/repositories?api-version=7.1`);
  require2xx('list repositories', list);
  const repos = (list.body as { value?: { id: string; name: string; defaultBranch?: string }[] })
    .value;
  let repo = (repos ?? []).find((r) => r.name === name);

  const created = repo === undefined;
  if (repo === undefined) {
    const res = await api(`${org}/${project}/_apis/git/repositories?api-version=7.1`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    require2xx(`create repository ${name}`, res);
    repo = res.body as { id: string; name: string; defaultBranch?: string };
  }

  // An empty repo reports no defaultBranch. The push API creates the branch when oldObjectId is
  // the all-zero object id, which is also how the first commit is made through the REST layer.
  let seeded = false;
  if (repo.defaultBranch === undefined) {
    const res = await api(
      `${org}/${project}/_apis/git/repositories/${repo.id}/pushes?api-version=7.1`,
      {
        method: 'POST',
        body: JSON.stringify({
          refUpdates: [{ name: 'refs/heads/main', oldObjectId: '0'.repeat(40) }],
          commits: [
            {
              comment: 'azdo-emu: seed template repository (E03-S02-T01)',
              changes: [
                {
                  changeType: 'add',
                  item: { path: '/README.md' },
                  newContent: {
                    content:
                      '# azdo-emu template fixtures\n\n' +
                      'Cross-repo template fixtures for E03-S02-T01. Contains no secrets.\n',
                    contentType: 'rawtext',
                  },
                },
              ],
            },
          ],
        }),
      },
    );
    require2xx(`seed repository ${name}`, res);
    seeded = true;
  }

  await authorize('repository', `${(await projectId()).id}.${repo.id}`);
  console.log(
    `repository ${name.padEnd(21)} ${created ? 'created' : 'present'}` +
      `${seeded ? ' + seeded' : ''} (id ${repo.id}), authorized`,
  );
}

let cachedProject: { id: string } | undefined;
async function projectId(): Promise<{ id: string }> {
  if (cachedProject === undefined) {
    const res = await api(`${org}/_apis/projects/${project}?api-version=7.1`);
    require2xx('read project', res);
    cachedProject = { id: (res.body as { id: string }).id };
  }
  return cachedProject;
}

for (const name of ENVIRONMENTS) await ensureEnvironment(name, config);
await ensureVariableGroup(VARIABLE_GROUP);
await ensureTemplateRepository(TEMPLATE_REPO);
