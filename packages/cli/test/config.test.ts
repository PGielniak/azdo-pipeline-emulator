// E13-S01-T02 — config loader, `--parameter` parsing, and the precedence matrix.
//
// The matrix is literal: every key docs/06 §2 defines appears with a CLI variant (where a flag can
// express it), a config variant, and a default variant, so "CLI > config > defaults" is verified
// key by key rather than sampled.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CliError } from '../src/exit.js';
import {
  CONFIG_FILE_NAME,
  DEFAULTS,
  discoverConfigFile,
  loadConfigFile,
  loadConfigFor,
  parseParameterOption,
  parseParameterOptions,
  resolveSettings,
  type AzdoEmuConfig,
  type CliSettings,
} from '../src/config/index.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A throwaway directory holding a pipeline and, optionally, a config beside it. */
function workspace(configSource?: string): { dir: string; pipeline: string; config: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'azdo-emu-config-'));
  roots.push(dir);
  const pipeline = path.join(dir, 'azure-pipelines.yml');
  writeFileSync(pipeline, 'steps:\n- script: echo hi\n');
  const config = path.join(dir, CONFIG_FILE_NAME);
  if (configSource !== undefined) writeFileSync(config, configSource);
  return { dir, pipeline, config };
}

function loadSource(source: string): AzdoEmuConfig {
  return loadConfigFile(workspace(source).config).config;
}

function expectCliError(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected a CliError, but nothing was thrown');
}

describe('config loader (E13-S01-T02)', () => {
  describe('discovery — beside the pipeline (docs/06 §2)', () => {
    it('finds azdo-emu.yaml next to the pipeline file', () => {
      const { pipeline, config } = workspace('project: Platform\n');
      expect(discoverConfigFile(pipeline)).toBe(config);
      expect(loadConfigFor(pipeline).config).toEqual({ project: 'Platform' });
    });

    it('an absent config is not an error — every key is optional', () => {
      const { pipeline } = workspace();
      expect(discoverConfigFile(pipeline)).toBeUndefined();
      expect(loadConfigFor(pipeline)).toEqual({ file: undefined, config: {} });
    });

    it('an empty config file is an empty config, not a parse error', () => {
      expect(loadSource('')).toEqual({});
      expect(loadSource('# only a comment\n')).toEqual({});
    });
  });

  describe('parsing is our own format, not the pipeline dialect', () => {
    it('accepts YAML anchors — the service quirks (C-E01-021..028) do not apply here', () => {
      const config = loadSource(
        'parameters:\n  a: &shared value\n  b: *shared\ntasks:\n  unknown: fail\n',
      );
      expect(config.parameters).toEqual({ a: 'value', b: 'value' });
      expect(config.tasks?.unknown).toBe('fail');
    });
  });

  describe('validation errors name the key and the line', () => {
    it('reports malformed YAML with a position', () => {
      const error = expectCliError(() => loadSource('project: [unclosed\n'));
      expect(error.message).toMatch(/azdo-emu\.yaml:\d+:\d+:/);
    });

    it('rejects an unknown top-level key with a suggestion', () => {
      const error = expectCliError(() => loadSource('organisation: https://dev.azure.com/x\n'));
      expect(error.message).toContain('`organisation`');
      expect(error.message).toContain('unknown key');
      expect(error.message).toContain('did you mean `organization`?');
    });

    it('rejects an unknown nested key', () => {
      const error = expectCliError(() => loadSource('output:\n  targetOS: linux\n'));
      expect(error.message).toContain('`output.targetOS`');
    });

    it('rejects a wrong type, naming what it found', () => {
      expect(expectCliError(() => loadSource('project: 42\n')).message).toContain(
        'expected a string, found number 42',
      );
      expect(
        expectCliError(() => loadSource('output:\n  sharedWorkspace: yes please\n')).message,
      ).toContain('expected true or false');
      expect(expectCliError(() => loadSource('auth: interactive\n')).message).toContain(
        'expected a mapping',
      );
    });

    it('rejects a value outside an enum, listing the allowed values', () => {
      const error = expectCliError(() => loadSource('output:\n  checkoutMode: symlink\n'));
      expect(error.message).toContain('expected one of clone, copy, worktree');
      expect(error.message).toContain('"symlink"');
    });

    it('requires `path` on a repository override', () => {
      expect(
        expectCliError(() => loadSource('repositories:\n  templates: {}\n')).message,
      ).toContain('needs a `path:`');
    });

    it('every validation failure is a CliError, so it exits 1 through the T01 path', () => {
      expect(expectCliError(() => loadSource('project: 42\n')).exitCode).toBe(1);
    });
  });

  describe('paths inside the config resolve from the config file (C-E13-013)', () => {
    it('resolves a relative repository path against the config directory', () => {
      const { dir, config } = workspace('repositories:\n  templates:\n    path: ../templates\n');
      const loaded = loadConfigFile(config);
      expect(loaded.config.repositories?.['templates']?.path).toBe(
        path.resolve(path.dirname(dir), 'templates'),
      );
    });
  });

  describe('the docs/06 §2 example loads as written', () => {
    it('accepts every documented key', () => {
      const config = loadSource(
        [
          'organization: https://dev.azure.com/contoso',
          'project: Platform',
          'auth: { azdo: interactive, github: gh }',
          'parameters: { deployEnv: dev }',
          'repositories:',
          '  templates: { path: ../pipeline-templates }',
          'variableGroups: { listNames: true }',
          'tasks:',
          '  unknown: stub',
          '  overrides: { "SonarQubePrepare@5": skip }',
          '  execute: []',
          'output:',
          '  targetOs: linux',
          '  checkoutMode: clone',
          '  sharedWorkspace: true',
          '  execution:',
          '    environment: host',
          '    image: null',
          '    dockerSocket: auto',
          '',
        ].join('\n'),
      );
      expect(config.organization).toBe('https://dev.azure.com/contoso');
      expect(config.tasks?.overrides).toEqual({ 'SonarQubePrepare@5': 'skip' });
      expect(config.output?.execution?.image).toBeNull();
    });
  });
});

describe('--parameter parsing (E13-S01-T02, C-E13-013)', () => {
  it('splits on the first `=` only, so a value may contain `=`', () => {
    expect(parseParameterOption('conn=Server=x;Db=y')).toEqual(['conn', 'Server=x;Db=y']);
  });

  it('keeps values as typed — coercion belongs to the binder (C-E13-009)', () => {
    expect(parseParameterOption('flag=true')).toEqual(['flag', 'true']);
    expect(parseParameterOption('count=42')).toEqual(['count', '42']);
    expect(parseParameterOption('empty=')).toEqual(['empty', '']);
  });

  it('rejects a missing `=` or an empty name', () => {
    expect(expectCliError(() => parseParameterOption('deployEnv')).message).toContain(
      'needs `name=value`',
    );
    expect(expectCliError(() => parseParameterOption('=value')).message).toContain('name=value');
  });

  it('loads a complex value from @file.json, resolved against the cwd', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'azdo-emu-param-'));
    roots.push(dir);
    mkdirSync(path.join(dir, 'nested'));
    writeFileSync(path.join(dir, 'nested', 'jobs.json'), '[{"job":"A"},{"job":"B"}]');
    expect(parseParameterOption('jobs=@nested/jobs.json', { cwd: dir })).toEqual([
      'jobs',
      [{ job: 'A' }, { job: 'B' }],
    ]);
  });

  it('doubles `@` to escape a literal value that starts with `@`', () => {
    expect(parseParameterOption('handle=@@octocat')).toEqual(['handle', '@octocat']);
  });

  it('names the resolved path when the file is missing or invalid', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'azdo-emu-param-'));
    roots.push(dir);
    const missing = expectCliError(() => parseParameterOption('x=@nope.json', { cwd: dir }));
    expect(missing.message).toContain(path.join(dir, 'nope.json'));
    expect(missing.message).toContain('cannot read');

    writeFileSync(path.join(dir, 'bad.json'), '{not json');
    const invalid = expectCliError(() => parseParameterOption('x=@bad.json', { cwd: dir }));
    expect(invalid.message).toContain('is not valid JSON');
    expect(invalid.message).toContain(path.join(dir, 'bad.json'));
  });

  it('rejects a bare `@` with no file name', () => {
    expect(expectCliError(() => parseParameterOption('x=@')).message).toContain(
      'missing a file name',
    );
  });

  it('is repeatable, later occurrences winning per key', () => {
    expect(parseParameterOptions(['a=1', 'b=2', 'a=3'])).toEqual({ a: '3', b: '2' });
  });
});

describe('precedence matrix — CLI > config > defaults (docs/06 §2)', () => {
  /** Every documented key, with the layers that can express it. */
  const CASES: ReadonlyArray<{
    key: string;
    cli?: CliSettings;
    config?: AzdoEmuConfig;
    read: (settings: ReturnType<typeof resolveSettings>['settings']) => unknown;
    expected: { cli?: unknown; config: unknown; default: unknown };
  }> = [
    {
      key: 'organization',
      cli: { organization: 'https://dev.azure.com/from-cli' },
      config: { organization: 'https://dev.azure.com/from-config' },
      read: (s) => s.organization,
      expected: {
        cli: 'https://dev.azure.com/from-cli',
        config: 'https://dev.azure.com/from-config',
        default: undefined,
      },
    },
    {
      key: 'project',
      cli: { project: 'FromCli' },
      config: { project: 'FromConfig' },
      read: (s) => s.project,
      expected: { cli: 'FromCli', config: 'FromConfig', default: undefined },
    },
    {
      key: 'auth.azdo',
      config: { auth: { azdo: 'pat' } },
      read: (s) => s.auth.azdo,
      expected: { config: 'pat', default: 'interactive' },
    },
    {
      key: 'auth.github',
      config: { auth: { github: 'pat' } },
      read: (s) => s.auth.github,
      expected: { config: 'pat', default: 'gh' },
    },
    {
      key: 'variableGroups.listNames',
      cli: { groupNames: false },
      config: { variableGroups: { listNames: true } },
      read: (s) => s.variableGroups.listNames,
      expected: { cli: false, config: true, default: true },
    },
    {
      key: 'tasks.unknown',
      config: { tasks: { unknown: 'fail' } },
      read: (s) => s.tasks.unknown,
      expected: { config: 'fail', default: 'stub' },
    },
    {
      key: 'tasks.execute',
      config: { tasks: { execute: ['Npm@1'] } },
      read: (s) => s.tasks.execute,
      expected: { config: ['Npm@1'], default: [] },
    },
    {
      key: 'output.targetOs',
      cli: { targetOs: 'macos' },
      config: { output: { targetOs: 'windows' } },
      read: (s) => s.output.targetOs,
      expected: { cli: 'macos', config: 'windows', default: 'linux' },
    },
    {
      key: 'output.checkoutMode',
      cli: { checkoutMode: 'worktree' },
      config: { output: { checkoutMode: 'copy' } },
      read: (s) => s.output.checkoutMode,
      expected: { cli: 'worktree', config: 'copy', default: 'clone' },
    },
    {
      key: 'output.sharedWorkspace',
      config: { output: { sharedWorkspace: false } },
      read: (s) => s.output.sharedWorkspace,
      expected: { config: false, default: true },
    },
    {
      // E12-S02-T02 — `auto` is gone and the default is `host`, so `ExecutionEnvironment` has only
      // two members. The *config* value is the one held off the default on purpose: the failure this
      // row has to catch after the flip is a resolver that answers `host` without reading the config.
      key: 'output.execution.environment',
      cli: { execEnv: 'host' },
      config: { output: { execution: { environment: 'sandbox' } } },
      read: (s) => s.output.execution.environment,
      expected: { cli: 'host', config: 'sandbox', default: 'host' },
    },
    {
      key: 'output.execution.image',
      cli: { sandboxImage: 'cli-image' },
      config: { output: { execution: { image: 'config-image' } } },
      read: (s) => s.output.execution.image,
      expected: { cli: 'cli-image', config: 'config-image', default: null },
    },
    {
      key: 'output.execution.dockerSocket',
      config: { output: { execution: { dockerSocket: 'share' } } },
      read: (s) => s.output.execution.dockerSocket,
      expected: { config: 'share', default: 'auto' },
    },
  ];

  it('covers every key of docs/06 §2 that resolves as a scalar', () => {
    expect(CASES.map((c) => c.key)).toEqual([
      'organization',
      'project',
      'auth.azdo',
      'auth.github',
      'variableGroups.listNames',
      'tasks.unknown',
      'tasks.execute',
      'output.targetOs',
      'output.checkoutMode',
      'output.sharedWorkspace',
      'output.execution.environment',
      'output.execution.image',
      'output.execution.dockerSocket',
    ]);
  });

  for (const testCase of CASES) {
    describe(testCase.key, () => {
      it('falls back to the default when neither layer sets it', () => {
        const { settings, sources } = resolveSettings({}, {});
        expect(testCase.read(settings)).toEqual(testCase.expected.default);
        expect(sources[testCase.key]).toBe('default');
      });

      it('takes the config value over the default', () => {
        const { settings, sources } = resolveSettings({}, testCase.config ?? {});
        expect(testCase.read(settings)).toEqual(testCase.expected.config);
        expect(sources[testCase.key]).toBe('config');
      });

      if (testCase.cli) {
        it('takes the CLI value over the config value', () => {
          const { settings, sources } = resolveSettings(testCase.cli!, testCase.config ?? {});
          expect(testCase.read(settings)).toEqual(testCase.expected.cli);
          expect(sources[testCase.key]).toBe('cli');
        });
      }
    });
  }

  describe('map-valued keys merge per key (C-E13-012)', () => {
    it('a CLI parameter overrides one config parameter and leaves the rest', () => {
      const { settings } = resolveSettings(
        { parameters: { a: '1' } },
        { parameters: { a: '0', b: '2' } },
      );
      expect(settings.parameters).toEqual({ a: '1', b: '2' });
    });

    it('config repositories and task overrides merge onto the (empty) defaults', () => {
      const { settings } = resolveSettings(
        {},
        {
          repositories: { templates: { path: '/tmp/templates' } },
          tasks: { overrides: { 'SonarQubePrepare@5': 'skip' } },
        },
      );
      expect(settings.repositories).toEqual({ templates: { path: '/tmp/templates' } });
      expect(settings.tasks.overrides).toEqual({ 'SonarQubePrepare@5': 'skip' });
    });

    it('a list-valued key replaces rather than merging', () => {
      const { settings } = resolveSettings({}, { tasks: { execute: ['Npm@1'] } });
      expect(settings.tasks.execute).toEqual(['Npm@1']);
    });
  });

  it('with no CLI and no config, the resolution is exactly DEFAULTS', () => {
    expect(resolveSettings({}, {}).settings).toEqual(DEFAULTS);
  });

  it('`image: null` in the config is a value, not an absent key', () => {
    // The default happens to be null too, so only the recorded *source* distinguishes "the config
    // said no override" from "nobody said anything" — which is what resolve.ts's comment claims.
    const { settings, sources } = resolveSettings({}, { output: { execution: { image: null } } });
    expect(settings.output.execution.image).toBeNull();
    expect(sources['output.execution.image']).toBe('config');
    expect(resolveSettings({}, {}).sources['output.execution.image']).toBe('default');
  });

  it('an explicit falsy value from the CLI still wins over the config', () => {
    // The classic falsy-value bug: `||`-style precedence would drop these. `coverage.min: 0` was
    // this test's numeric exemplar until E12-S02-T01 removed the key; no numeric scalar is left in
    // the surface, so the empty string stands in for it alongside the boolean.
    const { settings, sources } = resolveSettings(
      { groupNames: false, sandboxImage: '' },
      { variableGroups: { listNames: true }, output: { execution: { image: 'ubuntu:24.04' } } },
    );
    expect(settings.variableGroups.listNames).toBe(false);
    expect(settings.output.execution.image).toBe('');
    expect(sources['output.execution.image']).toBe('cli');
  });
});
