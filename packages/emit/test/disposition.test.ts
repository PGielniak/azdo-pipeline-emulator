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

  it('uses the origin as the label for a desugared non-native shorthand', () => {
    const download = step('a0f6b0dd-1234-4f0d-bd5e-000000000000', '1', {
      origin: 'download',
    } as Partial<Step>);
    expect(disposeStep(download)).toMatchObject({ disposition: 'real-task', kind: 'download' });
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
