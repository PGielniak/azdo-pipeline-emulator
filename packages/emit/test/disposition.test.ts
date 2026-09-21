import { describe, expect, it } from 'vitest';
import type { Step } from '@azdo-emu/engine';
import {
  disposeStep,
  dispositionSummary,
  dispositionWarnings,
  type DispositionOptions,
} from '../src/disposition.js';

const step = (name: string, version: string, extra: Partial<Step> = {}): Step =>
  ({
    id: 1,
    displayName: `${name} step`,
    task: { name, version },
    inputs: {},
    ...extra,
  }) as Step;

describe('native script kinds (E07-S01-T03)', () => {
  it('classifies the three script-backed tasks as native, never real-task', () => {
    // These have real Node handlers. Running the package would re-exec a script the emitter has
    // already written natively — the "no double-exec" the task names.
    expect(disposeStep(step('CmdLine', '2'))).toMatchObject({
      disposition: 'native',
      kind: 'script',
      fidelity: 'exact',
    });
    expect(disposeStep(step('Bash', '3'))).toMatchObject({
      disposition: 'native',
      kind: 'bash',
      fidelity: 'exact',
    });
    expect(disposeStep(step('PowerShell', '2'))).toMatchObject({
      disposition: 'native',
      kind: 'powershell',
      fidelity: 'degraded',
    });
  });

  it('reads pwsh vs powershell from the input, not the reference (C-E04-037)', () => {
    const pwsh = disposeStep(
      step('PowerShell', '2', { inputs: { pwsh: 'true' } } as Partial<Step>),
    );
    expect(pwsh).toMatchObject({ disposition: 'native', kind: 'pwsh', fidelity: 'degraded' });
  });

  it('stays native even when a package is explicitly unavailable', () => {
    // The package is irrelevant: the emitter does not run it either way, so an unavailable
    // download must not turn a verbatim `bash:` step into a stub.
    const options: DispositionOptions = {
      packages: { 'Bash@3': { available: false, unavailableReason: 'offline' } },
    };
    expect(disposeStep(step('Bash', '3'), options)).toMatchObject({
      disposition: 'native',
      fidelity: 'exact',
    });
    expect(disposeStep(step('Bash', '3'), options).warning).toBeUndefined();
  });

  it('classifies checkout natively, matched on origin because it arrives as a bare GUID', () => {
    const checkout = step('6d15af64-176c-496d-b583-fd2ae21d4df4', '1', {
      origin: 'checkout',
    } as Partial<Step>);
    expect(disposeStep(checkout)).toMatchObject({
      disposition: 'native',
      kind: 'checkout',
      fidelity: 'exact',
    });
  });
});

describe('real-task is the default (PLAN D4)', () => {
  it('sends an ordinary task to real-task mode, labelled degraded', () => {
    expect(disposeStep(step('replacetokens', '6'))).toMatchObject({
      disposition: 'real-task',
      fidelity: 'degraded',
      kind: 'replacetokens@6',
    });
  });

  it('stays real-task when nothing is known about the package', () => {
    // At convert time the package may simply not have been fetched yet. Defaulting to `stub` would
    // label a task that will run perfectly well as one that does nothing.
    expect(disposeStep(step('replacetokens', '6'), { packages: {} }).disposition).toBe('real-task');
    expect(
      disposeStep(step('replacetokens', '6'), { packages: { 'other@1': { available: false } } })
        .disposition,
    ).toBe('real-task');
  });

  it('stays real-task when the package is present', () => {
    expect(
      disposeStep(step('replacetokens', '6'), {
        packages: { 'replacetokens@6': { available: true } },
      }).disposition,
    ).toBe('real-task');
  });

  it('uses the origin as the label for a desugared shorthand', () => {
    // Was `real-task` until E11-S04-T03: `download` now joins `checkout` as runtime-performed,
    // because its package has an `AgentPlugin` handler and nothing else to exec (C-E12-040).
    const download = step('30f35852-3f7e-4c0c-9a88-e127b4f97211', '1', {
      origin: 'download',
    } as Partial<Step>);
    expect(disposeStep(download)).toMatchObject({ disposition: 'native', kind: 'download' });
  });
});

describe('publish and download are runtime-performed (C-E12-034/040, E11-S04-T03)', () => {
  it('treats both keyword spellings as native', () => {
    for (const origin of ['publish', 'download'] as const) {
      const guid =
        origin === 'publish'
          ? 'ecdc45f6-832d-4ad9-b52b-ee49e94659be'
          : '30f35852-3f7e-4c0c-9a88-e127b4f97211';
      expect(disposeStep(step(guid, '1', { origin } as Partial<Step>))).toMatchObject({
        disposition: 'native',
        fidelity: 'exact',
        kind: origin,
      });
    }
  });

  it('treats the catalogue references as native too, with no origin to go on', () => {
    // An author who writes `- task: PublishPipelineArtifact@1` by hand gets no `origin`, so the
    // task reference is the only thing to match on — and the Done criterion of E11-S04-T03 names
    // exactly that spelling.
    expect(disposeStep(step('PublishPipelineArtifact', '1'))).toMatchObject({
      disposition: 'native',
      fidelity: 'exact',
      kind: 'publish',
    });
    expect(disposeStep(step('DownloadPipelineArtifact', '2'))).toMatchObject({
      disposition: 'native',
      fidelity: 'exact',
      kind: 'download',
    });
  });

  it('does not claim a different major version of the same task', () => {
    // `DownloadPipelineArtifact@1` is a different task from `@2` (C-E04-034 makes the same point
    // about the keyword GUID), and nothing here has read its handler.
    expect(disposeStep(step('DownloadPipelineArtifact', '1'))).toMatchObject({
      disposition: 'real-task',
    });
  });

  it('stays native even when the package could not be fetched', () => {
    // The fetch is irrelevant: there is no handler to run either way, so degrading to a stub would
    // replace a working implementation with a no-op.
    expect(
      disposeStep(step('PublishPipelineArtifact', '1'), {
        packages: {
          'PublishPipelineArtifact@1': { available: false, unavailableReason: 'offline' },
        },
      }),
    ).toMatchObject({ disposition: 'native' });
  });
});

describe('stub degradation, never silent (PLAN D10)', () => {
  const unavailable: DispositionOptions = {
    packages: {
      'replacetokens@6': { available: false, unavailableReason: 'HTTP 404 from the task endpoint' },
    },
  };

  it('degrades to stub with a warning naming the reason', () => {
    const result = disposeStep(step('replacetokens', '6'), unavailable);
    expect(result).toMatchObject({ disposition: 'stub', fidelity: 'stub' });
    expect(result.warning).toContain('`replacetokens@6` runs as a stub');
    expect(result.warning).toContain('HTTP 404 from the task endpoint');
    // The user needs to know what the step will and will not do.
    expect(result.warning).toContain('inputs are logged');
  });

  it('still warns when no reason was supplied', () => {
    const result = disposeStep(step('replacetokens', '6'), {
      packages: { 'replacetokens@6': { available: false } },
    });
    expect(result.warning).toContain('could not be fetched');
  });

  it('de-duplicates the warning across many steps using the same task', () => {
    // A warnings list nobody reads to the end is the same as no warnings list.
    const steps = [
      step('replacetokens', '6'),
      step('replacetokens', '6'),
      step('Bash', '3'),
      step('replacetokens', '6'),
    ];
    expect(dispositionWarnings(steps, unavailable)).toHaveLength(1);
  });

  it('produces no warnings when nothing degrades', () => {
    expect(dispositionWarnings([step('Bash', '3'), step('replacetokens', '6')])).toEqual([]);
  });
});

describe('dispositionSummary', () => {
  it('counts each disposition — a table, never a percentage (PLAN D10)', () => {
    const steps = [
      step('CmdLine', '2'),
      step('Bash', '3'),
      step('replacetokens', '6'),
      step('SomeOther', '1'),
    ];
    expect(
      dispositionSummary(steps, {
        packages: { 'SomeOther@1': { available: false, unavailableReason: 'offline' } },
      }),
    ).toEqual({ native: 2, 'real-task': 1, stub: 1 });
  });

  it('counts an empty pipeline as all zeroes rather than failing', () => {
    expect(dispositionSummary([])).toEqual({ native: 0, 'real-task': 0, stub: 0 });
  });
});

describe('every classification path is table-driven (the Done criterion)', () => {
  it('covers each execution kind a task can declare', () => {
    const cases: readonly [Step, string, DispositionOptions][] = [
      [step('CmdLine', '2'), 'native', {}],
      [step('Bash', '3'), 'native', {}],
      [step('PowerShell', '2'), 'native', {}],
      [step('guid', '1', { origin: 'checkout' } as Partial<Step>), 'native', {}],
      [step('NodeTask', '1'), 'real-task', {}],
      [
        step('NodeTask', '1'),
        'stub',
        { packages: { 'NodeTask@1': { available: false, unavailableReason: 'offline' } } },
      ],
    ];
    for (const [candidate, expected, options] of cases) {
      expect(disposeStep(candidate, options).disposition).toBe(expected);
    }
  });
});

describe('a task this host cannot run faithfully (E08-S02-T04)', () => {
  const psTask = {
    id: 1,
    displayName: 'copy',
    task: { name: 'AzureFileCopy', version: '6' },
    inputs: {},
  } as never as Step;

  it('a PowerShell3-only handler becomes a stub, with the SDK reason (C-E08-076)', () => {
    // Not "PowerShell does not work here" — pwsh runs fine. The `PowerShell3` contract is that the
    // agent imports `VstsTaskSdk` from the task's own `ps_modules` first; `pwsh -File` imports
    // nothing, so every `Get-VstsInput` is undefined. Measured against the real package: 19
    // `is not recognized` errors before it died, because PowerShell errors do not terminate.
    const result = disposeStep(psTask, {
      packages: {
        'AzureFileCopy@6': { definition: { execution: { PowerShell3: { target: 'x.ps1' } } } },
      },
    });
    expect(result.disposition).toBe('stub');
    expect(result.fidelity).toBe('stub');
    expect(result.warning).toContain('VstsTaskSdk');
  });

  it('a task with both handlers still runs for real — Node wins, as resolveHandler orders it', () => {
    const result = disposeStep(psTask, {
      packages: {
        'AzureFileCopy@6': {
          definition: {
            execution: { PowerShell3: { target: 'x.ps1' }, Node20_1: { target: 'x.js' } },
          },
        },
      },
    });
    expect(result.disposition).toBe('real-task');
  });

  it('an empty or absent execution block is not a PowerShell refusal', () => {
    // Both are "we do not know", not "we cannot run it": a definition fetched without an execution
    // block, and one whose block is empty, must keep the real-task default rather than degrade a
    // task that will run perfectly well (the module's existing rule, unchanged).
    const packages = (execution?: Record<string, unknown>): DispositionOptions => ({
      packages: { 'AzureFileCopy@6': { definition: execution === undefined ? {} : { execution } } },
    });
    expect(disposeStep(psTask, packages()).disposition).toBe('real-task');
    expect(disposeStep(psTask, packages({})).disposition).toBe('real-task');
  });

  it('a Process-only handler is left alone — the refusal is specific to PowerShell3', () => {
    const result = disposeStep(psTask, {
      packages: { 'AzureFileCopy@6': { definition: { execution: { Process: { target: 'x' } } } } },
    });
    expect(result.disposition).toBe('real-task');
  });

  it('says nothing when no package information is available', () => {
    // Unchanged: an unfetched package must not be labelled a stub (the module's existing rule).
    expect(disposeStep(psTask).disposition).toBe('real-task');
  });
});
