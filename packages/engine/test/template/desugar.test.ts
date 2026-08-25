// E03-S04-T04 — the normalization-time expansions the offline arm was missing.
//
// The Done criterion is a parity statement: for every corpus entry that needs no cross-file
// template, our offline expansion must be **normalizer-equal** to the service's `final.yml`. That
// is the test that matters, because it compares against the authority rather than against a golden
// we wrote, and it is the first section below.
//
// Four of the five template-free entries reach it. The fifth, `04-variable-layers`, does not, and
// the reason is not a bug here: it reads `${{ variables.solution }}` at a job where the value is
// overridden, and *which layer a compile-time variable read sees* is E03-S03-T01's question —
// **deliberately demoted** (E12-S01-T02, docs/07 §6) because the service decides it. Implementing
// a guess would be exactly what BACKLOG rule 1 forbids, so the entry is asserted to differ *in that
// one way* rather than quietly excluded: if someone later teaches the expander compile-time
// variables, this test tells them to re-check the parity list rather than silently passing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { normalizeExpandedYaml } from '../../src/normalize/normalize.js';
import { parsePipelineYaml, type PipelineNode } from '../../src/frontend/parse.js';
import { SHORTHANDS, desugarExpansion } from '../../src/template/desugar.js';
import { expandDocument, serializeExpandedYaml } from '../../src/template/expand.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const authored = (name: string): string =>
  readFileSync(join(repoRoot, 'fixtures', 'corpus', name, 'pipeline.yml'), 'utf8');
const expansion = (name: string): string =>
  readFileSync(join(repoRoot, 'fixtures', 'oracle', `${name}.final.yml`), 'utf8');

/** The corpus entries that reference no other file — the ones a single-document expander can do. */
const TEMPLATE_FREE = [
  '01-matrix-multi-config',
  '02-artifact-handoff',
  '03-dependencies-and-conditions',
  '10-monorepo-triggers-pools',
] as const;

/** Desugar a snippet and return it as text — the shape the corpus goldens are compared in. */
const rewrite = (source: string): string => {
  const parsed = parsePipelineYaml(source, 'p.yml');
  expect(parsed.errors).toEqual([]);
  return serializeExpandedYaml(desugarExpansion(parsed.root));
};

describe('parity with the service, on every template-free corpus entry', () => {
  it.each(TEMPLATE_FREE)('%s expands to the same document the service produced', (name) => {
    const ours = expandDocument(authored(name), 'pipeline.yml');
    expect(ours.diagnostics).toEqual([]);
    expect(normalizeExpandedYaml(ours.yaml).text).toBe(normalizeExpandedYaml(expansion(name)).text);
  });

  it('04-variable-layers differs only by the demoted compile-time variable read', () => {
    // Not excluded — asserted. The only divergence is the `${{ variables.solution }}` reads, which
    // resolve to the empty string here because the offline expander binds no `variables` context.
    // E03-S03-T01 (the visibility matrix) is `[~]` demoted: the service decides which layer such a
    // read sees, and guessing is what rule 1 forbids.
    const ours = normalizeExpandedYaml(
      expandDocument(authored('04-variable-layers'), 'pipeline.yml').yaml,
    ).text.split('\n');
    const theirs = normalizeExpandedYaml(expansion('04-variable-layers')).text.split('\n');
    expect(ours).toHaveLength(theirs.length);
    const differing = ours
      .map((line, i) => [line, theirs[i]!] as const)
      .filter(([a, b]) => a !== b);
    expect(differing.length).toBeGreaterThan(0);
    for (const [a, b] of differing) {
      expect(a).toContain('compile-time=');
      expect(b).toContain('compile-time=');
    }
  });
});

describe('implicit structure (C-E00-022, C-E03-259)', () => {
  it('wraps a `steps:` document in `__default` / `Job`, moving `pool` into the job', () => {
    // The five-line probe, byte for byte: this is the document C-E00-022 was measured on.
    expect(
      rewrite('trigger: none\npool:\n  vmImage: ubuntu-latest\nsteps:\n  - script: echo hello\n'),
    ).toBe(
      'trigger:\n  enabled: false\nstages:\n- stage: __default\n  jobs:\n  - job: Job\n' +
        '    pool:\n      vmImage: ubuntu-latest\n    steps:\n    - task: CmdLine@2\n' +
        '      inputs:\n        script: echo hello\n\n',
    );
  });

  it('wraps a `jobs:` document in `__default` alone, leaving `pool` at the root', () => {
    // The asymmetry with the case above is measured, not inferred — corpus `01` is a `jobs:` root
    // whose `pool` stays where it was authored.
    const yaml = rewrite('pool:\n  vmImage: ubuntu-latest\njobs:\n- job: a\n  steps: []\n');
    expect(yaml).toBe(
      'pool:\n  vmImage: ubuntu-latest\nstages:\n- stage: __default\n  jobs:\n  - job: a\n' +
        '    steps: []\n\n',
    );
  });

  it('puts `stages:` where the key it replaced stood, keeping the service key order', () => {
    const yaml = rewrite('trigger: none\njobs:\n- job: a\n  steps: []\nvariables:\n  x: 1\n');
    expect(yaml.split('\n').filter((line) => /^[a-z]/.test(line))).toEqual([
      'trigger:',
      'stages:',
      'variables:',
    ]);
  });

  it('leaves a document that already has `stages:` alone', () => {
    const source = 'stages:\n- stage: a\n  jobs: []\n';
    expect(rewrite(source)).toBe(`${source}\n`);
  });

  it('leaves a document with neither `steps:` nor `jobs:` alone', () => {
    expect(rewrite('variables:\n  x: 1\n')).toBe('variables:\n  x: 1\n\n');
  });
});

describe('`trigger:`/`pr:` none (C-E03-002)', () => {
  it('expands the scalar to the output-only mapping, for both keys', () => {
    expect(rewrite('trigger: none\npr: none\nstages: []\n')).toBe(
      'trigger:\n  enabled: false\npr:\n  enabled: false\nstages: []\n\n',
    );
  });

  it('leaves a real trigger untouched', () => {
    const source = 'trigger:\n  branches:\n    include:\n    - main\nstages: []\n';
    expect(rewrite(source)).toBe(`${source}\n`);
  });
});

describe('step shorthands (C-E04-030/032)', () => {
  it.each([
    ['script: echo hello', 'CmdLine@2', 'script: echo hello'],
    ['bash: echo hello', 'Bash@3', 'targetType: inline'],
    ['powershell: Write-Host hi', 'PowerShell@2', 'targetType: inline'],
    ['checkout: self', '6d15af64-176c-496d-b583-fd2ae21d4df4@1', 'repository: self'],
  ])('%s becomes %s', (step, task, input) => {
    const yaml = rewrite(`steps:\n- ${step}\n`);
    expect(yaml).toContain(`- task: ${task}`);
    expect(yaml).toContain(input);
  });

  it('distinguishes `pwsh` from `powershell` by the `pwsh: true` input (C-E04-037)', () => {
    expect(rewrite('steps:\n- pwsh: Write-Host hi\n')).toContain('pwsh: true');
    expect(rewrite('steps:\n- powershell: Write-Host hi\n')).not.toContain('pwsh: true');
  });

  it("renames `publish`'s artifact input and keeps `download`'s (C-E04-032)", () => {
    expect(rewrite('steps:\n- publish: out\n  artifact: drop\n')).toContain('artifactName: drop');
    expect(rewrite('steps:\n- download: current\n  artifact: app\n')).toContain('artifact: app');
    expect(rewrite('steps:\n- download: current\n')).toContain('alias: current');
  });

  it('keeps the common step properties and moves everything else into `inputs:`', () => {
    const yaml = rewrite(
      'steps:\n- script: echo hi\n  displayName: Say hi\n  name: greet\n' +
        '  condition: succeeded()\n  workingDirectory: sub\n  env:\n    A: b\n',
    );
    // `workingDirectory` is an input, not a step property (C-E04-061); `env` is a property.
    expect(yaml).toMatch(/inputs:\n\s+script: echo hi\n\s+workingDirectory: sub/);
    expect(yaml).toMatch(/displayName: Say hi/);
    expect(yaml).toMatch(/env:\n\s+A: b/);
  });

  it('emits `task:` first, properties next, `inputs:` last', () => {
    const keys = rewrite('steps:\n- script: echo hi\n  displayName: D\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(- task|displayName|inputs):/.test(line));
    expect(keys).toEqual(['- task: CmdLine@2', 'displayName: D', 'inputs:']);
  });

  it('gives `checkout: none` its synthesized `condition: false` (C-E03-260)', () => {
    const yaml = rewrite('steps:\n- checkout: none\n');
    expect(yaml).toContain('condition: false');
    expect(yaml).toContain('repository: none');
    // Only for `none` — a real repository gets no condition.
    expect(rewrite('steps:\n- checkout: self\n')).not.toContain('condition:');
  });

  it('leaves an explicit `task:` step untouched', () => {
    // Wrapped, because the root is `steps:` — but the step itself is byte-identical.
    const yaml = rewrite('steps:\n- task: CmdLine@2\n  inputs:\n    script: echo hi\n');
    expect(yaml).toContain('    - task: CmdLine@2\n      inputs:\n        script: echo hi');
  });

  it('rewrites steps at any depth, including inside a deployment strategy', () => {
    const yaml = rewrite(
      'jobs:\n- deployment: d\n  environment: prod\n  strategy:\n    runOnce:\n' +
        '      deploy:\n        steps:\n        - script: echo deploy\n',
    );
    expect(yaml).toContain('- task: CmdLine@2');
  });

  it('covers every shorthand in the table', () => {
    for (const keyword of Object.keys(SHORTHANDS))
      expect(rewrite(`steps:\n- ${keyword}: value\n`)).toContain('- task: ');
  });
});

describe('provenance survives desugaring', () => {
  it('a desugared step points at the shorthand the author wrote', () => {
    const source = 'steps:\n- script: echo one\n- script: echo two\n';
    const result = expandDocument(source, 'pipeline.yml');
    const steps = result.map.entries.filter((e) =>
      /^\/stages\/0\/jobs\/0\/steps\/\d+$/.test(e.path),
    );
    expect(steps).toHaveLength(2);
    expect(steps.map((e) => e.from.line)).toEqual([2, 3]);
  });

  it('every emitted node still has a map entry after the rewrites', () => {
    const result = expandDocument('trigger: none\nsteps:\n- checkout: none\n', 'pipeline.yml');
    const count = (node: PipelineNode | undefined): number => {
      if (node === undefined) return 0;
      if (node.kind === 'scalar') return 1;
      if (node.kind === 'sequence') return 1 + node.items.reduce((n, i) => n + count(i), 0);
      return 1 + node.entries.reduce((n, e) => n + count(e.value), 0);
    };
    const reparsed = parsePipelineYaml(result.yaml, 'expanded.yml');
    expect(result.map.entries).toHaveLength(count(reparsed.root));
  });
});

describe('desugarExpansion edge cases', () => {
  it('passes an undefined document through', () => {
    expect(desugarExpansion(undefined)).toBeUndefined();
  });

  it('handles a non-mapping root', () => {
    const parsed = parsePipelineYaml('- a\n- b\n', 'p.yml');
    expect(serializeExpandedYaml(desugarExpansion(parsed.root))).toBe('- a\n- b\n\n');
  });

  it('leaves a `steps:` value that is not a sequence alone', () => {
    expect(rewrite('stages:\n- stage: a\n  steps: nope\n')).toContain('steps: nope');
  });

  it('leaves an empty step mapping alone', () => {
    expect(rewrite('steps:\n- {}\n')).toContain('- {}');
  });
});
