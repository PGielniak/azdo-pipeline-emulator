// E05-S02-T01 — the `.env.example` synthesizer.
//
// The Done criteria are "corpus `.env.example` snapshots" and "lint: no entry without a provenance
// comment". This suite does both: it snapshots the synthesized `.env.example` for every captured
// corpus `final.yml`, and it asserts the lint invariant structurally — every `NAME=` entry line is
// immediately preceded by a `#` provenance comment — plus focused cases for each section.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildPipeline, parsePipelineYaml } from '@azdo-emu/engine';
import { collectConnections } from '../src/connections.js';
import { synthesizeEnvExample } from '../src/env-example.js';
import { loadVendoredTaskDefinitions } from '../src/vendor.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const build = (yaml: string, file = 'pipeline.expanded.yml') =>
  buildPipeline(parsePipelineYaml(yaml, file));

function corpusFinalYamls(): { name: string; finalYaml: string }[] {
  const oracleDir = join(repoRoot, 'fixtures', 'oracle');
  return readdirSync(oracleDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.final.yml'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      name: e.name.slice(0, -'.final.yml'.length),
      finalYaml: readFileSync(join(oracleDir, e.name), 'utf8'),
    }));
}

/** The lint invariant: every `NAME=` entry is preceded by a `#` comment (provenance). */
function assertEveryEntryHasProvenance(content: string): void {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^[A-Z][A-Z0-9_]*=/.test(line)) {
      expect(
        lines[i - 1] ?? '',
        `entry ${line.trim()} at line ${i + 1} lacks a provenance comment`,
      ).toMatch(/^#/);
    }
  }
}

function envEntryNames(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf('=')));
}

describe('synthesizeEnvExample', () => {
  it('emits the documented sections with provenance comments and secret flags', () => {
    const { pipeline } = build(`parameters:
- name: deployEnv
  default: dev
stages:
- stage: Build
  jobs:
  - job: withGroup
    variables:
    - group: my-var-group
    steps:
    - task: CmdLine@2
      displayName: Grouped
      inputs:
        script: echo "grouped=$(fromGroup)"
  - job: noGroup
    steps:
    - task: CmdLine@2
      displayName: Ungrouped
      inputs:
        script: echo "token=$(mySecretToken)"
`);
    expect(pipeline).toBeDefined();
    const { content, manifestEnv, envAliases } = synthesizeEnvExample(pipeline!);
    expect(content).toContain('# 1. Run identity overrides');
    expect(content).toContain('# 2. SYSTEM_ACCESSTOKEN');
    expect(content).toContain('499b84ac-1321-427f-aa17-267ca6975798');
    expect(content).toContain('# 3. Pipeline variables (unresolved');
    expect(content).toContain('MYSECRETTOKEN=');
    expect(content).toContain('# used by Build/noGroup/step 1 (macro in input)');
    expect(content).toContain('# 4. Variable groups');
    expect(content).toContain('FROMGROUP=');
    expect(content).toContain("# from group 'my-var-group'");
    expect(content).toContain('# 5. Runtime parameters');
    expect(content).toContain('DEPLOYENV=dev');
    expect(manifestEnv).toEqual([
      { name: 'SYSTEM_ACCESSTOKEN', secret: true, origin: 'ADO REST / feeds access' },
    ]);
    expect(envAliases).toEqual([
      { name: 'BUILD_SOURCEBRANCH', variable: 'Build.SourceBranch' },
      { name: 'BUILD_REASON', variable: 'Build.Reason' },
      { name: 'SYSTEM_PULLREQUEST_SOURCEBRANCH', variable: 'System.PullRequest.SourceBranch' },
      { name: 'SYSTEM_PULLREQUEST_TARGETBRANCH', variable: 'System.PullRequest.TargetBranch' },
      { name: 'SYSTEM_ACCESSTOKEN', variable: 'System.AccessToken' },
      { name: 'MYSECRETTOKEN', variable: 'mySecretToken' },
      { name: 'FROMGROUP', variable: 'fromGroup' },
      { name: 'DEPLOYENV', variable: 'deployEnv' },
    ]);
    expect(content).toMatchSnapshot();
  });

  it('does not demand a predefined variable in .env', () => {
    const { pipeline } = build(`stages:
- stage: Build
  jobs:
  - job: build
    steps:
    - task: CmdLine@2
      inputs:
        script: echo "id=$(Build.BuildId) secret=$(mySecretToken)"
`);
    expect(pipeline).toBeDefined();
    const { content } = synthesizeEnvExample(pipeline!);
    // Build.BuildId is predefined; it must not become a .env entry.
    expect(content).not.toMatch(/^BUILD_BUILDID=/m);
    // mySecretToken is unresolved → it must.
    expect(content).toMatch(/^MYSECRETTOKEN=/m);
  });

  it('allocates valid unique env identifiers while retaining exact colliding variable names', () => {
    const { pipeline } = build(`stages:
- stage: Build
  jobs:
  - job: build
    steps:
    - task: CmdLine@2
      inputs:
        script: echo "$(a-b) $(a.b) $(123name)"
`);
    const result = synthesizeEnvExample(pipeline!);

    expect(result.envAliases.slice(-3)).toEqual([
      { name: 'A_B', variable: 'a-b' },
      { name: 'A_B__2', variable: 'a.b' },
      { name: 'AZDO_123NAME', variable: '123name' },
    ]);
    for (const alias of result.envAliases) {
      expect(alias.name).toMatch(/^[A-Z_][A-Z0-9_]*$/);
    }
  });

  it('every entry has a provenance comment (the lint invariant)', () => {
    for (const { name, finalYaml } of corpusFinalYamls()) {
      const { pipeline, diagnostics } = build(finalYaml, `${name}.final.yml`);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(pipeline).toBeDefined();
      assertEveryEntryHasProvenance(synthesizeEnvExample(pipeline!).content);
    }
  });

  it('gives every generated .env entry one exact runtime alias', () => {
    for (const { name, finalYaml } of corpusFinalYamls()) {
      const { pipeline } = build(finalYaml, `${name}.final.yml`);
      expect(pipeline).toBeDefined();
      const result = synthesizeEnvExample(pipeline!);
      expect(
        result.envAliases.map((alias) => alias.name),
        name,
      ).toEqual(envEntryNames(result.content));
    }
  });

  it('synthesizes every corpus pipeline deterministically', () => {
    for (const { name, finalYaml } of corpusFinalYamls()) {
      const { pipeline } = build(finalYaml, `${name}.final.yml`);
      expect(pipeline).toBeDefined();
      const first = synthesizeEnvExample(pipeline!);
      const second = synthesizeEnvExample(pipeline!);
      expect(first.content).toBe(second.content);
      expect(first.content, name).toMatchSnapshot();
    }
  });
});

describe('section 6 — service connections (E08-S02-T01)', () => {
  const { pipeline } = build(`stages:
- stage: Deploy
  jobs:
  - job: deploy
    steps:
    - task: AzureCLI@2
      inputs:
        azureSubscription: my-prod-sub
        scriptType: bash
        scriptLocation: inlineScript
        inlineScript: az account show
`);

  it('emits a block per connection under the names the real task reads (C-E08-001)', () => {
    const collected = collectConnections(
      pipeline!.stages.flatMap((stage) =>
        stage.jobs.flatMap((job) =>
          job.steps.map((step) => ({ step, path: `${stage.id}/${job.id}/step ${step.id}` })),
        ),
      ),
      loadVendoredTaskDefinitions(),
    );
    const { content, manifestEnv } = synthesizeEnvExample(pipeline!, {
      connections: collected.connections,
    });

    expect(content).toContain("# ── Service connection 'my-prod-sub' · mode: sp");
    expect(content).toContain('ENDPOINT_AUTH_PARAMETER_my-prod-sub_SERVICEPRINCIPALID=');
    expect(content).toContain('used by: Deploy/deploy/step 1');

    // The ENDPOINT_ keys must reach the manifest under the task's spelling — not through the
    // Bash-safe alias transform, which would rename them to something no task reads.
    const scheme = manifestEnv.find((e) => e.name === 'ENDPOINT_AUTH_SCHEME_my-prod-sub');
    expect(scheme).toMatchObject({ secret: true, origin: "service connection 'my-prod-sub'" });
    expect(
      manifestEnv.find((e) => e.name === 'ENDPOINT_DATA_my-prod-sub_SUBSCRIPTIONID'),
    ).toMatchObject({ secret: false });
  });

  it('says the pipeline references none rather than leaving the section blank', () => {
    const { content } = synthesizeEnvExample(pipeline!);
    expect(content).toContain('# (this pipeline references none)');
    expect(content).toContain('# Secure files are not implemented yet');
  });
});
