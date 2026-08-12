// E02-S04-T03 grounding — what the `resources` expression context actually contains at run time.
//
// The Learn pages give a 12-name field list for a pipeline resource but describe those names as
// "predefined variables", written `$(resources.pipeline.<Alias>.runID)`. Whether that family is a
// member of the `resources` *context* (which C-E02-082 measured as legal in a root `$[ ]` variable)
// or a set of flat variables that merely look like a path is the question that decides the module,
// and no doc sentence answers it. Two runs measure it:
//
//   probe 1 — a pipeline resource declared; every documented field read three ways in the same run:
//             the `resources.pipeline.<alias>.<field>` chain, `variables['<same dotted name>']`, and
//             the `$(macro)`; plus `convertToJson(resources)` to dump the context wholesale, plus a
//             job whose `condition:` reads the dotted name (conditions reject `resources` itself, so
//             this is the only path an author has there), plus a false-condition control.
//   probe 2 — the half probe 1 found the context *does* carry: `resources.repositories.<alias>` and
//             `resources.containers`. Alias/field case folding and miss policy are measured here
//             rather than inherited from `variables`/`parameters`, and the risky misses live in
//             their own job so a raise cannot take the measuring job down with it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  authorizationHeader,
  configFromEnv,
  redact,
  type OracleConfig,
} from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';

/** The pipeline whose runs probe 1 consumes as a resource. Created by E02-S04-T02. */
const SOURCE_PIPELINE = 'oracle-dependencies-probe';
const out = path.join('research/experiments/E02-resources');
await mkdir(out, { recursive: true });

const env = await loadEnvFile('.env.oracle');
const cfg: OracleConfig = configFromEnv(env);
const org = cfg.orgUrl.replace(/\/+$/, '');
const project = encodeURIComponent(cfg.project);
const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: authorizationHeader(cfg.pat),
};

/** A run takes minutes of polling, and a single transient ETIMEDOUT should not discard it. */
async function fetchRetrying(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

async function api(route: string, init: RequestInit = {}) {
  const response = await fetchRetrying(`${org}/${project}/_apis/${route}`, {
    ...init,
    redirect: 'manual',
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${route}: HTTP ${response.status} ${redact(text, cfg).slice(0, 500)}`);
  return JSON.parse(text) as any;
}

const PIPELINE_YAML = `resources:
  pipelines:
  - pipeline: probe
    source: ${SOURCE_PIPELINE}

trigger: none

variables:
  resJson: $[ convertToJson(resources) ]
  bareResourcesPipeline: $[ convertToJson(resources.pipeline) ]
  chainRunId: $[ resources.pipeline.probe.runID ]
  chainRunName: $[ resources.pipeline.probe.runName ]
  chainRunUri: $[ resources.pipeline.probe.runURI ]
  chainSourceBranch: $[ resources.pipeline.probe.sourceBranch ]
  chainSourceCommit: $[ resources.pipeline.probe.sourceCommit ]
  chainSourceProvider: $[ resources.pipeline.probe.sourceProvider ]
  chainPipelineId: $[ resources.pipeline.probe.pipelineID ]
  chainPipelineName: $[ resources.pipeline.probe.pipelineName ]
  chainProjectId: $[ resources.pipeline.probe.projectID ]
  chainRequestedFor: $[ resources.pipeline.probe.requestedFor ]
  chainRequestedForId: $[ resources.pipeline.probe.requestedForID ]
  projName: $[ resources.pipeline.probe.projectName ]
  flatVar: $[ variables['resources.pipeline.probe.runID'] ]
  flatVarProjectName: $[ variables['resources.pipeline.probe.projectName'] ]
  aliasUpper: $[ resources.pipeline.PROBE.runID ]
  fieldUpper: $[ resources.pipeline.probe.RUNID ]
  pluralPath: $[ resources.pipelines.probe.runID ]

jobs:
- job: Probe
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo "P|resJson|\${RESJSON}"
      echo "P|bareResourcesPipeline|[\${BARE}]"
      echo "P|chainRunId|[\${CHAIN_RUNID}]"
      echo "P|chainRunName|[\${CHAIN_RUNNAME}]"
      echo "P|chainRunUri|[\${CHAIN_RUNURI}]"
      echo "P|chainSourceBranch|[\${CHAIN_SOURCEBRANCH}]"
      echo "P|chainSourceCommit|[\${CHAIN_SOURCECOMMIT}]"
      echo "P|chainSourceProvider|[\${CHAIN_SOURCEPROVIDER}]"
      echo "P|chainPipelineId|[\${CHAIN_PIPELINEID}]"
      echo "P|chainPipelineName|[\${CHAIN_PIPELINENAME}]"
      echo "P|chainProjectId|[\${CHAIN_PROJECTID}]"
      echo "P|chainRequestedFor|[\${CHAIN_REQUESTEDFOR}]"
      echo "P|chainRequestedForId|[\${CHAIN_REQUESTEDFORID}]"
      echo "P|projName|[\${PROJNAME}]"
      echo "P|flatVar|[\${FLATVAR}]"
      echo "P|flatVarProjectName|[\${FLATVAR_PROJECTNAME}]"
      echo "P|aliasUpper|[\${ALIASUPPER}]"
      echo "P|fieldUpper|[\${FIELDUPPER}]"
      echo "P|pluralPath|[\${PLURALPATH}]"
      echo "P|macro|[\${MACRO}]"
      printenv | grep -i '^RESOURCES' | sort | sed 's/^/P|env|/' || echo "P|env|<none>"
    env:
      RESJSON: $(resJson)
      BARE: $(bareResourcesPipeline)
      CHAIN_RUNID: $(chainRunId)
      CHAIN_RUNNAME: $(chainRunName)
      CHAIN_RUNURI: $(chainRunUri)
      CHAIN_SOURCEBRANCH: $(chainSourceBranch)
      CHAIN_SOURCECOMMIT: $(chainSourceCommit)
      CHAIN_SOURCEPROVIDER: $(chainSourceProvider)
      CHAIN_PIPELINEID: $(chainPipelineId)
      CHAIN_PIPELINENAME: $(chainPipelineName)
      CHAIN_PROJECTID: $(chainProjectId)
      CHAIN_REQUESTEDFOR: $(chainRequestedFor)
      CHAIN_REQUESTEDFORID: $(chainRequestedForId)
      PROJNAME: $(projName)
      FLATVAR: $(flatVar)
      FLATVAR_PROJECTNAME: $(flatVarProjectName)
      ALIASUPPER: $(aliasUpper)
      FIELDUPPER: $(fieldUpper)
      PLURALPATH: $(pluralPath)
      MACRO: $(resources.pipeline.probe.runID)
- job: Risky
  dependsOn: []
  pool:
    vmImage: ubuntu-latest
  variables:
    missAlias: $[ resources.pipeline.nosuchalias.runID ]
    missField: $[ resources.pipeline.probe.noSuchField ]
  steps:
  - bash: |
      echo "R|missAlias|[\${MISS_ALIAS}]"
      echo "R|missField|[\${MISS_FIELD}]"
    env:
      MISS_ALIAS: $(missAlias)
      MISS_FIELD: $(missField)
- job: CondFlat
  dependsOn: []
  condition: ne(variables['resources.pipeline.probe.runID'], '')
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: echo "C|condFlatRan|yes"
- job: CondFlatControl
  dependsOn: []
  condition: eq(variables['resources.pipeline.probe.runID'], 'definitely-not-the-run-id')
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: echo "C|condFlatControlRan|yes"
`;

const REPOSITORY_YAML = `resources:
  repositories:
  - repository: MixedAlias
    type: git
    name: oracle
    ref: refs/heads/main
  containers:
  - container: probeimg
    image: alpine:3.20

trigger: none

variables:
  reposJson: $[ convertToJson(resources.repositories) ]
  containersJson: $[ convertToJson(resources.containers) ]
  selfRef: $[ resources.repositories.self.ref ]
  selfIndex: $[ resources.repositories['self']['ref'] ]
  aliasUpper: $[ resources.repositories.SELF.ref ]
  fieldUpper: $[ resources.repositories.self.REF ]
  declaredAsWritten: $[ resources.repositories.MixedAlias.name ]
  declaredLowered: $[ resources.repositories.mixedalias.name ]
  flatRepoVar: $[ variables['resources.repositories.self.ref'] ]
  containerType: $[ resources.containers.probeimg.image ]
  containerSingular: $[ convertToJson(resources.container) ]

jobs:
- job: Probe
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo "P|reposJson|\${REPOS}"
      echo "P|containersJson|[\${CONTAINERS}]"
      echo "P|selfRef|[\${SELF_REF}]"
      echo "P|selfIndex|[\${SELF_INDEX}]"
      echo "P|aliasUpper|[\${ALIAS_UPPER}]"
      echo "P|fieldUpper|[\${FIELD_UPPER}]"
      echo "P|declaredAsWritten|[\${DECLARED_AS_WRITTEN}]"
      echo "P|declaredLowered|[\${DECLARED_LOWERED}]"
      echo "P|flatRepoVar|[\${FLAT_REPO_VAR}]"
      echo "P|containerImage|[\${CONTAINER_IMAGE}]"
      echo "P|containerSingular|[\${CONTAINER_SINGULAR}]"
      printenv | grep -i '^RESOURCES' | sort | sed 's/^/P|env|/' || echo "P|env|<none>"
    env:
      REPOS: $(reposJson)
      CONTAINERS: $(containersJson)
      SELF_REF: $(selfRef)
      SELF_INDEX: $(selfIndex)
      ALIAS_UPPER: $(aliasUpper)
      FIELD_UPPER: $(fieldUpper)
      DECLARED_AS_WRITTEN: $(declaredAsWritten)
      DECLARED_LOWERED: $(declaredLowered)
      FLAT_REPO_VAR: $(flatRepoVar)
      CONTAINER_IMAGE: $(containerType)
      CONTAINER_SINGULAR: $(containerSingular)
- job: Risky
  dependsOn: []
  pool:
    vmImage: ubuntu-latest
  variables:
    missAlias: $[ resources.repositories.nosuchalias.ref ]
    missField: $[ resources.repositories.self.noSuchField ]
  steps:
  - bash: |
      echo "R|repoMissAlias|[\${MISS_ALIAS}]"
      echo "R|repoMissField|[\${MISS_FIELD}]"
    env:
      MISS_ALIAS: $(missAlias)
      MISS_FIELD: $(missField)
`;

const MARKER = /^[PRC]\|[A-Za-z]+\|/;

async function runProbe(name: string, file: string, repo: RepoRef) {
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
          path: `/experiments-resources/${file}`,
          repository: { id: repo.id, name: repo.name, type: 'azureReposGit' },
        },
      }),
    });

  // A pipeline created by an earlier version of this script may still point at that version's YAML
  // path; `syncFiles` mirrors the scope path, so the old file is gone and the run would 400 on a
  // missing file. Repoint the definition instead of leaving a broken pipeline in the org.
  const definition = await api(`build/definitions/${pipeline.id}?api-version=7.1`);
  if (definition.process?.yamlFilename !== `/experiments-resources/${file}`) {
    definition.process = { ...definition.process, yamlFilename: `/experiments-resources/${file}` };
    await api(`build/definitions/${pipeline.id}?api-version=7.1`, {
      method: 'PUT',
      body: JSON.stringify(definition),
    });
  }

  const run = await api(`pipelines/${pipeline.id}/runs?api-version=7.1-preview.1`, {
    method: 'POST',
    body: JSON.stringify({
      resources: { repositories: { self: { refName: repo.defaultBranch } } },
    }),
  });
  let final: any;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    final = await api(`pipelines/${pipeline.id}/runs/${run.id}?api-version=7.1-preview.1`);
    if (final.state === 'completed') break;
  }

  // Log bodies come back as {count, value: [line, …]} with an ISO timestamp per line, and the first
  // body is the expanded YAML — which contains the `echo` sources and would otherwise be mistaken
  // for output. Keep only marker lines whose payload is not still a shell variable reference.
  const logs = await api(`build/builds/${run.id}/logs?api-version=7.1`);
  const lines: string[] = [];
  for (const item of logs.value ?? []) {
    const body = await fetchRetrying(
      `${org}/${project}/_apis/build/builds/${run.id}/logs/${item.id}?api-version=7.1`,
      { headers },
    );
    const parsed = JSON.parse(await body.text()) as { value?: string[] };
    let inJsonDump = false;
    for (const line of parsed.value ?? []) {
      const stripped = line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, '');
      if (MARKER.test(stripped)) {
        // `${…}` means this is the echo *source* from the expanded-YAML log, not its output.
        inJsonDump = false;
        if (stripped.includes('${')) continue;
        lines.push(stripped);
        // A `convertToJson` value spans lines; everything up to the next marker belongs to it.
        inJsonDump = stripped.endsWith('{') || stripped.endsWith('[');
        continue;
      }
      if (inJsonDump) lines.push(stripped);
    }
  }

  const timeline = await api(`build/builds/${run.id}/timeline?api-version=7.1`);
  const jobs = (timeline.records ?? [])
    .filter((r: any) => r.type === 'Job')
    .map((r: any) => ({ name: r.name, result: r.result }));

  return { runId: run.id, result: final.result, output: lines.join('\n'), jobs };
}

const repo = await defaultRepository(cfg);
// Both probe files go up in one commit: `syncFiles` mirrors the scope path, so syncing them one at
// a time would delete the previous probe's YAML and leave its pipeline definition dangling.
const files = [
  { name: 'resources-pipeline.yml', content: PIPELINE_YAML },
  { name: 'resources-repository.yml', content: REPOSITORY_YAML },
];
for (const file of files) await writeFile(path.join(out, file.name), file.content);
await syncFiles(
  cfg,
  repo,
  repo.defaultBranch,
  '/experiments-resources',
  files.map((file) => ({ path: `/experiments-resources/${file.name}`, content: file.content })),
  'E02-S04-T03 resources context probes',
);

const pipelineProbe = await runProbe('oracle-resources-probe', 'resources-pipeline.yml', repo);
const repositoryProbe = await runProbe(
  'oracle-resources-repo-probe',
  'resources-repository.yml',
  repo,
);

// The REST view of the source run, so the context/variable field → REST field mapping the emitter
// needs (E08 pins these) is recorded rather than inferred.
const pipelines = await api('pipelines?api-version=7.1-preview.1');
const source = pipelines.value?.find((p: any) => p.name === SOURCE_PIPELINE);
const sourceRuns = await api(`pipelines/${source.id}/runs?api-version=7.1-preview.1`);
const latest = sourceRuns.value?.[0];
const sourceRun = await api(`pipelines/${source.id}/runs/${latest.id}?api-version=7.1-preview.1`);
const sourceBuild = await api(`build/builds/${latest.id}?api-version=7.1`);

/**
 * `redact` removes the PAT and the organization name, which is everything the oracle spike knew to
 * look for (C-E00-021/027). A pipeline-resource transcript adds a third leak it cannot know about:
 * `requestedFor` is a **person's display name**, and it lands both in the run's REST payload and in
 * the `RESOURCES_PIPELINE_<ALIAS>_REQUESTEDFOR` environment variable. Collect every identity string
 * the service returned and scrub those too, rather than hand-editing the transcript.
 */
function identityStrings(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const item of node) identityStrings(item, found);
  else if (node !== null && typeof node === 'object')
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'displayName' || key === 'uniqueName') && typeof value === 'string')
        found.add(value);
      else identityStrings(value, found);
    }
  return found;
}

function scrub(text: string, identities: ReadonlySet<string>): string {
  let out = redact(text, cfg);
  for (const identity of identities) {
    if (identity.length < 3) continue;
    out = out.split(identity).join('{user}');
  }
  return out;
}

const identities = identityStrings([sourceRun, sourceBuild]);

const section = (title: string, probe: Awaited<ReturnType<typeof runProbe>>) =>
  `## ${title}\n\nRun ${probe.runId}: ${probe.result}\n\nJobs: ${probe.jobs
    .map((j: any) => `${j.name}=${j.result ?? 'n/a'}`)
    .join(', ')}\n\n\`\`\`text\n${scrub(probe.output, identities)}\n\`\`\`\n\n`;

await writeFile(
  path.join(out, 'real-run.md'),
  `# E02-S04-T03 — the \`resources\` context at run time\n\n` +
    `Probe sources: \`resources-pipeline.yml\`, \`resources-repository.yml\` (this directory).\n` +
    `Pipeline resource source: \`${SOURCE_PIPELINE}\`, latest run ${latest.id}.\n\n` +
    section('Probe 1 — pipeline resource', pipelineProbe) +
    section('Probe 2 — repository & container resources', repositoryProbe) +
    `## Source run REST metadata (Pipelines \`runs/{id}\`)\n\n\`\`\`json\n${scrub(
      JSON.stringify(sourceRun, null, 2),
      identities,
    )}\n\`\`\`\n\n## Source run REST metadata (Build \`builds/{id}\`)\n\n\`\`\`json\n${scrub(
      JSON.stringify(sourceBuild, null, 2),
      identities,
    )}\n\`\`\`\n`,
);
console.log(pipelineProbe.output);
console.log('---');
console.log(repositoryProbe.output);
console.log(
  `\nprobe1 run ${pipelineProbe.runId}: ${pipelineProbe.result} · probe2 run ${repositoryProbe.runId}: ${repositoryProbe.result}`,
);
