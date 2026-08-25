// E03-S06-T02 — the recursive local inliner.
//
// The first suite is the Done criterion: a two-file pipeline with a nested template bundles with no
// references left. The rest guard the boundary the oracle measured (C-E03-408..413) — the shapes
// that must **not** be inlined, because splicing them is either rejected by the service or, worse,
// silently expands the wrong value.
//
// The `bundles as the oracle measured it` case is the one that closes the loop: it feeds the
// inliner the same fixture tree `scripts/bundle-survey.ts` pushed to the test organization and
// asserts the override it produces equals the `*-inlined` probe the service returned 200 for. The
// probe bytes were hand-written in the survey, so this is a real comparison rather than a
// restatement.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  INLINE_CROSS_REPO,
  INLINE_CYCLE,
  INLINE_MISSING_FILE,
  INLINE_UNSUPPORTED_SITE,
  INLINE_USES_PARAMETERS,
  inlineTemplates,
  treeReader,
} from '../../src/template/inline.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = (relative: string): string =>
  readFileSync(join(repoRoot, 'fixtures/oracle/bundle/repos/self', relative), 'utf8');
const probe = (name: string, file: string): string =>
  readFileSync(join(repoRoot, 'research/experiments/E03-bundle', name, file), 'utf8');

const bundle = (source: string, files: Record<string, string>) =>
  inlineTemplates(source, { read: treeReader(files) });

describe('inlineTemplates — the Done criterion', () => {
  it('bundles a two-file pipeline with a nested template, leaving no reference behind', () => {
    const result = bundle(
      `steps:
- script: echo root-before
- template: /t/mid.yml
- script: echo root-after
`,
      {
        '/t/mid.yml': 'steps:\n- script: echo mid-before\n- template: /t/leaf.yml\n',
        '/t/leaf.yml': 'steps:\n- script: echo leaf\n',
      },
    );

    expect(result.yaml).toBe(
      `steps:
- script: echo root-before
- script: echo mid-before
- script: echo leaf
- script: echo root-after
`,
    );
    expect(result.yaml).not.toContain('template:');
    expect(result.diagnostics).toStrictEqual([]);
    expect(result.inlined.map((entry) => entry.path)).toStrictEqual(['/t/leaf.yml', '/t/mid.yml']);
  });

  it('resolves a bare relative path against the referencing file, not the root (C-E12-012)', () => {
    // `mid.yml` lives in `/deep/`, so its bare `leaf.yml` is `/deep/leaf.yml` — the same reference
    // written in the root override would mean `/leaf.yml`.
    const result = bundle('steps:\n- template: /deep/mid.yml\n', {
      '/deep/mid.yml': 'steps:\n- template: leaf.yml\n',
      '/deep/leaf.yml': 'steps:\n- script: echo deep-leaf\n',
      '/leaf.yml': 'steps:\n- script: echo WRONG\n',
    });
    expect(result.yaml).toBe('steps:\n- script: echo deep-leaf\n');
  });

  it('re-indents spliced items to the reference’s own column', () => {
    const result = bundle(
      `jobs:
- job: Build
  steps:
  - script: echo before
  - template: /t/leaf.yml
`,
      { '/t/leaf.yml': 'steps:\n- script: echo one\n- script: echo two\n' },
    );
    expect(result.yaml).toBe(
      `jobs:
- job: Build
  steps:
  - script: echo before
  - script: echo one
  - script: echo two
`,
    );
  });

  it('splices a multi-line item without disturbing bytes around it', () => {
    const result = bundle(
      `steps:
- template: /t/leaf.yml
# a trailing comment survives
`,
      {
        '/t/leaf.yml': 'steps:\n- script: |\n    line one\n    line two\n  displayName: block\n',
      },
    );
    expect(result.yaml).toBe(
      `steps:
- script: |
    line one
    line two
  displayName: block
# a trailing comment survives
`,
    );
  });

  it('inlines several references in one document', () => {
    const result = bundle('steps:\n- template: /a.yml\n- template: /b.yml\n', {
      '/a.yml': 'steps:\n- script: echo a\n',
      '/b.yml': 'steps:\n- script: echo b\n',
    });
    expect(result.yaml).toBe('steps:\n- script: echo a\n- script: echo b\n');
  });
});

describe('inlineTemplates — parity with the oracle probes (C-E03-408..410)', () => {
  it.each([
    ['plain', 'plain/leaf.yml'],
    ['nested', 'nested/mid.yml'],
    ['declared-unused', 'declared-unused/leaf.yml'],
  ])('produces the %s override the service expanded identically', (shape) => {
    const files: Record<string, string> = {
      '/e03-bundle/plain/leaf.yml': fixture('e03-bundle/plain/leaf.yml'),
      '/e03-bundle/nested/mid.yml': fixture('e03-bundle/nested/mid.yml'),
      '/e03-bundle/nested/leaf.yml': fixture('e03-bundle/nested/leaf.yml'),
      '/e03-bundle/declared-unused/leaf.yml': fixture('e03-bundle/declared-unused/leaf.yml'),
    };
    const result = bundle(probe(`${shape}-committed`, 'probe.yml'), files);
    expect(result.yaml).toBe(probe(`${shape}-inlined`, 'probe.yml'));
    expect(result.diagnostics).toStrictEqual([]);
  });
});

describe('inlineTemplates — the shapes it must refuse (C-E03-411/412/413)', () => {
  it('refuses a template that reads its own parameters, and says why', () => {
    const source = 'steps:\n- template: /t/param.yml\n';
    const result = bundle(source, {
      '/t/param.yml':
        'parameters:\n- name: greeting\n  default: hi\nsteps:\n- script: echo ${{ parameters.greeting }}\n',
    });
    expect(result.yaml).toBe(source);
    expect(result.inlined).toStrictEqual([]);
    expect(result.skipped[0]?.reason).toBe('uses-parameters');
    expect(result.diagnostics[0]?.code).toBe(INLINE_USES_PARAMETERS);
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(result.diagnostics[0]?.message).toBe(
      '`/t/param.yml` reads `${{ parameters.* }}`, so it cannot be mechanically inlined without losing its template scope. The default service-backed expansion will read the committed file, so working-tree edits are invisible.',
    );
    expect(result.diagnostics[0]?.hint).toBe(
      'Commit the template first, or explicitly use `--offline-expand` (degraded fallback). azdo-emu does not switch expansion authority automatically because the local fallback can differ from the service.',
    );
    expect(result.manifestWarnings).toStrictEqual([
      {
        code: INLINE_USES_PARAMETERS,
        location: { file: '/azure-pipelines.yml', line: 2 },
        message:
          '`/t/param.yml` reads `${{ parameters.* }}`, so it cannot be mechanically inlined without losing its template scope. The default service-backed expansion will read the committed file, so working-tree edits are invisible. Commit the template first, or explicitly use `--offline-expand` (degraded fallback). azdo-emu does not switch expansion authority automatically because the local fallback can differ from the service.',
      },
    ]);
  });

  it('inlines a template that declares parameters but never reads one (C-E03-410)', () => {
    const result = bundle('steps:\n- template: /t/unused.yml\n', {
      '/t/unused.yml':
        'parameters:\n- name: greeting\n  default: hi\nsteps:\n- script: echo constant\n',
    });
    expect(result.yaml).toBe('steps:\n- script: echo constant\n');
    expect(result.diagnostics).toStrictEqual([]);
  });

  it.each([
    'steps:\n- script: echo ${{ parameters.greeting }}\n',
    "steps:\n- script: echo ${{ parameters['greeting'] }}\n",
    'steps:\n- script: echo ${{ PARAMETERS.greeting }}\n',
    'steps:\n- ${{ if eq(parameters.run, true) }}:\n  - script: echo x\n',
  ])('treats %j as reading a parameter', (content) => {
    const result = bundle('steps:\n- template: /t/x.yml\n', { '/t/x.yml': content });
    expect(result.skipped[0]?.reason).toBe('uses-parameters');
  });

  it('leaves a cross-repo reference alone and warns (E03-S06-T04, C-E03-419)', () => {
    const source = 'steps:\n- template: common.yml@templates\n';
    const result = bundle(source, {});
    expect(result.yaml).toBe(source);
    expect(result.skipped[0]?.reason).toBe('cross-repo');
    const [diagnostic, ...rest] = result.diagnostics;
    expect(rest).toStrictEqual([]);
    expect(diagnostic?.code).toBe(INLINE_CROSS_REPO);
    // Warning, not error: an un-inlined `@other` reference expands fine (HTTP 200), it is just
    // read from that repository's committed state.
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.message).toContain('@templates');
    expect(diagnostic?.hint).toContain('E09');
    expect(diagnostic?.range.line).toBe(2);
  });

  it('does not read the local tree for a cross-repo reference', () => {
    // A same-named file in the working tree must not be substituted for the other repository's.
    const result = bundle('steps:\n- template: /t/leaf.yml@templates\n', {
      '/t/leaf.yml': 'steps:\n- script: echo WRONG-REPO\n',
    });
    expect(result.yaml).not.toContain('WRONG-REPO');
    expect(result.inlined).toStrictEqual([]);
  });

  it('treats `@self` and an empty alias as local, not cross-repo (C-E03-212/213)', () => {
    for (const text of ['/t/a.yml@self', '/t/a.yml@SELF', '/t/a.yml@']) {
      const result = bundle(`steps:\n- template: ${text}\n`, {
        '/t/a.yml': 'steps:\n- script: echo local\n',
      });
      expect(result.yaml).toBe('steps:\n- script: echo local\n');
      expect(result.diagnostics).toStrictEqual([]);
    }
  });

  it('does not inline an `extends` target, and warns that local edits are invisible', () => {
    const source = 'extends:\n  template: /t/base.yml\n';
    const result = bundle(source, { '/t/base.yml': 'steps:\n- script: echo base\n' });
    expect(result.yaml).toBe(source);
    expect(result.skipped[0]?.reason).toBe('unsupported-site');
    expect(result.diagnostics[0]?.code).toBe(INLINE_UNSUPPORTED_SITE);
    expect(result.diagnostics[0]?.message).toContain(
      'The default service-backed expansion will read the committed file, so working-tree edits are invisible.',
    );
    expect(result.diagnostics[0]?.hint).toContain('explicitly use `--offline-expand`');
    expect(result.diagnostics[0]?.hint).not.toContain('E03-S06-T05');
  });

  it('does not inline a reference inside a parameters value', () => {
    const result = bundle(
      'jobs:\n- template: /t/j.yml\n  parameters:\n    extra:\n    - template: /t/x.yml\n',
      { '/t/j.yml': 'jobs:\n- job: A\n', '/t/x.yml': 'steps:\n- script: echo x\n' },
    );
    expect(result.skipped.map((entry) => entry.reason)).toContain('unsupported-site');
    const diagnostic = result.diagnostics.find(
      (entry) => entry.code === INLINE_UNSUPPORTED_SITE && entry.message.includes('`parameters`'),
    );
    expect(diagnostic?.message).toContain('working-tree edits are invisible');
    expect(diagnostic?.hint).toContain('explicitly use `--offline-expand`');
  });
});

describe('inlineTemplates — diagnostics with file:line', () => {
  it('reports a missing file at the reference position', () => {
    const result = bundle('steps:\n- script: echo a\n- template: /t/gone.yml\n', {});
    const [diagnostic, ...rest] = result.diagnostics;
    expect(rest).toStrictEqual([]);
    expect(diagnostic?.code).toBe(INLINE_MISSING_FILE);
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.file).toBe('/azure-pipelines.yml');
    expect(diagnostic?.range.line).toBe(3);
    expect(diagnostic?.message).toContain('/t/gone.yml');
    expect(result.yaml).toBe('steps:\n- script: echo a\n- template: /t/gone.yml\n');
  });

  it('reports a direct cycle with the chain that closed it', () => {
    const result = bundle('steps:\n- template: /t/a.yml\n', {
      '/t/a.yml': 'steps:\n- template: /t/b.yml\n',
      '/t/b.yml': 'steps:\n- template: /t/a.yml\n',
    });
    const cycle = result.diagnostics.find((entry) => entry.code === INLINE_CYCLE);
    expect(cycle?.severity).toBe('error');
    expect(cycle?.file).toBe('/t/b.yml');
    expect(cycle?.range.line).toBe(2);
    expect(cycle?.message).toContain('/azure-pipelines.yml → /t/a.yml → /t/b.yml → /t/a.yml');
  });

  it('reports a self-cycle', () => {
    const result = bundle('steps:\n- template: /t/self.yml\n', {
      '/t/self.yml': 'steps:\n- template: /t/self.yml\n',
    });
    expect(result.diagnostics.some((entry) => entry.code === INLINE_CYCLE)).toBe(true);
  });

  it('including the same file twice from one parent is a diamond, not a cycle (C-E03-209)', () => {
    const result = bundle('steps:\n- template: /t/a.yml\n- template: /t/a.yml\n', {
      '/t/a.yml': 'steps:\n- script: echo a\n',
    });
    expect(result.diagnostics).toStrictEqual([]);
    expect(result.yaml).toBe('steps:\n- script: echo a\n- script: echo a\n');
  });

  it('reports a path that escapes the repository root', () => {
    const result = bundle('steps:\n- template: ../outside.yml\n', {});
    expect(result.diagnostics[0]?.code).toBe(INLINE_MISSING_FILE);
    expect(result.diagnostics[0]?.message).toContain('escapes the repository root');
  });

  it('reports a template file with no matching container sequence', () => {
    const result = bundle('steps:\n- template: /t/vars.yml\n', {
      '/t/vars.yml': 'variables:\n  a: 1\n',
    });
    expect(result.diagnostics[0]?.code).toBe(INLINE_MISSING_FILE);
    expect(result.diagnostics[0]?.message).toContain('no `steps:` sequence');
  });
});

describe('inlineTemplates — documents with nothing to do', () => {
  it('returns the source unchanged when there are no references', () => {
    const source = 'steps:\n- script: echo only\n';
    expect(bundle(source, {}).yaml).toBe(source);
  });

  it('returns an empty document unchanged', () => {
    expect(bundle('', {}).yaml).toBe('');
  });
});
