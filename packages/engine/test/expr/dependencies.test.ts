import { describe, expect, it } from 'vitest';
import { dependenciesContext, stageDependenciesContext } from '../../src/expr/dependencies.js';
import { accessProperty } from '../../src/expr/access.js';

// The test deliberately inspects the tagged fixture shape; production code remains strict.
/* eslint-disable @typescript-eslint/no-explicit-any */

describe('dependency contexts [C-E02-092..095]', () => {
  const records = {
    Build: { result: 'Succeeded', outputs: { 'setAnswer.answer': '42' } },
  } as const;

  it('exposes result and flattened step.variable outputs', () => {
    const value = dependenciesContext(records);
    const build = (value as any).value.Build;
    expect(build.value.result).toEqual({ kind: 'string', value: 'Succeeded' });
    expect(build.value.outputs.value['setAnswer.answer']).toEqual({ kind: 'string', value: '42' });
  });

  it('uses case-insensitive job and stage names, with null-propagating misses', () => {
    const value = stageDependenciesContext({ Produce: records });
    const stage = accessProperty(value, 'produce');
    const job = accessProperty(stage, 'build');
    expect((job as any).value.result.value).toBe('Succeeded');
    expect(accessProperty(stage, 'unknown')).toEqual({ kind: 'null' });
  });

  it('supports an empty dependencies collection', () => {
    expect(dependenciesContext({}).value).toEqual({});
  });
});
