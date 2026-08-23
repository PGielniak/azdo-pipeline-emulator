// E04-S02-T02 — variable classification.
//
// The Done field asks for "classification snapshots on corpus; unknown-predefined warning path
// tested". Both are here: a snapshot over the captured expansions in `research/experiments/`, which
// is the only corpus this repo has, and the warning path in both directions — fired for an
// unaccounted `Build.*` name, and *not* fired once the table is injected.
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import {
  UNKNOWN_PREDEFINED,
  classifyVariables,
  collectReferences,
  collectSetVariableWriters,
  macroNames,
} from '../../src/model/classify.js';
import { buildPipeline } from '../../src/model/build.js';
import type { Pipeline } from '../../src/model/types.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const build = (yaml: string): Pipeline => {
  const result = buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
  if (result.pipeline === undefined) throw new Error('no pipeline built');
  return result.pipeline;
};

const classOf = (pipeline: Pipeline, name: string, predefined?: string[]) =>
  classifyVariables(pipeline, predefined ? { predefined } : {}).variables.get(name.toLowerCase())
    ?.classification;

describe('the macro scanner mirrors the runtime’s (C-E04-087)', () => {
  it.each([
    ['echo $(a)', ['a']],
    ['$(a)$(b)', ['a', 'b']],
    ['no macros here', []],
    ['$()', []],
    // Non-greedy: the runtime takes up to the FIRST `)`, so this is one candidate `a`.
    ['$(a) and )', ['a']],
  ])('reads %j as %j', (value, expected) => {
    expect(macroNames(value)).toStrictEqual(expected);
  });

  it('discards a nested candidate, which the runtime never resolves as a name (C-E06-024)', () => {
    // `$(a$(b))`: the outer candidate is `a$(b`, and the runtime expands the inner macro first.
    expect(macroNames('$(a$(b))')).toStrictEqual(['b']);
  });

  it('trims surrounding whitespace inside the delimiters', () => {
    expect(macroNames('$( spaced )')).toStrictEqual(['spaced']);
  });
});

describe('macro positions are inputs and env, and nothing else (C-E04-088)', () => {
  const pipeline = build(`steps:
- task: A@1
  displayName: not a macro position $(ignored)
  env:
    E: $(fromEnv)
  inputs:
    script: echo $(fromInput)
`);

  it('finds references in inputs and env', () => {
    expect(collectReferences(pipeline).map((r) => [r.name, r.via])).toStrictEqual([
      ['fromInput', 'input'],
      ['fromEnv', 'env'],
    ]);
  });

  it('does not treat a displayName as a macro position', () => {
    expect(collectReferences(pipeline).some((r) => r.name === 'ignored')).toBe(false);
  });

  it('records the stage, job and step of each reference', () => {
    const [reference] = collectReferences(pipeline);
    expect(reference?.stageId).toBe('__default');
    expect(reference?.jobId).toBe('Job');
    expect(reference?.stepId).toBe(1);
  });
});

describe('the five classes', () => {
  it('inline: declared in a reachable scope', () => {
    const pipeline = build(
      'variables:\n- name: a\n  value: one\nsteps:\n- task: A@1\n  inputs:\n    s: $(a)\n',
    );
    expect(classOf(pipeline, 'a')).toBe('inline');
  });

  it('predefined: present in the injected table (C-E04-092)', () => {
    const pipeline = build('steps:\n- task: A@1\n  inputs:\n    s: $(Build.SourceBranch)\n');
    expect(classOf(pipeline, 'build.sourcebranch', ['Build.SourceBranch'])).toBe('predefined');
  });

  it('setvariable-produced: written by an earlier step’s script (C-E04-091)', () => {
    const pipeline = build(`steps:
- task: A@1
  inputs:
    script: echo "##vso[task.setvariable variable=made]v"
- task: B@1
  inputs:
    s: $(made)
`);
    expect(classOf(pipeline, 'made')).toBe('setvariable-produced');
    expect(classifyVariables(pipeline).variables.get('made')?.producedByStep).toBe(1);
  });

  it('group-member: unaccounted for, but a group is declared (C-E04-090)', () => {
    const pipeline = build(
      'variables:\n- group: shared\nsteps:\n- task: A@1\n  inputs:\n    s: $(maybe)\n',
    );
    const entry = classifyVariables(pipeline).variables.get('maybe');
    expect(entry?.classification).toBe('group-member');
    expect(entry?.groups).toStrictEqual(['shared']);
  });

  it('env-required: unaccounted for with no group declared (C-E04-089)', () => {
    const pipeline = build('steps:\n- task: A@1\n  inputs:\n    s: $(mystery)\n');
    expect(classOf(pipeline, 'mystery')).toBe('env-required');
  });
});

describe('classification respects scope (C-E04-083)', () => {
  it('a name declared only in a sibling job is not inline for this one', () => {
    const pipeline = build(`stages:
- stage: one
  jobs:
  - job: A
    variables:
    - name: onlyA
      value: a
    steps: []
  - job: B
    steps:
    - task: T@1
      inputs:
        s: $(onlyA)
`);
    expect(classOf(pipeline, 'onlyA')).toBe('env-required');
  });

  it('a stage-level declaration is inline for a job inside it', () => {
    const pipeline = build(`stages:
- stage: one
  variables:
  - name: v
    value: x
  jobs:
  - job: A
    steps:
    - task: T@1
      inputs:
        s: $(v)
`);
    expect(classOf(pipeline, 'v')).toBe('inline');
  });
});

describe('folding and reference collection', () => {
  it('folds case, so two spellings are one entry (C-E06-003)', () => {
    const pipeline = build(`steps:
- task: A@1
  inputs:
    a: $(MyVar)
    b: $(MYVAR)
`);
    const classification = classifyVariables(pipeline);
    expect(classification.variables.size).toBe(1);
    expect(classification.variables.get('myvar')?.references).toHaveLength(2);
  });

  it('keeps every reference site, in document order', () => {
    const pipeline = build(`steps:
- task: A@1
  inputs:
    s: $(x)
- task: B@1
  inputs:
    s: $(x)
`);
    expect(
      classifyVariables(pipeline)
        .variables.get('x')
        ?.references.map((r) => r.stepId),
    ).toStrictEqual([1, 2]);
  });

  it('records the first writer when two steps set the same name', () => {
    const pipeline = build(`steps:
- task: A@1
  inputs:
    script: echo "##vso[task.setvariable variable=v]one"
- task: B@1
  inputs:
    script: echo "##vso[task.setvariable variable=v]two"
`);
    expect(collectSetVariableWriters(pipeline).get('v')).toBe(1);
  });

  it('reads the setvariable command case-insensitively and with extra properties', () => {
    const pipeline = build(`steps:
- task: A@1
  inputs:
    script: 'echo "##VSO[TASK.SETVARIABLE variable=Out;isOutput=true]x"'
- task: B@1
  inputs:
    s: $(Out)
`);
    expect(classOf(pipeline, 'out')).toBe('setvariable-produced');
  });
});

describe('the unknown-predefined warning path (the Done criterion)', () => {
  it('fires for a service-namespaced name with no table injected', () => {
    const pipeline = build('steps:\n- task: A@1\n  inputs:\n    s: $(Build.BuildId)\n');
    const { warnings } = classifyVariables(pipeline);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe(UNKNOWN_PREDEFINED);
    expect(warnings[0]?.name).toBe('Build.BuildId');
    expect(warnings[0]?.message).toContain('namespace the service owns');
  });

  it('does not fire once the name is in the injected table', () => {
    const pipeline = build('steps:\n- task: A@1\n  inputs:\n    s: $(Build.BuildId)\n');
    expect(classifyVariables(pipeline, { predefined: ['Build.BuildId'] }).warnings).toStrictEqual(
      [],
    );
  });

  it('does not fire for an ordinary name outside those namespaces', () => {
    const pipeline = build('steps:\n- task: A@1\n  inputs:\n    s: $(myThing)\n');
    expect(classifyVariables(pipeline).warnings).toStrictEqual([]);
  });

  it('fires even when the name lands in group-member, which is the case it exists for', () => {
    const pipeline = build(
      'variables:\n- group: g\nsteps:\n- task: A@1\n  inputs:\n    s: $(System.Debug)\n',
    );
    const { variables, warnings } = classifyVariables(pipeline);
    expect(variables.get('system.debug')?.classification).toBe('group-member');
    expect(warnings[0]?.code).toBe(UNKNOWN_PREDEFINED);
  });

  it.each(['Build.x', 'System.x', 'Agent.x', 'Pipeline.x', 'Environment.x', 'Release.x'])(
    'covers the %s namespace',
    (name) => {
      const pipeline = build(`steps:\n- task: A@1\n  inputs:\n    s: $(${name})\n`);
      expect(classifyVariables(pipeline).warnings).toHaveLength(1);
    },
  );
});

describe('corpus snapshot (the Done criterion)', () => {
  it('classifies every captured expansion without throwing, and summarises the result', () => {
    const files = globSync('research/experiments/*/*/final.yml', { cwd: repoRoot }).sort();
    expect(files.length).toBeGreaterThan(100);

    const totals: Record<string, number> = {};
    let documents = 0;
    for (const relative of files) {
      const parsed = parsePipelineYaml(readFileSync(join(repoRoot, relative), 'utf8'), relative);
      const pipeline = buildPipeline(parsed).pipeline;
      if (pipeline === undefined) continue;
      documents += 1;
      for (const entry of classifyVariables(pipeline).variables.values()) {
        totals[entry.classification] = (totals[entry.classification] ?? 0) + 1;
      }
    }

    expect(documents).toBeGreaterThan(100);
    // The shape of the corpus, not a golden of it: these documents are probe fixtures, so almost
    // every reference is a bare name the probe never declared. Asserting the *distribution* keeps
    // the test meaningful without pinning it to a corpus that grows with every oracle task.
    expect(Object.keys(totals).sort()).toStrictEqual(['env-required', 'inline']);
    expect(totals['env-required']).toBeGreaterThan(0);
  });
});
