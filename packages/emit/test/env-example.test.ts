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
import { synthesizeEnvExample } from '../src/env-example.js';

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
    const { content, manifestEnv } = synthesizeEnvExample(pipeline!);
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

  it('every entry has a provenance comment (the lint invariant)', () => {
    for (const { name, finalYaml } of corpusFinalYamls()) {
      const { pipeline, diagnostics } = build(finalYaml, `${name}.final.yml`);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(pipeline).toBeDefined();
      assertEveryEntryHasProvenance(synthesizeEnvExample(pipeline!).content);
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
