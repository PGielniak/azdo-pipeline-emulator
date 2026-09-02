import { describe, expect, it } from 'vitest';
import {
  TASK_TOOLS,
  aggregateTools,
  checkToolContract,
  requirementsFor,
  toolKey,
} from '../src/doctor/requirements.js';

describe('toolKey', () => {
  it('reduces a full version to its major, so a patch bump does not stale the registry', () => {
    expect(toolKey('AzureCLI@2')).toBe('AzureCLI@2');
    expect(toolKey('AzureCLI@2.256.1')).toBe('AzureCLI@2');
    expect(toolKey('CmdLine')).toBe('CmdLine');
    expect(toolKey('@2')).toBe('@2');
  });
});

describe('requirementsFor', () => {
  it('names the tool a task shells out to, with the evidence (C-E10-007)', () => {
    const [az] = requirementsFor('AzureCLI@2');
    expect(az?.cmd).toBe('az');
    // The task resolves `az` itself; the registry records that rather than inferring from the name.
    expect(az?.because).toContain("tl.which('az', false)");
  });

  it('returns nothing for a task that needs no external CLI', () => {
    expect(requirementsFor('CmdLine@2')).toEqual([]);
    expect(requirementsFor('PublishTestResults@2')).toEqual([]);
  });

  it('matches on the major, whatever the full version says', () => {
    expect(requirementsFor('Docker@2.240.0').map((r) => r.cmd)).toEqual(['docker']);
  });

  it('records both tools when a task needs two', () => {
    expect(requirementsFor('HelmDeploy@0').map((r) => r.cmd)).toEqual(['helm', 'kubectl']);
  });
});

describe('no entry invents a version (C-E10-008/009)', () => {
  it('declares no `min` anywhere, because no task states one', () => {
    // The tempting substitute is `minimumAgentVersion` — but Docker@2's is 2.172.0, which as a
    // Docker version has never existed and would report every installation as outdated.
    for (const [taskRef, requirements] of Object.entries(TASK_TOOLS)) {
      for (const requirement of requirements) {
        expect(requirement.min, `${taskRef} / ${requirement.cmd}`).toBeUndefined();
      }
    }
  });

  it('every entry records why the tool is needed', () => {
    for (const requirements of Object.values(TASK_TOOLS)) {
      for (const requirement of requirements) {
        expect(requirement.because.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('aggregateTools', () => {
  const steps = [
    { taskRef: 'AzureCLI@2', path: 'deploy/web/010' },
    { taskRef: 'AzureCLI@2', path: 'deploy/web/020' },
    { taskRef: 'Docker@2', path: 'build/img/010' },
    { taskRef: 'CmdLine@2', path: 'build/img/020' },
    { taskRef: 'HelmDeploy@0', path: 'deploy/web/030' },
  ];

  it('produces one entry per tool, listing every step that needs it', () => {
    // Twelve `az` steps must give one entry with twelve paths — doctor output is meant to be read
    // to the end.
    const tools = aggregateTools(steps);
    expect(tools.map((tool) => tool.cmd)).toEqual(['az', 'docker', 'helm', 'kubectl']);
    expect(tools.find((tool) => tool.cmd === 'az')?.neededBy).toEqual([
      'deploy/web/010',
      'deploy/web/020',
    ]);
  });

  it('de-duplicates a repeated step path', () => {
    const tools = aggregateTools([
      { taskRef: 'AzureCLI@2', path: 'a/b/010' },
      { taskRef: 'AzureCLI@1', path: 'a/b/010' },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.neededBy).toEqual(['a/b/010']);
  });

  it('contributes nothing for a pipeline of script steps', () => {
    expect(aggregateTools([{ taskRef: 'CmdLine@2', path: 'a/b/010' }])).toEqual([]);
    expect(aggregateTools([])).toEqual([]);
  });

  it('carries no min today, matching the registry', () => {
    for (const tool of aggregateTools(steps)) {
      expect('min' in tool).toBe(false);
    }
  });

  it('sorts by command so the manifest is stable across converts', () => {
    const forward = aggregateTools(steps).map((tool) => tool.cmd);
    const reversed = aggregateTools([...steps].reverse()).map((tool) => tool.cmd);
    expect(reversed).toEqual(forward);
  });
});

describe('checkToolContract — the CI check (C-E10-010)', () => {
  it('passes over the shipped registry', () => {
    // A task added later cannot silently become a step that fails with `command not found` at run
    // time instead of failing the doctor before the run.
    expect(checkToolContract()).toEqual([]);
  });

  it('every registry key is Name@major, with no minor part', () => {
    for (const key of Object.keys(TASK_TOOLS)) {
      expect(key, key).toMatch(/^[^@]+@\d+$/);
      expect(toolKey(key)).toBe(key);
    }
  });
});

describe('checkToolContract catches the mistakes it exists for', () => {
  it('rejects a key that is not Name@major', () => {
    // `AzureCLI@2.256.1` would never match a lookup, so the registry entry would be dead weight
    // and the task would silently declare nothing.
    const violations = checkToolContract({
      'AzureCLI@2.256.1': [{ cmd: 'az', because: 'x'.repeat(20) }],
    });
    expect(violations[0]?.reason).toContain('Name@major');
  });

  it('rejects an entry that declares no tools', () => {
    expect(checkToolContract({ 'Empty@1': [] })[0]?.reason).toContain('declares no tools');
  });

  it('rejects a tool with no reason recorded', () => {
    expect(checkToolContract({ 'NoWhy@1': [{ cmd: 'az', because: '   ' }] })[0]?.reason).toContain(
      'no reason recorded',
    );
  });

  it('rejects a version floor that cites no claim (C-E10-008/009)', () => {
    // This is the guard against reading `minimumAgentVersion` as a tool version.
    const violations = checkToolContract({
      'Invented@1': [{ cmd: 'docker', min: '2.172.0', because: 'it says so in task.json' }],
    });
    expect(violations[0]?.reason).toContain('doctor never invents versions');
  });

  it('accepts a floor that does cite a claim', () => {
    expect(
      checkToolContract({
        'Cited@1': [{ cmd: 'docker', min: '20.10.0', because: 'measured in C-E08-042' }],
      }),
    ).toEqual([]);
  });
});

describe('aggregateTools keeps the stricter floor when two tasks disagree', () => {
  it('takes the higher minimum', () => {
    const registry = {
      'Low@1': [{ cmd: 'docker', min: '20.10.0', because: 'C-E08-042' }],
      'High@1': [{ cmd: 'docker', min: '24.0.0', because: 'C-E08-043' }],
    };
    const tools = aggregateTools(
      [
        { taskRef: 'Low@1', path: 'a/b/010' },
        { taskRef: 'High@1', path: 'a/b/020' },
      ],
      registry,
    );
    expect(tools).toEqual([{ cmd: 'docker', min: '24.0.0', neededBy: ['a/b/010', 'a/b/020'] }]);
  });

  it('keeps the existing floor when the later task declares none', () => {
    const registry = {
      'WithMin@1': [{ cmd: 'docker', min: '24.0.0', because: 'C-E08-043' }],
      'NoMin@1': [{ cmd: 'docker', because: 'no floor stated anywhere' }],
    };
    const tools = aggregateTools(
      [
        { taskRef: 'WithMin@1', path: 'a/b/010' },
        { taskRef: 'NoMin@1', path: 'a/b/020' },
      ],
      registry,
    );
    expect(tools[0]?.min).toBe('24.0.0');
  });

  it('adopts a floor a later task introduces', () => {
    const registry = {
      'NoMin@1': [{ cmd: 'docker', because: 'no floor stated anywhere' }],
      'WithMin@1': [{ cmd: 'docker', min: '24.0.0', because: 'C-E08-043' }],
    };
    const tools = aggregateTools(
      [
        { taskRef: 'NoMin@1', path: 'a/b/010' },
        { taskRef: 'WithMin@1', path: 'a/b/020' },
      ],
      registry,
    );
    expect(tools[0]?.min).toBe('24.0.0');
  });
});

describe('the priority set has a rule for every tool it needs (E08-S03-T02)', () => {
  const PRIORITY_TASKS = [
    'AzureCLI@2',
    'AzurePowerShell@5',
    'Docker@2',
    'HelmDeploy@0',
    'KubernetesManifest@1',
    'AzureFileCopy@6',
  ];

  it('declares a tool for every priority task', () => {
    for (const taskRef of PRIORITY_TASKS) {
      expect(requirementsFor(taskRef).length, taskRef).toBeGreaterThan(0);
    }
  });

  it('covers the six CLIs docs/03 D names', () => {
    const tools = new Set(
      PRIORITY_TASKS.flatMap((taskRef) => requirementsFor(taskRef).map((r) => r.cmd)),
    );
    expect([...tools].sort()).toEqual(['az', 'azcopy', 'docker', 'helm', 'kubectl', 'pwsh']);
  });

  it('still declares no floors — vendor matrices state support, not function (C-E08-019)', () => {
    // Kubernetes and Helm publish skew policies, but neither says the older version stops working.
    // A doctor that refused a kubectl a few minors behind would report a working setup as outdated.
    for (const taskRef of PRIORITY_TASKS) {
      for (const requirement of requirementsFor(taskRef)) {
        expect(requirement.min, `${taskRef} / ${requirement.cmd}`).toBeUndefined();
      }
    }
  });
});
