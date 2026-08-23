// E03-S06-T01 — detecting `template:` references.
//
// The Done criterion is "unit tests list references across root/stage/job/step levels from a
// fixture", and the first suite does exactly that from one document. The suites after it carry the
// weight, because the ways this detector can be *wrong* are all silent: a missed reference is not
// an error, it is an expansion against the committed repo (the failure E03-S06-T04's criterion
// forbids for `@other`), and a false positive corrupts a bundle that would otherwise be correct.
// So the negatives — the `variables:` mapping shorthand, a task input named `template`, a directive
// keyword in value position — are asserted as explicitly as the positives.
import { describe, expect, it } from 'vitest';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import type { TemplateReference } from '../../src/template/bundle.js';
import { TEMPLATE_CONTAINERS, findTemplateReferences } from '../../src/template/bundle.js';

const find = (yaml: string, file = '/azure-pipelines.yml'): readonly TemplateReference[] =>
  findTemplateReferences(parsePipelineYaml(yaml, file));

const sites = (yaml: string): readonly string[] => find(yaml).map((reference) => reference.site);
const texts = (yaml: string): readonly string[] => find(yaml).map((reference) => reference.text);

describe('findTemplateReferences — the documented positions (C-E03-400)', () => {
  it('lists references at root, stage, job and step level from one fixture', () => {
    const references = find(`
variables:
- template: vars/global.yml
stages:
- template: stages/whole-stage.yml
- stage: Build
  variables:
  - template: vars/stage.yml
  jobs:
  - template: jobs/whole-job.yml
  - job: Compile
    steps:
    - script: echo before
    - template: steps/npm.yml
    - script: echo after
`);

    expect(
      references.map((reference) => ({ site: reference.site, text: reference.text })),
    ).toStrictEqual([
      { site: 'variables', text: 'vars/global.yml' },
      { site: 'stages', text: 'stages/whole-stage.yml' },
      { site: 'variables', text: 'vars/stage.yml' },
      { site: 'jobs', text: 'jobs/whole-job.yml' },
      { site: 'steps', text: 'steps/npm.yml' },
    ]);
  });

  it('finds `extends.template`, a mapping property rather than a sequence item (C-E03-406)', () => {
    const [reference, ...rest] = find(`
extends:
  template: templates/base.yml
`);
    expect(rest).toStrictEqual([]);
    expect(reference?.site).toBe('extends');
    expect(reference?.text).toBe('templates/base.yml');
  });

  it('finds a `phases:` reference, which the doc page does not mention (C-E03-405)', () => {
    expect(sites('phases:\n- template: phases/legacy.yml\n')).toStrictEqual(['phases']);
  });

  it('covers every container in TEMPLATE_CONTAINERS', () => {
    for (const container of TEMPLATE_CONTAINERS) {
      expect(sites(`${container}:\n- template: t.yml\n`)).toStrictEqual([container]);
    }
  });

  it('reports the position of the reference scalar, not of its mapping', () => {
    const [reference] = find('steps:\n- template: steps/npm.yml\n');
    // Line 2, and the column is where `steps/npm.yml` starts — after `- template: `.
    expect(reference?.range.line).toBe(2);
    expect(reference?.range.col).toBe(13);
    expect(reference?.file).toBe('/azure-pipelines.yml');
  });
});

describe('findTemplateReferences — nesting the container-key rule handles (C-E03-401/405)', () => {
  it('finds steps inside a deployment strategy, which is not a documented container path', () => {
    expect(
      texts(`
jobs:
- deployment: Deploy
  environment: prod
  strategy:
    runOnce:
      deploy:
        steps:
        - template: steps/deploy.yml
`),
    ).toStrictEqual(['steps/deploy.yml']);
  });

  it('finds a reference that a template reference item is a sibling of', () => {
    expect(
      texts(`
stages:
- template: stages/a.yml
- stage: B
  jobs:
  - job: C
    steps:
    - template: steps/d.yml
`),
    ).toStrictEqual(['stages/a.yml', 'steps/d.yml']);
  });
});

describe('findTemplateReferences — directive enclosure', () => {
  it('unwraps a directive-keyed sequence item into the same container', () => {
    const [reference] = find(`
steps:
- \${{ if eq(parameters.run, true) }}:
  - template: steps/maybe.yml
`);
    expect(reference?.site).toBe('steps');
    expect(reference?.text).toBe('steps/maybe.yml');
    expect(reference?.directives).toStrictEqual(['${{ if eq(parameters.run, true) }}']);
  });

  it('records nested directives outermost first', () => {
    const [reference] = find(`
steps:
- \${{ each env in parameters.envs }}:
  - \${{ if eq(env.enabled, true) }}:
    - template: steps/per-env.yml
`);
    expect(reference?.directives).toStrictEqual([
      '${{ each env in parameters.envs }}',
      '${{ if eq(env.enabled, true) }}',
    ]);
  });

  it('leaves `directives` empty for an unconditional reference', () => {
    expect(find('steps:\n- template: steps/always.yml\n')[0]?.directives).toStrictEqual([]);
  });
});

describe('findTemplateReferences — references inside parameter values', () => {
  it('reports a template inside a stepList parameter with site `parameters`', () => {
    const references = find(`
extends:
  template: templates/base.yml
  parameters:
    buildSteps:
    - script: echo hello
    - template: steps/extra.yml
`);
    expect(references.map((reference) => [reference.site, reference.text])).toStrictEqual([
      ['extends', 'templates/base.yml'],
      ['parameters', 'steps/extra.yml'],
    ]);
  });

  it('reports one inside a sequence-item reference’s parameters too', () => {
    const references = find(`
jobs:
- template: jobs/matrix.yml
  parameters:
    extraSteps:
    - template: steps/extra.yml
`);
    expect(references.map((reference) => reference.site)).toStrictEqual(['jobs', 'parameters']);
  });

  it('does not treat a parameter merely *named* `template` as a reference', () => {
    expect(
      find(`
jobs:
- template: jobs/matrix.yml
  parameters:
    template: not-a-reference
`),
    ).toHaveLength(1);
  });
});

describe('findTemplateReferences — the reference text (C-E03-402, C-E03-210/212/213)', () => {
  it.each([
    ['steps/npm.yml', 'steps/npm.yml', undefined, true],
    ['/root/abs.yml', '/root/abs.yml', undefined, true],
    ['a.yml@self', 'a.yml', 'self', true],
    ['a.yml@SELF', 'a.yml', 'SELF', true],
    ['a.yml@', 'a.yml', '', true],
    ['common.yml@templates', 'common.yml', 'templates', false],
  ])('splits %s and answers `self` correctly', (text, path, alias, self) => {
    const [reference] = find(`steps:\n- template: ${text}\n`);
    expect(reference?.path).toBe(path);
    expect(reference?.alias).toBe(alias);
    expect(reference?.self).toBe(self);
  });

  it('captures the sibling `parameters:` mapping and omits it when absent', () => {
    const withParameters = find(`
jobs:
- template: jobs/a.yml
  parameters:
    name: Linux
`)[0];
    expect(withParameters?.parameters?.kind).toBe('mapping');
    expect(find('jobs:\n- template: jobs/a.yml\n')[0]?.parameters).toBeUndefined();
  });
});

describe('findTemplateReferences — the silent-corruption negatives', () => {
  it('ignores the `variables:` mapping shorthand, where `template` is a variable name', () => {
    // `variables` is `{object | sequence}` in the schema; only the sequence form takes a reference,
    // and the mapping shorthand is the common spelling — a false positive here would inline a file
    // for a variable that merely happens to be called `template`.
    expect(find('variables:\n  template: my-value\n')).toStrictEqual([]);
  });

  it('ignores a task input named `template`', () => {
    expect(
      find(`
steps:
- task: SomeTask@1
  inputs:
    template: templates/not-a-pipeline-template.yml
`),
    ).toStrictEqual([]);
  });

  it('ignores a `template` key whose value is not a scalar', () => {
    expect(find('steps:\n- template:\n  - nested\n')).toStrictEqual([]);
  });

  it('ignores a directive keyword in value position (C-E03-112)', () => {
    expect(find("steps:\n- script: echo '${{ if true }}'\n")).toStrictEqual([]);
  });

  it('returns nothing for an empty document', () => {
    expect(find('')).toStrictEqual([]);
    expect(find('# just a comment\n')).toStrictEqual([]);
  });

  it('returns nothing for a document whose root is a sequence', () => {
    expect(find('- template: t.yml\n')).toStrictEqual([]);
  });
});
