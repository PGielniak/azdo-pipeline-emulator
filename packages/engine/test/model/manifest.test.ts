// E04-S03-T04 — the `manifest.json` serializer.
//
// Three things are proven here, matching the task's Done criteria:
//   1. The serialized shape is what docs/04 §11 specifies — pinned by unit tests and by golden
//      manifests over the whole corpus (built from the captured `final.yml`s, so the input is the
//      service's own output, not a hand-written approximation).
//   2. Every manifest validates against the committed JSON schema (`schema/manifest.schema.json`),
//      and the schema is draft-07 + strict-ajv-clean — so "the manifest is versioned and shape-stable"
//      is a check against a real validator, not a snapshot of our own output.
//   3. The expansion record is serialized in both arms, and the offline arm is structurally unable
//      to claim service provenance (the E12-S01-T01 pointer).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import { buildPipeline } from '../../src/model/build.js';
import {
  MANIFEST_SCHEMA_VERSION,
  manifestSchemaPath,
  readManifestSchema,
  serializeManifest,
  type ManifestExpansion,
  type SerializedManifest,
} from '../../src/model/manifest.js';
import type { Pipeline } from '../../src/model/types.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const build = (yaml: string, file = 'pipeline.expanded.yml') =>
  buildPipeline(parsePipelineYaml(yaml, file));

const serviceExpansion = (yaml: string): ManifestExpansion => ({
  mode: 'service',
  degraded: false,
  requestHash: sha256(yaml),
  finalYamlHash: sha256('final'),
  apiVersion: '7.1',
  pipelineId: 0,
  fromCache: false,
});

const offlineExpansion = (yaml: string): ManifestExpansion => ({
  mode: 'offline',
  degraded: true,
  requestHash: sha256(yaml),
  finalYamlHash: sha256('final'),
});

/** The corpus input/`final.yml` pairs, read straight off disk (no scripts import — sync and self-contained). */
function corpusPairs(): { name: string; rootYaml: string; finalYaml: string }[] {
  const oracleDir = join(repoRoot, 'fixtures', 'oracle');
  const corpusDir = join(repoRoot, 'fixtures', 'corpus');
  return readdirSync(oracleDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.final.yml'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => {
      const name = e.name.slice(0, -'.final.yml'.length);
      return {
        name,
        rootYaml: readFileSync(join(corpusDir, name, 'pipeline.yml'), 'utf8'),
        finalYaml: readFileSync(join(oracleDir, e.name), 'utf8'),
      };
    });
}

describe('schema', () => {
  const ajv = new Ajv({ strict: true, allErrors: true });

  it('is draft-07 and compiles under strict ajv', () => {
    const schema = readManifestSchema();
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(() => ajv.compile(schema)).not.toThrow();
  });

  it('lives under packages/engine/schema', () => {
    expect(manifestSchemaPath()).toMatch(/schema\/manifest\.schema\.json$/);
  });
});

describe('serializeManifest', () => {
  const minimal = `stages:
- stage: Build
  jobs:
  - job: BuildJob
    steps:
    - task: DotNetCoreCLI@2
      displayName: Build solution
      inputs:
        command: build
`;

  it('emits the versioned envelope and the pipeline name/parameters', () => {
    const pipeline = build(
      `name: my-pipeline
parameters:
- name: deployEnv
  default: dev
${minimal}`,
    ).pipeline;
    const manifest = serializeManifest(pipeline!, { expansion: serviceExpansion('x') });

    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.pipeline).toEqual({ name: 'my-pipeline', parameters: { deployEnv: 'dev' } });
    expect(manifest.env).toEqual([]);
    expect(manifest.tools).toEqual([]);
    expect(manifest.warnings).toEqual([]);
    expect(manifest.unsupported).toEqual([]);
  });

  it('serializes a step faithfully, joining `Name@version` back together', () => {
    const pipeline = build(minimal).pipeline;
    const manifest = serializeManifest(pipeline!, { expansion: serviceExpansion('x') });

    const step = manifest.stages[0]?.jobs[0]?.steps[0];
    expect(step).toMatchObject({
      id: 1,
      displayName: 'Build solution',
      task: 'DotNetCoreCLI@2',
      inputs: { command: 'build' },
      continueOnError: false,
      retryCountOnTaskFailure: 0,
      enabled: true,
      failOnStderr: false,
      warnings: [],
    });
    expect(step?.source).toEqual({ file: 'pipeline.expanded.yml', line: expect.any(Number) });
  });

  it('applies the sequential stage default to `dependsOn` (C-E04-123)', () => {
    const pipeline = build(
      `stages:
- stage: A
  jobs: []
- stage: B
  jobs: []
- stage: C
  dependsOn: []
  jobs: []
`,
    ).pipeline;
    const manifest = serializeManifest(pipeline!, { expansion: serviceExpansion('x') });

    expect(manifest.stages.map((s) => s.dependsOn)).toEqual([[], ['A'], []]);
  });

  it('serializes both expansion arms and keeps them discriminated', () => {
    const pipeline = build(minimal).pipeline!;
    const service = serializeManifest(pipeline, { expansion: serviceExpansion('x') });
    const offline = serializeManifest(pipeline, { expansion: offlineExpansion('x') });

    expect(service.expansion).toMatchObject({ mode: 'service', degraded: false });
    expect(offline.expansion).toMatchObject({ mode: 'offline', degraded: true });
    // The offline arm has no api-version/pipeline id to leak.
    expect('apiVersion' in offline.expansion).toBe(false);
    expect('pipelineId' in offline.expansion).toBe(false);
  });

  it('passes the env/tools/warnings/unsupported hooks through', () => {
    const pipeline = build(minimal).pipeline!;
    const manifest = serializeManifest(pipeline, {
      expansion: serviceExpansion('x'),
      env: [{ name: 'SC_X_SECRET', secret: true, origin: "service connection 'x'" }],
      tools: [{ cmd: 'dotnet', min: '8.0', neededBy: ['Build/BuildJob/1'] }],
      warnings: [{ code: 'demo', message: 'note', location: { file: 'a.yml', line: 3 } }],
      unsupported: ['approvals'],
    });

    expect(manifest.env).toEqual([
      { name: 'SC_X_SECRET', secret: true, origin: "service connection 'x'" },
    ]);
    expect(manifest.tools).toEqual([{ cmd: 'dotnet', min: '8.0', neededBy: ['Build/BuildJob/1'] }]);
    expect(manifest.warnings).toEqual([
      { code: 'demo', message: 'note', location: { file: 'a.yml', line: 3 } },
    ]);
    expect(manifest.unsupported).toEqual(['approvals']);
  });

  it('serializes a deployment strategy with its hook steps (E04-S03-T03)', () => {
    const pipeline = build(
      `stages:
- stage: Deploy
  jobs:
  - deployment: production
    environment:
      name: prod
    strategy:
      rolling:
        maxParallel: 2
    steps: []
`,
    ).pipeline;
    const manifest = serializeManifest(pipeline!, { expansion: serviceExpansion('x') });

    const job = manifest.stages[0]?.jobs[0];
    expect(job).toMatchObject({ kind: 'deployment', environment: { name: 'prod' } });
    expect(job?.strategy).toEqual({ kind: 'rolling' });
  });

  it('serializes a matrix job into its concrete legs with matrixKey (E04-S03-T01)', () => {
    const pipeline = build(
      `stages:
- stage: A
  jobs:
  - job: Build
    strategy:
      matrix:
        Alpha: { V: a }
        Beta: { V: b }
    steps:
    - task: CmdLine@2
      inputs: { script: echo }
`,
    ).pipeline;
    const manifest = serializeManifest(pipeline!, { expansion: serviceExpansion('x') });

    expect(manifest.stages[0]?.jobs.map((j) => j.id)).toEqual(['Build Alpha', 'Build Beta']);
    expect(manifest.stages[0]?.jobs[0]?.matrixKey).toBe('Alpha');
  });
});

describe('schema validation', () => {
  const validate = new Ajv({ strict: true, allErrors: true }).compile(readManifestSchema());

  it('accepts a serialized manifest', () => {
    const pipeline = build(
      `stages:
- stage: A
  jobs:
  - job: B
    steps:
    - task: CmdLine@2
      inputs: { script: echo }
`,
    ).pipeline!;
    const ok = validate(serializeManifest(pipeline, { expansion: serviceExpansion('x') }));
    expect(validate.errors, JSON.stringify(validate.errors, null, 2)).toBeNull();
    expect(ok).toBe(true);
  });

  it('rejects an offline expansion entry that claims service provenance', () => {
    const pipeline = build('stages: []').pipeline!;
    const malformed = serializeManifest(pipeline, {
      expansion: { ...offlineExpansion('x'), apiVersion: '7.1' } as unknown as ManifestExpansion,
    });
    expect(validate(malformed)).toBe(false);
  });

  it('validates every corpus golden manifest', () => {
    for (const { name, rootYaml, finalYaml } of corpusPairs()) {
      const manifest = goldenFor(rootYaml, finalYaml, `${name}.final.yml`);
      const ok = validate(manifest);
      expect(validate.errors, `${name}: ${JSON.stringify(validate.errors)}`).toBeNull();
      expect(ok).toBe(true);
    }
  });
});

describe('golden corpus manifests', () => {
  it.each(corpusPairs().map((p) => [p.name, p] as const))('%s serializes stably', (_name, pair) => {
    expect(goldenFor(pair.rootYaml, pair.finalYaml, `${pair.name}.final.yml`)).toMatchSnapshot();
  });
});

/** Build a deterministic manifest from a corpus input/final pair — the golden the snapshot pins. */
function goldenFor(rootYaml: string, finalYaml: string, file: string): SerializedManifest {
  const pipeline = build(finalYaml, file).pipeline as Pipeline;
  return serializeManifest(pipeline, {
    expansion: {
      mode: 'service',
      degraded: false,
      requestHash: sha256(rootYaml),
      finalYamlHash: sha256(finalYaml),
      apiVersion: '7.1',
      pipelineId: 0,
      fromCache: false,
    },
  });
}
