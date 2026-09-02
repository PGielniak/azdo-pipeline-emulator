/**
 * The doctor engine (E10-S04-T01).
 *
 * Reads the manifest's `tools[]`, probes each on PATH, compares versions, and reports what is
 * missing or too old with a remediation the reader can act on.
 *
 * Every probe command is cited from the tool's own documentation (C-E10-001..005), because the
 * failure mode of guessing is the worst kind: a doctor that runs the wrong version command reports
 * a tool as **missing when it is installed**, and the user goes looking for an install problem that
 * does not exist. Two of the five commands are additionally confirmed against live installations;
 * C-E10-006 records which three are not.
 *
 * Two probe choices are load-bearing:
 *
 *  - **`docker version --format '{{.Client.Version}}'`, not the server version** (C-E10-002). A
 *    stopped daemon still reports a client, so reading the server would call Docker missing whenever
 *    it is merely not running.
 *  - **`kubectl version --client`** (C-E10-003). Without `--client`, kubectl contacts the API
 *    server — a doctor run would then hang or fail on an unreachable cluster rather than on a
 *    missing binary.
 */

import { spawnSync } from 'node:child_process';

export interface ToolRequirement {
  /** The command as it appears on PATH. */
  readonly cmd: string;
  /** Minimum acceptable version, `major.minor.patch` with optional trailing parts. */
  readonly min?: string;
  /** Step paths that need it, `StageId/JobId/StepOrdinal`. */
  readonly neededBy: readonly string[];
}

export type ProbeStatus = 'ok' | 'outdated' | 'missing' | 'unknown-version' | 'unprobed';

export interface ProbeResult {
  readonly cmd: string;
  readonly status: ProbeStatus;
  readonly found?: string;
  readonly min?: string;
  readonly neededBy: readonly string[];
  readonly remediation?: string;
}

/** How to ask a tool its version, and how to read the answer. */
export interface ProbeSpec {
  readonly args: readonly string[];
  /** Pull the version out of the command's stdout; `undefined` when it cannot be found. */
  readonly parse: (stdout: string) => string | undefined;
  /** The claim that pins this command, quoted in the doctor's `--json` output. */
  readonly claim: string;
}

const jsonField =
  (...path: readonly string[]) =>
  (stdout: string): string | undefined => {
    let value: unknown;
    try {
      value = JSON.parse(stdout) as unknown;
    } catch {
      return undefined;
    }
    for (const key of path) {
      if (value === null || typeof value !== 'object') return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return typeof value === 'string' ? value : undefined;
  };

const firstLine = (stdout: string): string | undefined => {
  const line = stdout.split('\n')[0]?.trim();
  return line === undefined || line.length === 0 ? undefined : line;
};

/**
 * The probe table. One entry per tool the priority set needs (docs/03 D).
 *
 * `az --version` is deliberately absent: it prints prose *and* an update banner, so parsing it
 * breaks on any machine with a pending upgrade — which is most of them (C-E10-001).
 */
export const PROBES: Readonly<Record<string, ProbeSpec>> = {
  az: {
    args: ['version'],
    parse: jsonField('azure-cli'),
    claim: 'C-E10-001',
  },
  docker: {
    args: ['version', '--format', '{{.Client.Version}}'],
    parse: firstLine,
    claim: 'C-E10-002',
  },
  kubectl: {
    args: ['version', '--client', '-o', 'json'],
    parse: jsonField('clientVersion', 'gitVersion'),
    claim: 'C-E10-003',
  },
  helm: {
    args: ['version', '--template', '{{.Version}}'],
    parse: firstLine,
    claim: 'C-E10-004',
  },
  pwsh: {
    args: ['-v'],
    // `PowerShell 7.4.1` — the version is the second field.
    parse: (stdout) => firstLine(stdout)?.split(/\s+/)[1],
    claim: 'C-E10-005',
  },
};

/** Install hints, per tool and per OS. */
const REMEDIATION: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  az: {
    linux: 'curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash',
    darwin: 'brew install azure-cli',
    win32: 'winget install -e --id Microsoft.AzureCLI',
  },
  docker: {
    linux: 'https://docs.docker.com/engine/install/ — or your distribution’s docker.io package',
    darwin: 'brew install --cask docker',
    win32: 'winget install -e --id Docker.DockerDesktop',
  },
  kubectl: {
    linux: 'https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/',
    darwin: 'brew install kubectl',
    win32: 'winget install -e --id Kubernetes.kubectl',
  },
  helm: {
    linux: 'https://helm.sh/docs/intro/install/ — or `curl … get-helm-3 | bash`',
    darwin: 'brew install helm',
    win32: 'winget install -e --id Helm.Helm',
  },
  pwsh: {
    linux:
      'https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-linux',
    darwin: 'brew install --cask powershell',
    win32: 'winget install -e --id Microsoft.PowerShell',
  },
};

export function remediationFor(cmd: string, platform: string = process.platform): string {
  const perOs = REMEDIATION[cmd];
  if (perOs === undefined) return `Install \`${cmd}\` and make sure it is on your PATH.`;
  return perOs[platform] ?? perOs.linux ?? `Install \`${cmd}\` and put it on your PATH.`;
}

/**
 * Compare two dotted versions numerically.
 *
 * Numeric, not lexical: `2.10.0` is newer than `2.9.0`, and a string compare says the opposite —
 * which would report a perfectly current tool as outdated. Non-numeric trailing parts (`v3.14.0+g…`,
 * `7.4.1-preview`) are tolerated by taking the leading digits of each component.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string): number[] =>
    value
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((piece) => Number.parseInt(piece, 10))
      .filter((piece) => Number.isFinite(piece));
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export type Runner = (
  cmd: string,
  args: readonly string[],
) => { code: number; stdout: string } | undefined;

export interface DoctorOptions {
  readonly run?: Runner;
  readonly platform?: string;
}

/**
 * Probe one requirement.
 *
 * A tool with no probe entry is reported `unprobed` rather than assumed present: claiming a tool is
 * fine because we do not know how to ask it is the one answer a doctor must never give.
 */
export function probeTool(requirement: ToolRequirement, options: DoctorOptions = {}): ProbeResult {
  const spec = PROBES[requirement.cmd];
  const base = {
    cmd: requirement.cmd,
    neededBy: requirement.neededBy,
    ...(requirement.min === undefined ? {} : { min: requirement.min }),
  };

  if (spec === undefined) {
    return {
      ...base,
      status: 'unprobed',
      remediation: `azdo-emu has no version probe for \`${requirement.cmd}\`; check it yourself before running.`,
    };
  }

  const run = options.run ?? defaultRunner;
  const outcome = run(requirement.cmd, spec.args);
  if (outcome === undefined || outcome.code !== 0) {
    return {
      ...base,
      status: 'missing',
      remediation: remediationFor(requirement.cmd, options.platform),
    };
  }

  const found = spec.parse(outcome.stdout);
  if (found === undefined) {
    return {
      ...base,
      status: 'unknown-version',
      remediation:
        `\`${requirement.cmd} ${spec.args.join(' ')}\` ran but its output could not be parsed; ` +
        'the tool is present, so this is a version check azdo-emu skipped rather than a failure.',
    };
  }

  if (requirement.min !== undefined && compareVersions(found, requirement.min) < 0) {
    return {
      ...base,
      status: 'outdated',
      found,
      remediation: remediationFor(requirement.cmd, options.platform),
    };
  }
  return { ...base, status: 'ok', found };
}

const defaultRunner: Runner = (cmd, args) => {
  const result = spawnSync(cmd, [...args], { encoding: 'utf8', windowsHide: true });
  // A missing binary surfaces as `error` (ENOENT), not as a non-zero status.
  if (result.error !== undefined) return undefined;
  return { code: result.status ?? 1, stdout: result.stdout ?? '' };
};

export interface DoctorReport {
  readonly results: readonly ProbeResult[];
  /** True when nothing is missing or outdated — `unprobed` and `unknown-version` do not fail. */
  readonly ok: boolean;
}

/** Probe every requirement, worst first so the thing to fix is the thing you read. */
export function runDoctor(
  tools: readonly ToolRequirement[],
  options: DoctorOptions = {},
): DoctorReport {
  const severity: Record<ProbeStatus, number> = {
    missing: 0,
    outdated: 1,
    'unknown-version': 2,
    unprobed: 3,
    ok: 4,
  };
  const results = tools
    .map((requirement) => probeTool(requirement, options))
    .sort((a, b) => severity[a.status] - severity[b.status] || a.cmd.localeCompare(b.cmd));
  return {
    results,
    ok: results.every((result) => result.status !== 'missing' && result.status !== 'outdated'),
  };
}

/** Human-readable report. */
export function formatDoctor(report: DoctorReport): string {
  if (report.results.length === 0) {
    return 'This pipeline needs no external tools.\n';
  }
  const lines: string[] = [];
  for (const result of report.results) {
    const version =
      result.found === undefined
        ? ''
        : ` ${result.found}${result.min === undefined ? '' : ` (needs ≥ ${result.min})`}`;
    lines.push(`${statusMark(result.status)} ${result.cmd}${version}`);
    if (result.neededBy.length > 0) {
      lines.push(`    needed by: ${result.neededBy.join(', ')}`);
    }
    if (result.remediation !== undefined) {
      lines.push(`    → ${result.remediation}`);
    }
  }
  lines.push('', report.ok ? 'All required tools are present.' : 'Some tools need attention.');
  return `${lines.join('\n')}\n`;
}

function statusMark(status: ProbeStatus): string {
  switch (status) {
    case 'ok':
      return '[ok]     ';
    case 'outdated':
      return '[old]    ';
    case 'missing':
      return '[missing]';
    case 'unknown-version':
      return '[?ver]   ';
    case 'unprobed':
      return '[?]      ';
  }
}
