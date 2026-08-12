// E02-S04-T02 grounding — capture the runtime JSON shapes Azure exposes for dependency contexts.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';
import { defaultRepository, syncFiles } from './azdo-repo.ts';

const out = path.join('research/experiments/E02-dependencies');
await mkdir(out, { recursive: true });
const env = await loadEnvFile('.env.oracle');
const cfg = configFromEnv(env);
const org = cfg.orgUrl.replace(/\/+$/, '');
const project = encodeURIComponent(cfg.project);
const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: authorizationHeader(cfg.pat),
};
async function api(route: string, init: RequestInit = {}) {
  const response = await fetch(`${org}/${project}/_apis/${route}`, {
    ...init,
    redirect: 'manual',
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${route}: HTTP ${response.status} ${redact(text, cfg).slice(0, 500)}`);
  return JSON.parse(text) as any;
}
const yaml = `stages:\n- stage: Produce\n  jobs:\n  - job: A\n    pool:\n      vmImage: ubuntu-latest\n    steps:\n    - bash: echo "##vso[task.setvariable variable=answer;isOutput=true]42"\n      name: setAnswer\n- stage: Consume\n  dependsOn: Produce\n  jobs:\n  - job: B\n    variables:\n      depsJson: $[ convertToJson(dependencies) ]\n      stageDepsJson: $[ convertToJson(stageDependencies) ]\n    pool:\n      vmImage: ubuntu-latest\n    steps:\n    - bash: |\n        echo "DEPS=$(depsJson)"\n        echo "STAGE_DEPS=$(stageDepsJson)"\n`;
await writeFile(path.join(out, 'dependencies.yml'), yaml);
const repo = await defaultRepository(cfg);
await syncFiles(
  cfg,
  repo,
  repo.defaultBranch,
  '/experiments',
  [{ path: '/experiments/dependencies.yml', content: yaml }],
  'E02-S04-T02 dependencies shape probe',
);
const name = 'oracle-dependencies-probe';
const pipelines = await api('pipelines?api-version=7.1-preview.1');
let pipeline = pipelines.value?.find((p: any) => p.name === name);
if (!pipeline)
  pipeline = await api('pipelines?api-version=7.1-preview.1', {
    method: 'POST',
    body: JSON.stringify({
      folder: '\\',
      name,
      configuration: {
        type: 'yaml',
        path: '/experiments/dependencies.yml',
        repository: { id: repo.id, name: repo.name, type: 'azureReposGit' },
      },
    }),
  });
const run = await api(`pipelines/${pipeline.id}/runs?api-version=7.1-preview.1`, {
  method: 'POST',
  body: JSON.stringify({ resources: { repositories: { self: { refName: repo.defaultBranch } } } }),
});
let final: any;
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  final = await api(`pipelines/${pipeline.id}/runs/${run.id}?api-version=7.1-preview.1`);
  if (final.state === 'completed') break;
}
const logs = await api(`build/builds/${run.id}/logs?api-version=7.1`);
const entries: string[] = [];
for (const item of logs.value ?? []) {
  const body = await fetch(
    `${org}/${project}/_apis/build/builds/${run.id}/logs/${item.id}?api-version=7.1`,
    { headers },
  );
  entries.push(await body.text());
}
const redacted = entries
  .join('\n')
  .split('\n')
  .filter((line) => line.includes('DEPS=') || line.includes('STAGE_DEPS='))
  .join('\n');
await writeFile(
  path.join(out, 'real-run.md'),
  `# E02-S04-T02 dependency context real run\n\nRun ${run.id}: ${final.result}\n\n\`\`\`text\n${redact(redacted, cfg)}\n\`\`\`\n`,
);
console.log(redacted);
