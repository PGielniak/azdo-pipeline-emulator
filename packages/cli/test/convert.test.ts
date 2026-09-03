// E10-S02-T01 — `convert`: end-to-end per flag.
//
// The Done criteria are "e2e per flag on fixtures" and "`--json` output schema stable", and both
// are taken literally: every flag gets a case that observes something *different* about the
// generated project or the exit code, not merely that the flag parses.
//
// Two arms, both hermetic:
//
//   - **the service arm**, through the injected `fetchImpl` seam `ExpandCachedOptions` already
//     carries. A stub returns a committed corpus `final.yml`, so the test exercises the real cache,
//     lockfile and manifest path without a network call.
//   - **the offline arm**, `--offline-expand`, which runs the retained local engine for real.
//
// The strongest assertion in the file is not about a flag at all: the generated project is **run**,
// with bash, and its first step's log is read back. A conversion that writes plausible files but
// produces a project that cannot execute would pass every structural assertion and fail this one.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CONVERT_JSON_VERSION,
  SHELLCHECKRC,
  convert,
  type ConvertDeps,
} from '../src/convert/index.js';
import { EXIT } from '../src/exit.js';
import { run, summaryLine, type Io } from '../src/program.js';
import { validateExpandedPipeline } from '@azdo-emu/engine';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * A committed corpus pipeline and the expansion the service produced for it.
 *
 * `02` is chosen because it is multi-stage with a real `dependsOn` (so `--only-stage`'s
 * dependency pruning has something to prune) and its conditions compile: a stage condition reading
 * `dependencies.<stage>.result` is not yet supported by the shell backend (E02-S05-T05), which
 * would fail entry-point emission for reasons that have nothing to do with this wiring.
 */
const CORPUS = '02-artifact-handoff';
const authored = readFileSync(join(repoRoot, 'fixtures', 'corpus', CORPUS, 'pipeline.yml'), 'utf8');
const finalYaml = readFileSync(join(repoRoot, 'fixtures', 'oracle', `${CORPUS}.final.yml`), 'utf8');

const ORACLE = {
  orgUrl: 'https://dev.azure.com/example',
  project: 'Example',
  pipelineId: 1,
  pat: 'x'.repeat(52),
  apiVersion: '7.1',
};

/** The service, stubbed: one committed expansion, and a counter so `--frozen` can be observed. */
function stubService(): { deps: ConvertDeps; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ finalYaml }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as NonNullable<ConvertDeps['fetchImpl']>;
  return { deps: { fetchImpl, oracle: ORACLE }, calls: () => calls };
}

function workspace(pipeline = authored): { dir: string; file: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'azdo-convert-'));
  const file = join(dir, 'azure-pipelines.yml');
  writeFileSync(file, pipeline);
  return { dir, file, out: join(dir, 'out') };
}

const read = (out: string, relative: string): string => readFileSync(join(out, relative), 'utf8');

describe('the service arm', () => {
  it('writes a complete project and reports what it did', async () => {
    const { file, out } = workspace();
    const { deps } = stubService();
    const result = await convert(file, { out }, deps);

    expect(result.summary.expansion).toEqual({ mode: 'service', degraded: false });
    expect(result.summary.stages).toBeGreaterThan(0);
    expect(result.summary.steps).toBeGreaterThan(0);

    // Every file the generated project needs to be a project.
    for (const relative of [
      'README.md',
      'manifest.json',
      '.env.example',
      '.gitignore',
      '.shellcheckrc',
      'run.sh',
      'pipeline.expanded.yml',
      'pipeline.bundled.yml',
      'lib/runtime.sh',
      'lib/expr.sh',
    ])
      expect(existsSync(join(out, relative)), relative).toBe(true);

    // The expansion written out is the service's own bytes.
    expect(read(out, 'pipeline.expanded.yml')).toBe(finalYaml);
  });

  it('fills the manifest fields decision 64 deferred to this wiring', async () => {
    const { file, out } = workspace();
    const { deps } = stubService();
    await convert(file, { out, targetOs: 'windows' }, deps);
    const manifest = JSON.parse(read(out, 'manifest.json')) as {
      stages: { jobs: { targetOs?: string; steps: { file?: string }[] }[] }[];
    };
    const job = manifest.stages[0]!.jobs[0]!;
    expect(job.targetOs).toBe('windows');
    // Every step names the script that was actually emitted for it.
    for (const step of job.steps) {
      expect(step.file).toBeDefined();
      expect(existsSync(join(out, step.file!)), step.file).toBe(true);
    }
  });

  it('ships a `.shellcheckrc` carrying all four by-construction disables', () => {
    for (const code of ['SC2005', 'SC2046', 'SC2016', 'SC2071'])
      expect(SHELLCHECKRC).toContain(code);
  });
});

describe('the offline arm (`--offline-expand`)', () => {
  it('runs the retained local engine, labels the result degraded, and warns', async () => {
    const { file, out } = workspace();
    const result = await convert(file, { out, offlineExpand: true });
    expect(result.summary.expansion).toEqual({ mode: 'offline', degraded: true });
    expect(result.warnings.some((w) => w.code === 'E12-OFFLINE-EXPANSION')).toBe(true);
    expect(read(out, 'README.md')).toContain('**offline**');
  });

  it('needs no organization context, where the service arm does', async () => {
    const { file, out } = workspace();
    await expect(convert(file, { out })).rejects.toThrow(/organization/i);
  });
});

describe('flags', () => {
  it('`-o` decides where the project lands', async () => {
    const { file, dir } = workspace();
    const out = join(dir, 'elsewhere', 'nested');
    await convert(file, { out, offlineExpand: true });
    expect(existsSync(join(out, 'run.sh'))).toBe(true);
  });

  it('`--only-stage` keeps just the named stages, and rejects a name that is not there', async () => {
    const { file, out } = workspace();
    const all = await convert(file, { out, offlineExpand: true });
    expect(all.summary.stages).toBeGreaterThan(1);

    const one = await convert(file, { out, offlineExpand: true, onlyStage: ['build'] });
    expect(one.summary.stages).toBe(1);

    await expect(
      convert(file, { out, offlineExpand: true, onlyStage: ['nosuch'] }),
    ).rejects.toThrow(/no such stage: nosuch/);
  });

  it('`--only-stage` drops a dependency on a stage it left out, and says so (decision 67)', async () => {
    const { file, out } = workspace();
    const result = await convert(file, { out, offlineExpand: true, onlyStage: ['deploy'] });
    const dropped = result.warnings.filter((w) => w.code === 'E10-ONLY-STAGE-DEPENDENCY');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.message).toContain("depends on 'build'");
    // The emitted runner cannot name a stage that is not in the project.
    expect(read(out, 'run.sh')).not.toContain('build/run-stage.sh');
  });

  it('`--strict` turns warnings into exit 2, after writing the project', async () => {
    const { file, out } = workspace();
    const loose = await convert(file, { out, offlineExpand: true });
    expect(loose.summary.warnings).toBeGreaterThan(0);

    await expect(convert(file, { out, offlineExpand: true, strict: true })).rejects.toMatchObject({
      exitCode: EXIT.strict,
    });
    // "after writing" matters: a strict failure is a verdict on a conversion that happened.
    expect(existsSync(join(out, 'README.md'))).toBe(true);
  });

  it('`--target-os` and `--checkout-mode` reach the resolved settings', async () => {
    const { file, out } = workspace();
    await convert(file, { out, offlineExpand: true, targetOs: 'macos', checkoutMode: 'copy' }, {});
    const manifest = JSON.parse(read(out, 'manifest.json')) as {
      stages: { jobs: { targetOs?: string }[] }[];
    };
    expect(manifest.stages[0]!.jobs[0]!.targetOs).toBe('macos');
  });

  it('`--exec-env sandbox` and `--sandbox-image` are refused, not silently ignored', async () => {
    const { file, out } = workspace();
    await expect(convert(file, { out, execEnv: 'sandbox' })).rejects.toThrow(/not implemented/);
    await expect(convert(file, { out, sandboxImage: 'alpine' })).rejects.toThrow(/no effect/);
  });

  it('`--offline` alone is a usage error; with `--offline-expand` it is fine', async () => {
    const { file, out } = workspace();
    await expect(convert(file, { out, offline: true })).rejects.toThrow(/no network call/);
    await expect(convert(file, { out, offline: true, offlineExpand: true })).resolves.toBeDefined();
  });

  it('`--frozen` resolves from the cache instead of fetching again', async () => {
    const { file, out, dir } = workspace();
    const cacheDir = join(dir, 'cache');
    const service = stubService();
    const deps = { ...service.deps, cacheDir };

    await convert(file, { out }, deps);
    expect(service.calls()).toBe(1);

    await convert(file, { out, frozen: true }, deps);
    expect(service.calls()).toBe(1); // no second fetch
  });

  it('`--no-bundle` sends the pipeline as authored', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-convert-'));
    mkdirSync(join(dir, 'templates'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'steps.yml'), 'steps:\n- script: echo from-template\n');
    const file = join(dir, 'azure-pipelines.yml');
    writeFileSync(file, 'steps:\n- template: /templates/steps.yml\n');
    const out = join(dir, 'out');

    // What the flag controls is the *override that gets sent*, so both halves go through the
    // service stub and the assertion is on `pipeline.bundled.yml`. Running the un-inlined document
    // through the offline arm instead would fail for a different reason — the retained engine is
    // single-document and never follows a `template:` reference (E03-S04-T02).
    const { deps } = stubService();
    await convert(file, { out }, deps);
    expect(read(out, 'pipeline.bundled.yml')).toContain('echo from-template');
    expect(read(out, 'pipeline.bundled.yml')).not.toContain('template: /templates/steps.yml');

    const raw = join(dir, 'raw');
    await convert(file, { out: raw, bundle: false }, deps);
    expect(read(raw, 'pipeline.bundled.yml')).toContain('template: /templates/steps.yml');
  });

  it('`--parameter` reaches the expansion as a queue-time value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-convert-'));
    const file = join(dir, 'azure-pipelines.yml');
    writeFileSync(
      file,
      'parameters:\n- name: env\n  default: dev\nsteps:\n- script: echo ${{ parameters.env }}\n',
    );
    const out = join(dir, 'out');
    await convert(file, { out, offlineExpand: true, parameter: { env: 'prod' } });
    expect(read(out, 'pipeline.expanded.yml')).toContain('echo prod');
  });

  it('a missing pipeline file fails with the path, not a stack', async () => {
    const { dir } = workspace();
    await expect(convert(join(dir, 'nope.yml'), { out: join(dir, 'out') })).rejects.toThrow(
      /cannot read pipeline file/,
    );
  });
});

describe('the `--json` summary', () => {
  it('is versioned and shape-stable', async () => {
    const { file, out } = workspace();
    const result = await convert(file, { out, offlineExpand: true });
    expect(result.summary.version).toBe(CONVERT_JSON_VERSION);
    expect(Object.keys(result.summary).sort()).toEqual([
      'errors',
      'expansion',
      'files',
      'jobs',
      'out',
      'stages',
      'steps',
      'version',
      'warnings',
    ]);
    expect(Object.keys(result.summary.expansion).sort()).toEqual(['degraded', 'mode']);
    // `out` is a temp path, so the snapshot covers everything else.
    expect({ ...result.summary, out: '<tmp>' }).toMatchSnapshot();
  });
});

describe('the generated project actually runs', () => {
  it('run.sh executes and the first step logs through the copied runtime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-convert-run-'));
    const file = join(dir, 'azure-pipelines.yml');
    writeFileSync(file, 'steps:\n- script: echo hello-from-convert\n');
    const out = join(dir, 'out');
    await convert(file, { out, offlineExpand: true });

    writeFileSync(join(out, '.env'), '');
    const stdout = execFileSync('bash', ['run.sh'], { cwd: out, encoding: 'utf8' });
    expect(stdout).toContain('Result: Succeeded');
    const log = readFileSync(join(out, '.work/run-1/logs/010-default/010-job/010.log'), 'utf8');
    expect(log).toContain('hello-from-convert');
  }, 120_000);
});

// ── through the CLI ───────────────────────────────────────────────────────────────────────────

/** The command line, in-process: `run` writes through the injected Io and returns an exit code. */
async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => (out += text),
    err: (text) => (err += text),
    helpWidth: 80,
    colors: false,
  };
  return { code: await run(argv, io), out, err };
}

describe('through the command line', () => {
  it('converts and prints the one-line summary docs/06 §1 asks for', async () => {
    const { file, out } = workspace();
    const { code, out: stdout, err } = await cli('convert', file, '-o', out, '--offline-expand');
    expect(err).toBe('');
    expect(code).toBe(EXIT.ok);
    expect(stdout).toMatch(/^Converted \d+ stage\(s\), \d+ job\(s\), \d+ step\(s\) into /);
    expect(stdout).toContain('expanded by offline (degraded)');
    expect(stdout).toContain('see README.md');
  });

  it('`--json` prints the summary instead, and it parses', async () => {
    const { file, out } = workspace();
    const { code, out: stdout } = await cli(
      '--json',
      'convert',
      file,
      '-o',
      out,
      '--offline-expand',
    );
    expect(code).toBe(EXIT.ok);
    const summary = JSON.parse(stdout) as { version: number; expansion: { mode: string } };
    expect(summary.version).toBe(CONVERT_JSON_VERSION);
    expect(summary.expansion.mode).toBe('offline');
  });

  it('says `no warnings` when there are none, and drops the degraded marker', () => {
    // A clean service conversion. It cannot be reached through `cli()` — the service arm needs
    // organization context this harness deliberately does not inject — so the formatter is
    // exercised directly; the branch it selects is the whole behaviour.
    const line = summaryLine({
      summary: {
        version: CONVERT_JSON_VERSION,
        out: '/tmp/out',
        expansion: { mode: 'service', degraded: false },
        stages: 1,
        jobs: 1,
        steps: 1,
        warnings: 0,
        errors: 0,
        files: 9,
      },
      warnings: [],
      diagnostics: [],
    });
    expect(line).toContain('no warnings');
    expect(line).not.toContain('degraded');
    expect(line).toContain('expanded by service');
  });

  it('pluralizes a single warning', () => {
    const line = summaryLine({
      summary: {
        version: CONVERT_JSON_VERSION,
        out: '/tmp/out',
        expansion: { mode: 'offline', degraded: true },
        stages: 1,
        jobs: 1,
        steps: 1,
        warnings: 1,
        errors: 0,
        files: 9,
      },
      warnings: [],
      diagnostics: [],
    });
    expect(line).toContain('1 warning —');
  });

  it('maps a strict failure onto exit 2, with the hint', async () => {
    const { file, out } = workspace();
    const { code, err } = await cli('convert', file, '-o', out, '--offline-expand', '--strict');
    expect(code).toBe(EXIT.strict);
    expect(err).toContain('--strict');
    expect(err).toContain('see its README');
  });

  it('maps a refused flag onto exit 1, with the hint', async () => {
    const { file, out } = workspace();
    const { code, err } = await cli('convert', file, '-o', out, '--exec-env', 'sandbox');
    expect(code).toBe(EXIT.error);
    expect(err).toContain('sandbox execution is not implemented');
    expect(err).toContain('PLAN D9');
  });

  it('accumulates a repeated `--only-stage`', async () => {
    const { file, out } = workspace();
    const { code, out: stdout } = await cli(
      '--json',
      'convert',
      file,
      '-o',
      out,
      '--offline-expand',
      '--only-stage',
      'build',
      '--only-stage',
      'deploy',
    );
    expect(code).toBe(EXIT.ok);
    expect((JSON.parse(stdout) as { stages: number }).stages).toBe(2);
  });
});

describe('failure paths', () => {
  it('refuses an expansion that does not validate, naming the offending lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-convert-'));
    const file = join(dir, 'azure-pipelines.yml');
    writeFileSync(file, 'stages:\n- stage: a\n  notAStageKey: x\n  jobs: []\n');
    await expect(convert(file, { out: join(dir, 'out'), offlineExpand: true })).rejects.toThrow(
      /the expanded pipeline is invalid/,
    );
  });

  it('refuses an expansion it cannot model', async () => {
    // A `template:` reference the offline arm cannot follow survives into the expansion, and the
    // model has no step to build from it.
    const dir = mkdtempSync(join(tmpdir(), 'azdo-convert-'));
    const file = join(dir, 'azure-pipelines.yml');
    writeFileSync(file, 'steps:\n- template: /templates/missing.yml\n');
    await expect(
      convert(file, { out: join(dir, 'out'), offlineExpand: true, bundle: false }),
    ).rejects.toThrow(/could not be modelled|is invalid/);
  });
});

// ── the two tasks this wiring unblocked ───────────────────────────────────────────────────────
//
// E01-S02-T02 and E12-S01-T01 were both `[!]` waiting on `convert`'s body. Their Done criteria are
// asserted here, by name, rather than assumed to follow from the wiring existing.

describe('E12-S01-T01 — the expansion gate', () => {
  it('the default path never invokes the local engine', async () => {
    // The stub answers with a *different* pipeline than the one submitted. If the local engine had
    // produced this expansion it would describe the input; that it describes the corpus fixture is
    // proof the bytes came off the wire (PLAN D3).
    const dir = mkdtempSync(join(tmpdir(), 'azdo-gate-'));
    const file = join(dir, 'azure-pipelines.yml');
    writeFileSync(file, 'steps:\n- script: echo not-what-the-stub-returns\n');
    const out = join(dir, 'out');
    const service = stubService();

    const result = await convert(file, { out }, service.deps);
    expect(service.calls()).toBe(1);
    expect(read(out, 'pipeline.expanded.yml')).toBe(finalYaml);
    expect(read(out, 'pipeline.expanded.yml')).not.toContain('not-what-the-stub-returns');
    expect(result.summary.expansion).toEqual({ mode: 'service', degraded: false });
    // And no fallback warning, because no fallback happened.
    expect(result.warnings.some((w) => w.code === 'E12-OFFLINE-EXPANSION')).toBe(false);
  });

  it('records the choice in the manifest, on both arms', async () => {
    const { file, out } = workspace();
    const { deps } = stubService();
    await convert(file, { out }, deps);
    const online = JSON.parse(read(out, 'manifest.json')) as {
      expansion: { mode: string; degraded: boolean };
    };
    expect(online.expansion).toMatchObject({ mode: 'service', degraded: false });

    const offlineOut = join(out, '..', 'offline');
    await convert(file, { out: offlineOut, offlineExpand: true });
    const offline = JSON.parse(read(offlineOut, 'manifest.json')) as {
      expansion: { mode: string; degraded: boolean };
    };
    expect(offline.expansion).toMatchObject({ mode: 'offline', degraded: true });
  });

  it('emits a warning on the fallback path, and it reaches the README', async () => {
    const { file, out } = workspace();
    const result = await convert(file, { out, offlineExpand: true });
    const warning = result.warnings.find((w) => w.code === 'E12-OFFLINE-EXPANSION')!;
    expect(warning.message).toContain('--offline-expand');
    expect(warning.message).toContain('degraded');
    expect(read(out, 'README.md')).toContain('E12-OFFLINE-EXPANSION');
  });
});

describe('E01-S02-T02 — strict validation of the expanded pipeline', () => {
  it('a deliberately broken expansion fails with pointers into pipeline.expanded.yml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-strict-'));
    const file = join(dir, 'azure-pipelines.yml');
    // The service stub answers with a *mutated* corpus expansion — a broken expansion is the case
    // this criterion is about, and only the expansion side can produce one.
    writeFileSync(file, 'steps:\n- script: echo x\n');
    const broken = finalYaml.replace(/^(- stage: .*)$/m, '$1\n  notAStageKey: whatever');
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ finalYaml: broken }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as NonNullable<ConvertDeps['fetchImpl']>;

    await expect(
      convert(file, { out: join(dir, 'out') }, { fetchImpl, oracle: ORACLE }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('the expanded pipeline is invalid'),
      // `file:line:col`, against the expanded document by name.
      hint: expect.stringMatching(/pipeline\.expanded\.yml:\d+:\d+: /),
    });
  });

  it('every known-good corpus expansion passes', async () => {
    // The whole committed corpus, straight through the validator the wiring calls.
    const dir = join(repoRoot, 'fixtures', 'oracle');
    const finals = readdirSync(dir).filter((name) => name.endsWith('.final.yml'));
    expect(finals.length).toBeGreaterThan(0);
    for (const name of finals)
      expect(validateExpandedPipeline(readFileSync(join(dir, name), 'utf8')), name).toEqual([]);
  });
});

describe('E08-S02-T01 — service connections reach the generated project', () => {
  /** An expansion naming a connection under its alias, which is what real pipelines write. */
  const AZURE_FINAL = `stages:
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
`;

  const stubWith = (yaml: string): ConvertDeps => ({
    fetchImpl: (async () =>
      new Response(JSON.stringify({ finalYaml: yaml }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as NonNullable<ConvertDeps['fetchImpl']>,
    oracle: ORACLE,
  });

  it('writes the connection block, the manifest env keys, and the hazard warning', async () => {
    const { file, out } = workspace(AZURE_FINAL);
    const result = await convert(file, { out, bundle: false }, stubWith(AZURE_FINAL));

    // The `.env.example` asks for the connection under the names the real task reads (C-E08-001),
    // in `sp` mode — because ambient cannot serve a task run in real-task mode (C-E08-036).
    const env = read(out, '.env.example');
    expect(env).toContain("# ── Service connection 'my-prod-sub' · mode: sp");
    expect(env).toContain('ENDPOINT_AUTH_PARAMETER_my-prod-sub_SERVICEPRINCIPALID=');
    expect(env).toContain('used by: Deploy/deploy/step 1');

    const manifest = JSON.parse(read(out, 'manifest.json')) as {
      env: { name: string; secret: boolean; origin?: string }[];
      warnings: { code: string; message: string }[];
    };
    expect(manifest.env.map((e) => e.name)).toContain('ENDPOINT_AUTH_SCHEME_my-prod-sub');
    expect(
      manifest.env.find((e) => e.name === 'ENDPOINT_DATA_my-prod-sub_SUBSCRIPTIONID')?.secret,
    ).toBe(false);

    // The hazard is a convert-time warning, so it is in the README's warnings list before the
    // first run rather than discovered by losing an `az` session (C-E08-038).
    const clobber = manifest.warnings.find((w) => w.code === 'local-session-clobber');
    expect(clobber?.message).toContain('az account clear');
    expect(result.summary.warnings).toBeGreaterThan(0);
    expect(read(out, 'README.md')).toContain('az account clear');
  });

  it('warns instead of inventing a block when the connection is a macro', async () => {
    const macroFinal = AZURE_FINAL.replace('my-prod-sub', '$(azureSub)');
    const { file, out } = workspace(macroFinal);
    await convert(file, { out, bundle: false }, stubWith(macroFinal));

    const manifest = JSON.parse(read(out, 'manifest.json')) as {
      warnings: { code: string }[];
    };
    expect(manifest.warnings.map((w) => w.code)).toContain('connection-macro-name');
    expect(read(out, '.env.example')).toContain('# (this pipeline references none)');
  });
});
