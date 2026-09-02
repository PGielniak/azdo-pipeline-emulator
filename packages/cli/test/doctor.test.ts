import { describe, expect, it } from 'vitest';
import {
  PROBES,
  compareVersions,
  formatDoctor,
  probeTool,
  remediationFor,
  runDoctor,
  type Runner,
  type ToolRequirement,
} from '../src/doctor/probe.js';

/** A runner backed by canned stdout, keyed by command. */
const canned =
  (outputs: Readonly<Record<string, string | number>>): Runner =>
  (cmd) => {
    const value = outputs[cmd];
    if (value === undefined) return undefined; // not on PATH
    if (typeof value === 'number') return { code: value, stdout: '' };
    return { code: 0, stdout: value };
  };

const need = (cmd: string, min?: string): ToolRequirement => ({
  cmd,
  neededBy: ['build/compile/030'],
  ...(min === undefined ? {} : { min }),
});

/** The exact bytes the live tools printed on 2026-09-02 (C-E10-001/002). */
const LIVE_AZ = '{\n  "azure-cli": "2.89.1",\n  "azure-cli-core": "2.89.1",\n  "extensions": {}\n}';
const LIVE_DOCKER = '29.7.2\n';

describe('the probe table is the documented command, not a guess (C-E10-001..005)', () => {
  it('asks az for JSON, never `az --version`', () => {
    // `az --version` prints prose plus an "N update(s) available" banner, which is on most
    // machines — parsing it would break there and report a present tool as missing.
    expect(PROBES.az?.args).toEqual(['version']);
    expect(probeTool(need('az'), { run: canned({ az: LIVE_AZ }) })).toMatchObject({
      status: 'ok',
      found: '2.89.1',
    });
  });

  it('reads docker’s CLIENT version, so a stopped daemon is not "missing" (C-E10-002)', () => {
    expect(PROBES.docker?.args).toEqual(['version', '--format', '{{.Client.Version}}']);
    expect(probeTool(need('docker'), { run: canned({ docker: LIVE_DOCKER }) })).toMatchObject({
      status: 'ok',
      found: '29.7.2',
    });
  });

  it('passes --client to kubectl so the probe never contacts a cluster (C-E10-003)', () => {
    // Without --client, kubectl reaches for the API server and a doctor run would hang or fail on
    // an unreachable cluster rather than on a missing binary.
    expect(PROBES.kubectl?.args).toContain('--client');
    const stdout = JSON.stringify({ clientVersion: { gitVersion: 'v1.31.2' } });
    expect(probeTool(need('kubectl'), { run: canned({ kubectl: stdout }) })).toMatchObject({
      status: 'ok',
      found: 'v1.31.2',
    });
  });

  it('reads helm and pwsh from their documented forms (C-E10-004/005)', () => {
    expect(probeTool(need('helm'), { run: canned({ helm: 'v3.14.0\n' }) })).toMatchObject({
      found: 'v3.14.0',
    });
    expect(probeTool(need('pwsh'), { run: canned({ pwsh: 'PowerShell 7.4.1\n' }) })).toMatchObject({
      found: '7.4.1',
    });
  });
});

describe('compareVersions is numeric, not lexical', () => {
  it('knows 2.10.0 is newer than 2.9.0', () => {
    // A string compare says the opposite, and would report a perfectly current tool as outdated.
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareVersions('2.9.0', '2.10.0')).toBe(-1);
    expect(compareVersions('2.9.0', '2.9.0')).toBe(0);
  });

  it('tolerates a leading v and a build or prerelease suffix', () => {
    expect(compareVersions('v3.14.0+gabc123', '3.14.0')).toBe(0);
    expect(compareVersions('7.4.1-preview', '7.4.0')).toBe(1);
  });

  it('treats a missing component as zero', () => {
    expect(compareVersions('2.9', '2.9.0')).toBe(0);
    expect(compareVersions('3', '2.9.9')).toBe(1);
  });
});

describe('probeTool statuses', () => {
  it('reports a tool that is not on PATH as missing, with an install hint', () => {
    const result = probeTool(need('helm', '3.0.0'), { run: canned({}), platform: 'linux' });
    expect(result.status).toBe('missing');
    expect(result.remediation).toContain('helm.sh');
    expect(result.neededBy).toEqual(['build/compile/030']);
  });

  it('reports a non-zero exit as missing too', () => {
    // A binary that exists but cannot run is, for the user, the same problem.
    expect(probeTool(need('az'), { run: canned({ az: 127 }) }).status).toBe('missing');
  });

  it('reports a version below the minimum as outdated, showing both numbers', () => {
    const result = probeTool(need('az', '2.90.0'), { run: canned({ az: LIVE_AZ }) });
    expect(result).toMatchObject({ status: 'outdated', found: '2.89.1', min: '2.90.0' });
  });

  it('accepts a version equal to the minimum', () => {
    expect(probeTool(need('az', '2.89.1'), { run: canned({ az: LIVE_AZ }) }).status).toBe('ok');
  });

  it('says the version is unknown rather than failing when output cannot be parsed', () => {
    // The tool ran, so it is present — this is a check we skipped, not a failure.
    const result = probeTool(need('az', '2.0.0'), { run: canned({ az: 'not json' }) });
    expect(result.status).toBe('unknown-version');
    expect(result.remediation).toContain('version check azdo-emu skipped');
  });

  it('never claims an unknown tool is fine', () => {
    // Assuming a tool is present because we do not know how to ask it is the one answer a doctor
    // must never give.
    const result = probeTool(need('terraform'), { run: canned({}) });
    expect(result.status).toBe('unprobed');
    expect(result.remediation).toContain('no version probe');
  });
});

describe('remediationFor', () => {
  it('is per-OS, falling back to linux for an unknown platform', () => {
    expect(remediationFor('az', 'darwin')).toBe('brew install azure-cli');
    expect(remediationFor('az', 'win32')).toContain('winget');
    expect(remediationFor('az', 'sunos')).toBe(remediationFor('az', 'linux'));
  });

  it('still says something useful for a tool it has no hint for', () => {
    expect(remediationFor('terraform', 'linux')).toContain('on your PATH');
  });
});

describe('runDoctor', () => {
  const tools = [need('az', '2.90.0'), need('docker'), need('helm', '3.0.0'), need('terraform')];

  it('ranks worst-first, so the thing to fix is the thing you read', () => {
    const report = runDoctor(tools, {
      run: canned({ az: LIVE_AZ, docker: LIVE_DOCKER }),
      platform: 'linux',
    });
    expect(report.results.map((result) => `${result.status}:${result.cmd}`)).toEqual([
      'missing:helm',
      'outdated:az',
      'unprobed:terraform',
      'ok:docker',
    ]);
  });

  it('fails only on missing or outdated — a skipped check is not a failure', () => {
    expect(runDoctor(tools, { run: canned({ az: LIVE_AZ, docker: LIVE_DOCKER }) }).ok).toBe(false);
    expect(
      runDoctor([need('terraform'), need('az', '2.0.0')], {
        run: canned({ az: 'not json' }),
      }).ok,
    ).toBe(true);
  });

  it('reports a pipeline that needs nothing as needing nothing', () => {
    const report = runDoctor([], {});
    expect(report).toEqual({ results: [], ok: true });
    expect(formatDoctor(report)).toBe('This pipeline needs no external tools.\n');
  });
});

describe('the default runner (real processes)', () => {
  it('spawns the real command when no runner is injected', () => {
    // The canned-output tests would still pass if the probe *commands* were wrong; this is the one
    // that would not. `docker` is present in this environment and in CI.
    const result = probeTool(need('docker'), {});
    expect(['ok', 'missing']).toContain(result.status);
    if (result.status === 'ok') {
      expect(result.found).toMatch(/^\d+\./);
    }
  });

  it('reports a binary that does not exist as missing rather than throwing', () => {
    // A missing binary surfaces as spawn ENOENT, not as a non-zero status.
    const result = probeTool(
      { cmd: 'azdo-emu-no-such-tool', neededBy: ['a/b/010'] },
      { platform: 'linux' },
    );
    expect(result.status).toBe('unprobed');
  });

  it('probes an unknown-but-real command through the default runner', () => {
    // `false` exists everywhere and exits non-zero, which is the "present but unusable" path.
    const withProbe = probeTool({ cmd: 'false', neededBy: ['a/b/010'] }, {});
    expect(withProbe.status).toBe('unprobed');
  });
});

describe('formatDoctor', () => {
  it('shows the version, the minimum, who needs it, and what to do', () => {
    const report = runDoctor([need('az', '2.90.0'), need('helm', '3.0.0')], {
      run: canned({ az: LIVE_AZ }),
      platform: 'darwin',
    });
    const text = formatDoctor(report);

    expect(text).toContain('[missing] helm');
    expect(text).toContain('[old]     az 2.89.1 (needs ≥ 2.90.0)');
    expect(text).toContain('needed by: build/compile/030');
    expect(text).toContain('→ brew install helm');
    expect(text).toContain('Some tools need attention.');
  });

  it('says so plainly when everything is present', () => {
    const text = formatDoctor(
      runDoctor([need('docker')], { run: canned({ docker: LIVE_DOCKER }) }),
    );
    expect(text).toContain('[ok]      docker 29.7.2');
    expect(text).toContain('All required tools are present.');
  });

  it('renders every status mark', () => {
    const text = formatDoctor(
      runDoctor([need('az'), need('helm'), need('terraform'), need('docker', '99.0.0')], {
        run: canned({ az: 'not json', docker: LIVE_DOCKER }),
      }),
    );
    for (const mark of ['[missing]', '[old]', '[?ver]', '[?]']) {
      expect(text).toContain(mark);
    }
  });
});

describe('the priority-set fixture (E08-S03-T02 Done criterion)', () => {
  it('reports every tool the deployment set needs, worst-first', () => {
    const tools = [
      need('az'),
      need('azcopy'),
      need('docker'),
      need('helm'),
      need('kubectl'),
      need('pwsh'),
    ];
    const report = runDoctor(tools, {
      // az and docker present; the other four absent — the shape of a typical developer machine.
      run: canned({ az: LIVE_AZ, docker: LIVE_DOCKER }),
      platform: 'linux',
    });

    expect(formatDoctor(report)).toMatchSnapshot();
    expect(report.ok).toBe(false);
  });

  it('reports the same fixture as clean when every tool is present', () => {
    const report = runDoctor(
      [need('az'), need('azcopy'), need('docker'), need('helm'), need('kubectl'), need('pwsh')],
      {
        run: canned({
          az: LIVE_AZ,
          azcopy: 'azcopy version 10.29.1\n',
          docker: LIVE_DOCKER,
          helm: 'v3.14.0\n',
          kubectl: JSON.stringify({ clientVersion: { gitVersion: 'v1.31.2' } }),
          pwsh: 'PowerShell 7.4.1\n',
        }),
      },
    );
    expect(report.ok).toBe(true);
    expect(formatDoctor(report)).toContain('All required tools are present.');
  });

  it('parses azcopy’s version from the last field of its banner', () => {
    expect(
      probeTool(need('azcopy'), { run: canned({ azcopy: 'azcopy version 10.29.1\n' }) }),
    ).toMatchObject({ status: 'ok', found: '10.29.1' });
  });

  it('every remediation string names a real install route, per OS', () => {
    // "missing-tool remediation strings reviewed" — the Done criterion. A hint that just says
    // "install it" is the same as no hint.
    for (const cmd of ['az', 'azcopy', 'docker', 'helm', 'kubectl', 'pwsh']) {
      for (const platform of ['linux', 'darwin', 'win32']) {
        const hint = remediationFor(cmd, platform);
        expect(hint.length, `${cmd}/${platform}`).toBeGreaterThan(15);
        expect(hint, `${cmd}/${platform}`).toMatch(/https?:\/\/|brew |winget |curl /);
      }
    }
  });
});
