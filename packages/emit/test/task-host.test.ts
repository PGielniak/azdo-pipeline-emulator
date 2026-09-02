import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inputEnvName,
  inputValueText,
  renderTaskRunner,
  resolveHandler,
  resolveTaskInputs,
  type TaskDefinition,
} from '../src/task-host.js';

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-taskhost-'));
  tempDirs.push(directory);
  return directory;
}

/** `CmdLine@2`'s declared shape, trimmed to what the host reads. */
const CMDLINE: TaskDefinition = {
  name: 'CmdLine',
  inputs: [
    { name: 'script', type: 'multiLine', required: true },
    { name: 'workingDirectory', type: 'filePath' },
    { name: 'failOnStderr', type: 'boolean', defaultValue: 'false' },
  ],
  execution: { Node20_1: { target: 'cmdline.js' }, Node16: { target: 'cmdline.js' } },
};

/** A marketplace-shaped task with a dotted input name — the case the Ground field omits. */
const DOTTED: TaskDefinition = {
  name: 'SonarQubePrepare',
  inputs: [
    { name: 'sonar.projectKey', required: true },
    { name: 'extra properties', defaultValue: '' },
  ],
  execution: { Node24: { target: 'index.js' } },
};

describe('inputEnvName (C-E07-001)', () => {
  it('replaces dots AND spaces, then upper-cases', () => {
    // The task's Ground field says "spaces→_, uppercase" and omits the dots. Both task-lib's
    // `_getVariableKey` and the agent's `ConvertToEnvVariableFormat` replace `.` as well, so an
    // input named `sonar.projectKey` would otherwise reach the task under a name it never reads.
    expect(inputEnvName('sonar.projectKey')).toBe('INPUT_SONAR_PROJECTKEY');
    expect(inputEnvName('extra properties')).toBe('INPUT_EXTRA_PROPERTIES');
    expect(inputEnvName('a.b c.d')).toBe('INPUT_A_B_C_D');
    expect(inputEnvName('script')).toBe('INPUT_SCRIPT');
  });

  it('preserves every other character, as both implementations do', () => {
    expect(inputEnvName('weird-name_1')).toBe('INPUT_WEIRD-NAME_1');
  });

  it('matches the runtime helper the agent reuses for variables (C-E06-008)', () => {
    // The agent runs one ConvertToEnvVariableFormat for inputs and variables alike, so this must
    // agree with `azdo__env_name` in packages/runtime — a divergence would be invisible until a
    // task read an input the runtime had named differently.
    const script = `
      set -euo pipefail
      source packages/runtime/lib/core.sh
      azdo__env_name 'sonar.projectKey' out; printf '%s\\n' "INPUT_$out"
      azdo__env_name 'extra properties' out; printf '%s\\n' "INPUT_$out"
    `;
    const output = execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim().split('\n');
    expect(output).toEqual([inputEnvName('sonar.projectKey'), inputEnvName('extra properties')]);
  });
});

describe('inputValueText (C-E07-003)', () => {
  it('renders a boolean as the literal getBoolInput accepts', () => {
    // `getBoolInput` is `(value||'').toUpperCase() == "TRUE"` — `1` would read as FALSE.
    expect(inputValueText(true)).toBe('true');
    expect(inputValueText(false)).toBe('false');
  });

  it('renders absent values as empty and everything else verbatim', () => {
    expect(inputValueText(undefined)).toBe('');
    expect(inputValueText(null)).toBe('');
    expect(inputValueText(0)).toBe('0');
    expect(inputValueText('a,,b')).toBe('a,,b');
  });

  it('does not compact a multi-line value (C-E07-004)', () => {
    // `getDelimitedInput` drops empty segments itself; pre-trimming here would change what a task
    // using plain `getInput` sees.
    expect(inputValueText('one\n\ntwo\n')).toBe('one\n\ntwo\n');
  });
});

describe('resolveTaskInputs', () => {
  it('takes the step value, then the declared default', () => {
    const resolution = resolveTaskInputs(CMDLINE, { script: 'echo hi' });
    expect(resolution.inputs.map((input) => [input.envName, input.value])).toEqual([
      ['INPUT_SCRIPT', 'echo hi'],
      ['INPUT_WORKINGDIRECTORY', ''],
      ['INPUT_FAILONSTDERR', 'false'],
    ]);
    expect(resolution.inputs[0]?.fromStep).toBe(true);
    expect(resolution.inputs[2]?.fromStep).toBe(false);
  });

  it('folds input-name case the way the service binds a step', () => {
    const resolution = resolveTaskInputs(CMDLINE, { SCRIPT: 'echo hi', WorkingDirectory: '/tmp' });
    expect(resolution.undeclared).toEqual([]);
    expect(resolution.inputs[0]?.value).toBe('echo hi');
    expect(resolution.inputs[1]?.value).toBe('/tmp');
  });

  it('marks an empty value as invisible to getInput but still emits it (C-E07-002)', () => {
    // `_loadData`'s `if (value)` guard: an empty INPUT_ is not vaulted (getInput -> undefined) and
    // not deleted from process.env (a task reading the env directly still sees it).
    const resolution = resolveTaskInputs(CMDLINE, { script: '' });
    expect(resolution.inputs[0]).toMatchObject({ value: '', emptyForGetInput: true });
    // And that is exactly the case task-lib will throw on.
    expect(resolution.missingRequired).toEqual(['script']);
  });

  it('reports a required input nobody supplied rather than inventing one', () => {
    expect(resolveTaskInputs(CMDLINE, {}).missingRequired).toEqual(['script']);
    expect(resolveTaskInputs(CMDLINE, { script: 'x' }).missingRequired).toEqual([]);
  });

  it('passes an undeclared step input through, and says so', () => {
    // A task may read an input its task.json omits; dropping it would be a silent behavior change.
    const resolution = resolveTaskInputs(CMDLINE, { script: 'x', undocumented: 'y' });
    expect(resolution.undeclared).toEqual(['undocumented']);
    expect(resolution.inputs.at(-1)).toMatchObject({
      envName: 'INPUT_UNDOCUMENTED',
      value: 'y',
    });
  });

  it('handles a task that declares no inputs at all', () => {
    expect(resolveTaskInputs({ name: 'Nothing' })).toEqual({
      inputs: [],
      undeclared: [],
      missingRequired: [],
    });
  });
});

describe('resolveHandler', () => {
  it('prefers the newest Node runtime a task declares', () => {
    expect(resolveHandler(CMDLINE)).toEqual({
      kind: 'node',
      key: 'Node20_1',
      target: 'cmdline.js',
    });
    expect(resolveHandler(DOTTED).key).toBe('Node24');
  });

  it('falls back to PowerShell, then Process, then reports the unknown key', () => {
    expect(
      resolveHandler({ name: 'p', execution: { PowerShell3: { target: 'run.ps1' } } }),
    ).toMatchObject({ kind: 'powershell', target: 'run.ps1' });
    expect(
      resolveHandler({ name: 'x', execution: { Process: { script: 'run.sh' } } }),
    ).toMatchObject({ kind: 'process', target: 'run.sh' });
    expect(resolveHandler({ name: 'x', execution: { Weird: {} } })).toMatchObject({
      kind: 'unknown',
      key: 'Weird',
    });
    expect(resolveHandler({ name: 'x' })).toMatchObject({ kind: 'unknown', key: '' });
  });

  it('reports an empty target rather than a malformed one', () => {
    // A `task.json` whose execution block is not an object, or whose target is not a string, must
    // not produce `pkg/undefined` — the runner would exec a path that cannot exist.
    expect(resolveHandler({ name: 'x', execution: { Node24: null } }).target).toBe('');
    expect(resolveHandler({ name: 'x', execution: { Node24: 'run.js' } }).target).toBe('');
    expect(resolveHandler({ name: 'x', execution: { Node24: { target: 7 } } }).target).toBe('');
  });
});

describe('renderTaskRunner', () => {
  const render = (definition: TaskDefinition, stepInputs: Record<string, unknown>) =>
    renderTaskRunner({
      definition,
      resolution: resolveTaskInputs(definition, stepInputs),
      handler: resolveHandler(definition),
      packageDir: '.cache/tasks/CmdLine@2.279.0/tree',
    });

  it('exports every input and invokes the node handler', () => {
    const script = render(CMDLINE, { script: 'echo hi' });
    expect(script).toContain("export INPUT_SCRIPT='echo hi'");
    expect(script).toContain("export INPUT_FAILONSTDERR='false'");
    expect(script).toContain('exec node \'.cache/tasks/CmdLine@2.279.0/tree/cmdline.js\' "$@"');
  });

  it('quotes a value so it can never become shell', async () => {
    // An input is data. This is the one thing the host must not get wrong.
    const hostile = "'; rm -rf /; echo '";
    const script = render(CMDLINE, { script: hostile });
    const dir = await scratch();
    const path = join(dir, 'run.sh');
    // Replace the exec with an echo so the assertion is about the value, not about running node.
    await writeFile(path, script.replace(/^exec node .*$/m, 'printf %s "$INPUT_SCRIPT"'), 'utf8');

    const output = execFileSync('bash', [path], { encoding: 'utf8' });
    expect(output).toBe(hostile);
  });

  it('survives a value containing $, backticks and a newline', async () => {
    const nasty = 'a $HOME `id` \n b';
    const dir = await scratch();
    const path = join(dir, 'run.sh');
    await writeFile(
      path,
      render(CMDLINE, { script: nasty }).replace(/^exec node .*$/m, 'printf %s "$INPUT_SCRIPT"'),
      'utf8',
    );
    expect(execFileSync('bash', [path], { encoding: 'utf8' })).toBe(nasty);
  });

  it('says "(none declared)" in the header when there is no handler at all', () => {
    const definition: TaskDefinition = { name: 'Bare' };
    const script = renderTaskRunner({
      definition,
      resolution: resolveTaskInputs(definition),
      handler: resolveHandler(definition),
      packageDir: 'pkg',
    });
    expect(script).toContain('# Handler: (none declared) -> (no target)');
  });

  it('names a required input nobody supplied instead of hiding it', () => {
    expect(render(CMDLINE, {})).toContain('required input not supplied: script');
  });

  it('annotates an empty input with why getInput will not see it', () => {
    expect(render(CMDLINE, { script: '' })).toContain('getInput() will not see this');
  });

  it('refuses, loudly, a task whose handler this host cannot run', () => {
    const script = renderTaskRunner({
      definition: { name: 'Odd', execution: { Weird: {} } },
      resolution: resolveTaskInputs({ name: 'Odd' }),
      handler: resolveHandler({ name: 'Odd', execution: { Weird: {} } }),
      packageDir: 'pkg',
    });
    expect(script).toContain('declares no handler this host can run');
    expect(script).toContain('exit 1');
  });

  it('execs a process handler directly', () => {
    const definition: TaskDefinition = {
      name: 'Legacy',
      execution: { Process: { script: 'run.sh' } },
    };
    expect(
      renderTaskRunner({
        definition,
        resolution: resolveTaskInputs(definition),
        handler: resolveHandler(definition),
        packageDir: 'pkg',
      }),
    ).toContain(`exec 'pkg/run.sh' "$@"`);
  });

  it('emits pwsh for a PowerShell handler', () => {
    const definition: TaskDefinition = {
      name: 'PowerShell',
      execution: { PowerShell3: { target: 'powershell.ps1' } },
    };
    expect(
      renderTaskRunner({
        definition,
        resolution: resolveTaskInputs(definition),
        handler: resolveHandler(definition),
        packageDir: 'pkg/',
      }),
    ).toContain("exec pwsh -NoLogo -NonInteractive -File 'pkg/powershell.ps1'");
  });
});

describe('the Done criterion — a script-backed task and a real Node task agree', () => {
  it('both observe exactly the INPUT_* their task.json declares', async () => {
    // `CmdLine@2` (the script shorthand's real task) and a marketplace-shaped Node task are driven
    // through the same host, and a stand-in for task-lib reads the values back the way `getInput`
    // would: 'INPUT_' + name with dots and spaces underscored, upper-cased.
    const dir = await scratch();
    const getInput = (name: string) => `\${${inputEnvName(name)}-<unset>}`;

    const cases: readonly [TaskDefinition, Record<string, unknown>, readonly string[]][] = [
      [
        CMDLINE,
        { script: 'echo hi', failOnStderr: true },
        ['script', 'workingDirectory', 'failOnStderr'],
      ],
      [
        DOTTED,
        { 'sonar.projectKey': 'my-key', 'extra properties': 'k=v' },
        ['sonar.projectKey', 'extra properties'],
      ],
    ];

    for (const [definition, stepInputs, names] of cases) {
      const script = renderTaskRunner({
        definition,
        resolution: resolveTaskInputs(definition, stepInputs),
        handler: resolveHandler(definition),
        packageDir: 'pkg',
      }).replace(
        /^exec .*$/m,
        names.map((name) => `printf '%s\\n' "${getInput(name)}"`).join('\n'),
      );

      const path = join(dir, `${definition.name}.sh`);
      await writeFile(path, script, 'utf8');
      const observed = execFileSync('bash', [path], { encoding: 'utf8' }).split('\n').slice(0, -1);
      const expected = names.map(
        (name) =>
          resolveTaskInputs(definition, stepInputs).inputs.find((i) => i.name === name)!.value,
      );
      expect(observed).toEqual(expected);
    }
  });
});
