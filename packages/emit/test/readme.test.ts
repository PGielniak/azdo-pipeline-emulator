// E05-S02-T02 — the generated README + ranked warnings report.
//
// The task's Done criteria are "README snapshot for corpus" and "broken-link check over generated
// links", so the suite does both halves and one invariant the design depends on:
//
//   1. **Snapshot over the corpus** — every entry's README is built from the captured `final.yml`
//      (the service's own expansion) plus a manifest serialized from it, so the golden is over real
//      pipeline shapes rather than a hand-written approximation.
//   2. **Broken-link check** — every relative link the README emits is resolved against what the
//      emitter actually plans: `scaffold()`'s directories and step paths, `emitEntrypoints()`'s file
//      keys, and the two fixed files (`.env.example`, `.gitignore`). A link that merely *parses* is
//      not enough — the target has to be a file this conversion produces.
//   3. **Label agreement** — the fidelity label in the README table is the same label the emitted
//      `.sh` header prints. That is the whole reason `stepFidelity` falls back to `defaultFidelity`,
//      and it would break silently the day one of the two grows its own rule.
//
// Also pinned: no coverage percentage / tier histogram survives anywhere in the output (PLAN D10
// revised, docs/04 §13's banner) — a regression that re-adds one should fail here, loudly.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildPipeline,
  parsePipelineYaml,
  serializeManifest,
  type Diagnostic,
  type ManifestExpansion,
  type Pipeline,
  type SerializedManifest,
} from '@azdo-emu/engine';

import { emitEntrypoints } from '../src/entrypoints.js';
import { extractLinks, generateReadme, rankWarnings, stepFidelity } from '../src/readme.js';
import { scaffold, type Scaffold } from '../src/scaffold.js';
import { emitStepScript } from '../src/step.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const build = (yaml: string, file = 'pipeline.expanded.yml') =>
  buildPipeline(parsePipelineYaml(yaml, file));

const serviceExpansion = (yaml: string): ManifestExpansion => ({
  mode: 'service',
  degraded: false,
  requestHash: sha256(yaml),
  finalYamlHash: sha256(yaml),
  apiVersion: '7.1-preview.1',
  pipelineId: 42,
  fromCache: false,
});

const offlineExpansion = (yaml: string): ManifestExpansion => ({
  mode: 'offline',
  degraded: true,
  requestHash: sha256(yaml),
  finalYamlHash: sha256(yaml),
});

/** The captured corpus `final.yml`s — the same reader the scaffold and manifest suites use. */
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

/** A pipeline + its plan + its manifest, the three inputs a conversion has at README time. */
function conversion(
  yaml: string,
  expansion: ManifestExpansion = serviceExpansion(yaml),
): { pipeline: Pipeline; plan: Scaffold; manifest: SerializedManifest } {
  const { pipeline, diagnostics } = build(yaml);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const model = pipeline!;
  return {
    pipeline: model,
    plan: scaffold(model),
    manifest: serializeManifest(model, { expansion }),
  };
}

/** The entry-point files a conversion writes, derived from the plan (E05-S01-T03's layout). */
function plannedEntrypoints(plan: Scaffold): Set<string> {
  const paths = new Set<string>(['run.sh']);
  for (const stage of plan.stages) {
    paths.add(`${stage.dir}/conditions.sh`);
    paths.add(`${stage.dir}/run-stage.sh`);
    for (const job of stage.jobs) paths.add(`${job.dir}/run-job.sh`);
  }
  return paths;
}

/**
 * Corpus entries whose entry points cannot be emitted **today**, with the reason.
 *
 * `03` writes `condition: eq(dependencies.web.result, 'Skipped')` on a stage. docs/02 §6 lists
 * `dependencies.<job>.result` as a readable runtime context, but `compileBash` implements only the
 * `outputs[…]` arm and throws `BashCompileError` on `.result` — a gap in the shell backend, not in
 * this task. Filed as **E02-S05-T05**. The link check still runs for these entries against the
 * planned entry-point paths; only the "the emitter agrees with the plan" half is skipped.
 */
const ENTRYPOINTS_BLOCKED = new Set(['03-dependencies-and-conditions']);

/** Everything a conversion of this pipeline actually writes, as project-relative paths. */
function emittedPaths(plan: Scaffold): Set<string> {
  const paths = new Set<string>(['.env.example', '.gitignore', 'README.md']);
  for (const dir of plan.directories) paths.add(dir);
  for (const key of plannedEntrypoints(plan)) paths.add(key);
  for (const stage of plan.stages)
    for (const job of stage.jobs) for (const step of job.steps) paths.add(step.path);
  return paths;
}

// The model consumes the **expanded** YAML — the service has already desugared `script:` into
// `CmdLine@2` with a `script` input — so the fixtures here are written in that shape, exactly like
// the corpus `final.yml`s the golden runs over.
const MINIMAL = `stages:
  - stage: Build
    jobs:
      - job: BuildJob
        steps:
          - task: CmdLine@2
            displayName: Say hello
            inputs:
              script: echo hello
`;

describe('generateReadme — structure', () => {
  it('states the structure, the expansion mode and the gap count, with no coverage metric', () => {
    const { plan, manifest } = conversion(MINIMAL);
    const readme = generateReadme(manifest, plan);

    expect(readme).toContain('- **Structure:** 1 stage, 1 job, 1 step script.');
    expect(readme).toContain('**service** — expanded by Azure DevOps (pipeline `42`');
    // PLAN D10 revised: no percentage, and no tier histogram wearing another hat.
    expect(readme).not.toMatch(/\d+(\.\d+)?%/);
    // (`N unsupported construct(s)` is a count of dropped constructs, not a fidelity histogram.)
    expect(readme).not.toMatch(/\d+ (exact|equivalent|degraded|stub)\b/);
  });

  it('names the pipeline when it has one, and falls back when it does not', () => {
    const named = conversion(`name: nightly-$(Rev:r)\n${MINIMAL}`);
    expect(generateReadme(named.manifest, named.plan)).toMatch(/^# nightly-/);

    const { plan, manifest } = conversion(MINIMAL);
    expect(generateReadme(manifest, plan)).toMatch(/^# Converted Azure DevOps pipeline/);
  });

  it('flags an offline expansion as an approximation (E12-S01-T01)', () => {
    const { plan, manifest } = conversion(MINIMAL, offlineExpansion(MINIMAL));
    const readme = generateReadme(manifest, plan);
    expect(readme).toContain('**offline** — expanded by the local compile-time engine');
    expect(readme).toContain('re-convert online for a faithful tree');
  });

  it('carries a `#fidelity` anchor, which every emitted step header points at', () => {
    const { plan, manifest } = conversion(MINIMAL);
    const readme = generateReadme(manifest, plan);
    expect(readme).toContain('## Fidelity');

    const step = plan.stages[0]!.jobs[0]!.steps[0]!;
    expect(emitStepScript(step.step, step.number)).toContain('see README §fidelity');
  });

  it('shows the effective stage dependsOn, not the authored one (C-E04-123)', () => {
    const { plan, manifest } = conversion(`stages:
  - stage: A
    jobs:
      - job: J
        steps:
          - task: CmdLine@2
            inputs:
              script: echo a
  - stage: B
    jobs:
      - job: K
        steps:
          - task: CmdLine@2
            inputs:
              script: echo b
`);
    // `B` authors no `dependsOn`; the sequential default makes it depend on `A`.
    expect(generateReadme(manifest, plan)).toContain('- depends on: `A`');
  });

  it('handles a pipeline with no stages at all', () => {
    // `convert` rejects this shape (`model-empty-pipeline` is an error diagnostic), so the build is
    // done directly rather than through `conversion()`. The README still has to render it: the
    // emitter is a library, and a caller holding an empty model deserves a page, not a crash.
    const yaml = 'variables:\n  a: b\n';
    const { pipeline, diagnostics } = build(yaml);
    expect(diagnostics.map((d) => d.code)).toContain('model-empty-pipeline');
    const plan = scaffold(pipeline!);
    expect(plan.stages).toEqual([]);
    const manifest = serializeManifest(pipeline!, { expansion: serviceExpansion(yaml) });
    expect(generateReadme(manifest, plan)).toContain('This pipeline has no stages.');
  });

  it('lists the baked parameters the expansion was performed with', () => {
    const { plan, manifest } = conversion(`parameters:
  - name: deployEnv
    default: dev
${MINIMAL}`);
    const readme = generateReadme(manifest, plan);
    expect(readme).toContain('**Baked parameters**');
    expect(readme).toContain('| `deployEnv` | `dev` |');
  });
});

describe('generateReadme — env, tools and unsupported', () => {
  const withHooks = (yaml: string): SerializedManifest => {
    const { pipeline } = build(yaml);
    return serializeManifest(pipeline!, {
      expansion: serviceExpansion(yaml),
      env: [
        { name: 'SC_MY_SUB_CLIENT_SECRET', secret: true, origin: "service connection 'my-sub'" },
      ],
      tools: [{ cmd: 'dotnet', min: '8.0', neededBy: ['Build/BuildJob/010'] }],
      unsupported: ['trigger: (no local meaning)'],
      warnings: [
        {
          code: 'E05-UNKNOWN-TASK',
          message: 'no handler for Foo@1',
          location: { file: 'p.yml', line: 3 },
        },
      ],
    });
  };

  it('renders the env, tool and unsupported tables from manifest data', () => {
    const { plan } = conversion(MINIMAL);
    const readme = generateReadme(withHooks(MINIMAL), plan);
    expect(readme).toContain("| `SC_MY_SUB_CLIENT_SECRET` | yes | service connection 'my-sub' |");
    expect(readme).toContain('| `dotnet` | `8.0` | `Build/BuildJob/010` |');
    expect(readme).toContain('- trigger: (no local meaning)');
  });

  it('says so plainly when there is nothing to fill in or install', () => {
    const { plan, manifest } = conversion(MINIMAL);
    const readme = generateReadme(manifest, plan);
    expect(readme).toContain('This pipeline needs no `.env` entries');
    expect(readme).toContain('None recorded. Run `azdo-emu doctor`');
    expect(readme).toContain('Nothing in the original pipeline was dropped as unsupported.');
  });

  it('puts a conversion-level warning above every per-step entry', () => {
    const { plan } = conversion(MINIMAL);
    const entries = rankWarnings(withHooks(MINIMAL), plan);
    expect(entries[0]).toMatchObject({
      task: 'E05-UNKNOWN-TASK',
      where: 'p.yml:3',
      tier: undefined,
    });
  });
});

describe('rankWarnings', () => {
  const MIXED = `stages:
  - stage: Build
    jobs:
      - job: J
        steps:
          - task: CmdLine@2
            inputs:
              script: echo exact
          - task: PowerShell@2
            inputs:
              targetType: inline
              script: Write-Host degraded
          - task: DotNetCoreCLI@2
            inputs:
              command: build
`;

  it('ranks worst-first and leaves faithful steps out of the list', () => {
    const { plan, manifest } = conversion(MIXED);
    const entries = rankWarnings(manifest, plan);
    expect(entries.map((e) => e.tier)).toEqual(['stub', 'degraded']);
    expect(entries[0]!.task).toBe('DotNetCoreCLI@2');
    expect(entries[0]!.where).toMatch(/030-.*\.sh$/);
    expect(entries[0]!.remediation).toContain('azdo-emu doctor');
  });

  it('is deterministic: the same conversion yields the same ranking', () => {
    const a = conversion(MIXED);
    const b = conversion(MIXED);
    expect(rankWarnings(a.manifest, a.plan)).toEqual(rankWarnings(b.manifest, b.plan));
  });

  it('renders the ranked list numbered, with location, task, tier and remediation', () => {
    const { plan, manifest } = conversion(MIXED);
    const readme = generateReadme(manifest, plan);
    expect(readme).toContain('## Warnings');
    expect(readme).toMatch(/1\. \*\*stages\/.*030-.*\.sh\*\* — `DotNetCoreCLI@2` · `stub`/);
    expect(readme).toContain('   → Supply a handler for this task');
  });

  it('reports a clean conversion as such', () => {
    const { plan, manifest } = conversion(MINIMAL);
    expect(generateReadme(manifest, plan)).toContain(
      'No warnings: every step converted to a faithful local equivalent.',
    );
  });
});

describe('extractLinks', () => {
  it('collects relative targets and skips absolute URLs and in-page anchors', () => {
    const links = extractLinks('[a](run.sh) [b](https://example.com) [c](#fidelity) [d](x/y.sh)');
    expect(links).toEqual(['run.sh', 'x/y.sh']);
  });
});

describe('corpus', () => {
  const corpus = corpusFinalYamls();

  it('has corpus fixtures to read', () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  it.each(corpus)('README golden — $name', ({ finalYaml }) => {
    const { plan, manifest } = conversion(finalYaml);
    expect(generateReadme(manifest, plan)).toMatchSnapshot();
  });

  it.each(corpus)(
    'every generated link resolves to an emitted path — $name',
    ({ name, finalYaml }) => {
      const { pipeline, plan, manifest } = conversion(finalYaml);
      const emitted = emittedPaths(plan);

      // The planned entry-point paths are only trustworthy if the emitter writes exactly those keys.
      if (!ENTRYPOINTS_BLOCKED.has(name)) {
        const diagnostics: Diagnostic[] = [];
        const keys = [
          ...emitEntrypoints(pipeline, plan, 'pipeline.expanded.yml', diagnostics).keys(),
        ];
        expect(new Set(keys)).toEqual(plannedEntrypoints(plan));
      }

      const links = extractLinks(generateReadme(manifest, plan));
      expect(links.length).toBeGreaterThan(0);
      expect(links.filter((link) => !emitted.has(link))).toEqual([]);
    },
  );

  it('the blocked-entry-points list is exactly the entries that still throw', () => {
    for (const { name, finalYaml } of corpus) {
      const { pipeline, plan } = conversion(finalYaml);
      let threw = false;
      try {
        emitEntrypoints(pipeline, plan, 'pipeline.expanded.yml', []);
      } catch {
        threw = true;
      }
      expect(threw, `${name}: entry-point emission`).toBe(ENTRYPOINTS_BLOCKED.has(name));
    }
  });

  it.each(corpus)(
    'README fidelity labels match the emitted step headers — $name',
    ({ finalYaml }) => {
      const { plan, manifest } = conversion(finalYaml);
      const readme = generateReadme(manifest, plan);
      for (const stage of plan.stages)
        for (const job of stage.jobs)
          for (const entry of job.steps) {
            const label = stepFidelity(entry.step);
            expect(emitStepScript(entry.step, entry.number)).toContain(`# fidelity: ${label} —`);
            expect(readme).toContain(
              `| \`${label}\` | [\`${entry.path.split('/').pop()!}\`](${entry.path}) |`,
            );
          }
    },
  );
});
