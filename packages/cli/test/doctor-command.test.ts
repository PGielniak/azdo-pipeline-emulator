// E10-S04-T01 — the `doctor` command wiring.
//
// The engine (probe table, version comparison, remediation, report) was built and tested on
// 2026-09-02. What this file covers is the half that was missing: reading `manifest.json`'s
// `tools[]`, `--json`, the exit code, and the input that made the whole thing vacuous — `tools[]`
// was always empty, because `aggregateTools` had no caller (C-E10-035).
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { convert } from '../src/convert/index.js';
import { doctor, readManifestTools } from '../src/doctor/command.js';
import type { Runner } from '../src/doctor/probe.js';

/** A project directory holding just the manifest, which is all `doctor` reads. */
function project(manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'azdo-doctor-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, undefined, 2));
  return dir;
}

/**
 * A runner that answers for the tools a test cares about and reports the rest as absent.
 *
 * `undefined` is the engine's "not on PATH" — the spawn failed — which is distinct from a tool that
 * ran and returned nothing (C-E10-004).
 */
const runner =
  (versions: Readonly<Record<string, string>>): Runner =>
  (cmd) => {
    const found = versions[cmd];
    return found === undefined ? undefined : { code: 0, stdout: found };
  };

describe('reading tools[] out of a generated manifest', () => {
  it('reports every tool the manifest declares, with who needs it', () => {
    const dir = project({
      schemaVersion: 1,
      tools: [{ cmd: 'docker', min: '20.10', neededBy: ['Build/Job/step 2'] }],
    });
    const result = doctor(dir, {
      run: runner({ docker: '24.0.7' }),
    });
    expect(result.text).toContain('docker');
    expect(result.text).toContain('needed by: Build/Job/step 2');
    expect(result.ok).toBe(true);
  });

  it('an empty tools[] is a real answer, and a *missing* one is not (C-E10-036)', () => {
    // Empty means the pipeline uses no task that shells out — common and true. Absent means the
    // manifest predates the contract, and answering "nothing needed" for it would be exactly the
    // confidently-wrong report this task exists to remove.
    expect(doctor(project({ schemaVersion: 1, tools: [] })).text).toContain(
      'needs no external tools',
    );
    expect(() => doctor(project({ schemaVersion: 1 }))).toThrow('predates the doctor contract');
  });

  it('names the directory when there is no manifest there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-doctor-'));
    expect(() => doctor(dir)).toThrow(`no manifest.json in ${dir}`);
  });

  it('refuses malformed input rather than probing nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-doctor-'));
    writeFileSync(join(dir, 'manifest.json'), '{not json');
    expect(() => doctor(dir)).toThrow('not valid JSON');

    const bad = project({ schemaVersion: 1, tools: 'docker' });
    expect(() => doctor(bad)).toThrow('malformed tools[]');
  });

  it('exposes the reader on its own, so other commands can consume the contract', () => {
    const dir = project({ schemaVersion: 1, tools: [{ cmd: 'helm', neededBy: [] }] });
    expect(readManifestTools(dir)).toEqual([{ cmd: 'helm', neededBy: [] }]);
  });
});

describe('the verdict', () => {
  const dir = (): string =>
    project({
      schemaVersion: 1,
      tools: [
        { cmd: 'docker', min: '20.10', neededBy: ['Build/Job/step 1'] },
        { cmd: 'kubectl', neededBy: ['Deploy/Job/step 1'] },
      ],
    });

  it('is not ok when a tool is missing', () => {
    const result = doctor(dir(), { run: runner({ docker: '24.0.7' }) });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('Some tools need attention.');
  });

  it('is not ok when a tool is present but below its floor', () => {
    const result = doctor(dir(), {
      // The shapes the *grounded* probes actually produce: `docker version --format
      // '{{.Client.Version}}'` prints a bare version (C-E10-002) and `kubectl version --client -o
      // json` prints a document (C-E10-003). Feeding prose here would test a parser nobody ships.
      run: runner({
        docker: '19.03.5',
        kubectl: JSON.stringify({ clientVersion: { gitVersion: 'v1.31.0' } }),
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('needs ≥ 20.10');
  });

  it('--json carries the verdict, so a CI step never scrapes the table', () => {
    const result = doctor(dir(), { json: true, run: runner({}) });
    const parsed = JSON.parse(result.text) as {
      version: number;
      ok: boolean;
      results: { cmd: string; status: string }[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.ok).toBe(false);
    // Worst first, so the thing to fix is the thing you read.
    expect(parsed.results[0]?.status).toBe('missing');
  });

  it('refuses --sandbox rather than silently checking the host (PLAN D9, decision 69)', () => {
    // Accepting it would report on an execution environment the project does not have.
    expect(() => doctor(dir(), { sandbox: true })).toThrow('container sandbox is deferred');
  });
});

describe('the input that made the whole command vacuous (C-E10-035)', () => {
  // `aggregateTools` shipped with E10-S04-T02's contract and had **no caller**, so every generated
  // `manifest.json` carried `tools: []` and `doctor` would have answered "this pipeline needs no
  // external tools" for a project full of `az` and `kubectl` steps. This is the end-to-end proof
  // that a real conversion now fills it: no stub of the emitter, no hand-written manifest.
  const PIPELINE = `
stages:
  - stage: Deploy
    jobs:
      - job: Apply
        steps:
          - task: AzureCLI@2
            inputs:
              azureSubscription: prod
              scriptType: bash
              scriptLocation: inlineScript
              inlineScript: az account show
          - task: Kubernetes@1
            inputs:
              connectionType: None
              command: apply
`;

  it('a converted project declares the tools its steps need, and doctor reads them back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-doctor-e2e-'));
    const file = join(dir, 'azure-pipelines.yml');
    writeFileSync(file, PIPELINE);
    const out = join(dir, 'out');
    // The offline arm, so the test needs no organization and no service.
    await convert(file, { out, offlineExpand: true });

    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as {
      tools: { cmd: string; neededBy: string[] }[];
    };
    const commands = manifest.tools.map((tool) => tool.cmd).sort();
    expect(commands).toContain('az');
    expect(commands).toContain('kubectl');
    // `neededBy` is the step path the generated project uses, so a user can find the step.
    const az = manifest.tools.find((tool) => tool.cmd === 'az');
    expect(az?.neededBy[0]).toMatch(/^Deploy\/Apply\/step /);

    // And the command reads that file, on a machine that never ran convert.
    const report = doctor(out, {
      run: runner({ az: JSON.stringify({ 'azure-cli': '2.89.1' }) }),
    });
    expect(report.text).toContain('az 2.89.1');
    expect(report.text).toContain('kubectl');
    expect(report.ok).toBe(false); // kubectl was not answered for
  });

  it('the doctor report for that project is stable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-doctor-snap-'));
    const file = join(dir, 'azure-pipelines.yml');
    writeFileSync(file, PIPELINE);
    const out = join(dir, 'out');
    await convert(file, { out, offlineExpand: true });
    // "fixture manifest → doctor snapshot", with every probe answered so the snapshot pins the
    // *format* rather than this machine's toolset.
    expect(
      doctor(out, {
        run: runner({
          az: JSON.stringify({ 'azure-cli': '2.89.1' }),
          kubectl: JSON.stringify({ clientVersion: { gitVersion: 'v1.31.0' } }),
        }),
        platform: 'linux',
      }).text,
    ).toMatchSnapshot();
  });
});

describe('the wired command, through run()', async () => {
  const { run } = await import('../src/index.js');
  const cli = async (argv: string[]): Promise<{ code: number; out: string; err: string }> => {
    let out = '';
    let err = '';
    const code = await run(argv, {
      out: (t) => (out += t),
      err: (t) => (err += t),
      helpWidth: 80,
      colors: false,
    });
    return { code, out, err };
  };

  it('exits non-zero when a known tool cannot satisfy its floor, so CI can gate on it', async () => {
    // The report is on stdout either way; only the verdict travels the error path. The floor is
    // unreachable on purpose, so the verdict is the same whether docker is installed on the runner
    // (`outdated`) or not (`missing`) — both are failures, and neither depends on the host.
    const dir = project({
      schemaVersion: 1,
      tools: [{ cmd: 'docker', min: '9999.0', neededBy: ['Build/Job/step 1'] }],
    });
    const result = await cli(['doctor', dir]);
    expect(result.out).toContain('docker');
    expect(result.code).toBe(1);
    expect(result.err).toContain('missing or outdated');
  });

  it('a tool with no probe entry does not fail the run — it is reported, not judged', async () => {
    // "Claiming a tool is fine because we do not know how to ask it" is the answer a doctor must
    // never give; claiming it is *broken* for the same reason is just as wrong. `unprobed` says
    // so and leaves the verdict alone.
    const dir = project({
      schemaVersion: 1,
      tools: [{ cmd: 'definitely-not-a-real-tool', neededBy: ['Build/Job/step 1'] }],
    });
    const result = await cli(['doctor', dir]);
    expect(result.out).toContain('definitely-not-a-real-tool');
    expect(result.code).toBe(0);
  });

  it('exits 0 and says so when a pipeline needs no external tools', async () => {
    const result = await cli(['doctor', project({ schemaVersion: 1, tools: [] })]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('needs no external tools');
  });

  it('points at the directory when it is not a generated project', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'azdo-doctor-empty-'));
    const result = await cli(['doctor', empty]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('no manifest.json in');
  });

  it('--json is the global flag, and reaches this command', async () => {
    const result = await cli(['--json', 'doctor', project({ schemaVersion: 1, tools: [] })]);
    expect(JSON.parse(result.out)).toMatchObject({ version: 1, ok: true, results: [] });
  });
});
