// E03-S07-T02 — missing-file and cycle diagnostics, in the E01 shape.
//
// The Done criterion asks for snapshot tests, and the snapshots here go through the **E01
// renderer** (`renderDiagnostic`) rather than asserting the `Diagnostic` object. That is the point:
// the task's Do says "E01-style diagnostics (file:line, hint)", and only the renderer proves the
// severity/code/location/hint/code-frame assembly a user actually reads. A snapshot of the object
// would pass even if the diagnostic rendered as an unreadable mess.
//
// The second half of the Do — "never a raw exception" — is where the real work was. Four things
// could previously have produced one, or produced a diagnostic describing a consequence rather than
// a cause: a template with broken YAML, a reader that throws, and the two published ceilings
// (C-E03-403) that a pathological chain would otherwise hit as a stack overflow.
import { describe, expect, it } from 'vitest';

import { renderDiagnostic, renderDiagnosticsJson } from '../../src/frontend/diagnostics.js';
import {
  INLINE_CYCLE,
  INLINE_LIMIT,
  INLINE_MISSING_FILE,
  INLINE_PARSE_ERROR,
  INLINE_UNREADABLE,
  MAX_TEMPLATE_NESTING,
  inlineTemplates,
  treeReader,
} from '../../src/template/inline.js';

const bundle = (source: string, files: Record<string, string>) =>
  inlineTemplates(source, { read: treeReader(files) });

describe('missing file — snapshot in the E01 shape', () => {
  const source = `steps:
- script: echo before
- template: /templates/does-not-exist.yml
- script: echo after
`;

  it('renders with location, message, hint and a code frame', () => {
    const result = bundle(source, {});
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.code).toBe(INLINE_MISSING_FILE);
    expect(renderDiagnostic(diagnostic!, { source })).toMatchInlineSnapshot(`
      "error bundle-template-not-found: /azure-pipelines.yml (Line: 3, Col: 13): Template file \`/templates/does-not-exist.yml\` not found in the local working tree.
          1 | steps:
          2 | - script: echo before
        > 3 | - template: /templates/does-not-exist.yml
            |             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
          4 | - script: echo after
          5 | 
        hint: Paths are repository-absolute; a bare path is relative to the file that references it."
    `);
  });

  it('carries the wire shape `--json` would print', () => {
    expect(renderDiagnosticsJson(bundle(source, {}).diagnostics)).toContain(
      '"code": "bundle-template-not-found"',
    );
  });

  it('is reported against the *referencing* file when the reference is inside a template', () => {
    const result = bundle('steps:\n- template: /a.yml\n', {
      '/a.yml': 'steps:\n- script: echo a\n- template: /gone.yml\n',
    });
    const missing = result.diagnostics.find((entry) => entry.code === INLINE_MISSING_FILE);
    expect(missing?.file).toBe('/a.yml');
    expect(missing?.range.line).toBe(3);
  });
});

describe('cycle — snapshot in the E01 shape', () => {
  it('renders the whole active chain, not just the repeated file', () => {
    const b = 'steps:\n- template: /t/a.yml\n';
    const result = bundle('steps:\n- template: /t/a.yml\n', {
      '/t/a.yml': 'steps:\n- template: /t/b.yml\n',
      '/t/b.yml': b,
    });
    const cycle = result.diagnostics.find((entry) => entry.code === INLINE_CYCLE);
    expect(renderDiagnostic(cycle!, { source: b })).toMatchInlineSnapshot(`
      "error bundle-template-cycle: /t/b.yml (Line: 2, Col: 13): Template cycle: \`/t/a.yml\` is already being inlined (/azure-pipelines.yml → /t/a.yml → /t/b.yml → /t/a.yml).
          1 | steps:
        > 2 | - template: /t/a.yml
            |             ^^^^^^^^
          3 | 
        hint: Including the same file twice from one parent is fine (a diamond); a cycle is the same file appearing twice in one active chain."
    `);
  });

  it('renders a self-cycle', () => {
    const self = 'steps:\n- template: /t/self.yml\n';
    const result = bundle('steps:\n- template: /t/self.yml\n', { '/t/self.yml': self });
    const cycle = result.diagnostics.find((entry) => entry.code === INLINE_CYCLE);
    expect(renderDiagnostic(cycle!, { source: self })).toMatchInlineSnapshot(`
      "error bundle-template-cycle: /t/self.yml (Line: 2, Col: 13): Template cycle: \`/t/self.yml\` is already being inlined (/azure-pipelines.yml → /t/self.yml → /t/self.yml).
          1 | steps:
        > 2 | - template: /t/self.yml
            |             ^^^^^^^^^^^
          3 | 
        hint: Including the same file twice from one parent is fine (a diamond); a cycle is the same file appearing twice in one active chain."
    `);
  });
});

describe('never a raw exception', () => {
  it('reports a template with broken YAML against that template, not as a missing container', () => {
    // Before this task the parse errors were dropped, `findTemplateReferences` found nothing, and
    // the caller reported "no `steps:` sequence to inline" — a consequence, not the cause.
    const result = bundle('steps:\n- template: /broken.yml\n', {
      '/broken.yml': 'steps:\n- script: one\n   bad: indent\n',
    });
    const parse = result.diagnostics.find((entry) => entry.code === INLINE_PARSE_ERROR);
    expect(parse?.file).toBe('/broken.yml');
    expect(parse?.severity).toBe('error');
    expect(parse?.message).toContain('could not be parsed');
  });

  it('keeps bundling a healthy sibling after a broken template', () => {
    const result = bundle('steps:\n- template: /broken.yml\n- template: /ok.yml\n', {
      '/broken.yml': 'steps:\n- script: one\n   bad: indent\n',
      '/ok.yml': 'steps:\n- script: echo ok\n',
    });
    expect(result.yaml).toContain('echo ok');
    expect(result.diagnostics.some((entry) => entry.code === INLINE_PARSE_ERROR)).toBe(true);
  });

  it('turns a throwing reader into a diagnostic', () => {
    const result = inlineTemplates('steps:\n- template: /denied.yml\n', {
      read: () => {
        throw new Error('EACCES: permission denied');
      },
    });
    const unreadable = result.diagnostics.find((entry) => entry.code === INLINE_UNREADABLE);
    expect(unreadable?.severity).toBe('error');
    expect(unreadable?.message).toContain('EACCES');
    expect(unreadable?.file).toBe('/azure-pipelines.yml');
    expect(unreadable?.range.line).toBe(2);
  });

  it('stops at the nesting ceiling instead of overflowing the stack (C-E03-403)', () => {
    // A chain far longer than the service's 100-level limit. Without the guard this recurses once
    // per link; the assertion that matters is that it returns at all.
    const depth = MAX_TEMPLATE_NESTING + 50;
    const files: Record<string, string> = {};
    for (let index = 0; index < depth; index += 1) {
      files[`/chain/${index}.yml`] = `steps:\n- template: /chain/${index + 1}.yml\n`;
    }
    files[`/chain/${depth}.yml`] = 'steps:\n- script: echo bottom\n';

    const result = bundle('steps:\n- template: /chain/0.yml\n', files);
    const limit = result.diagnostics.find((entry) => entry.code === INLINE_LIMIT);
    expect(limit?.severity).toBe('error');
    expect(limit?.message).toContain('nesting exceeds 100 levels');
    expect(limit?.hint).toContain('100 levels');
    // The bottom of the chain was never reached, so its marker is not in the override.
    expect(result.yaml).not.toContain('echo bottom');
  });

  it('stops at the file ceiling for a wide bundle (C-E03-403)', () => {
    const files: Record<string, string> = {};
    const references: string[] = [];
    for (let index = 0; index < 130; index += 1) {
      files[`/wide/${index}.yml`] = `steps:\n- script: echo ${index}\n`;
      references.push(`- template: /wide/${index}.yml`);
    }
    const result = bundle(`steps:\n${references.join('\n')}\n`, files);
    const limit = result.diagnostics.find((entry) => entry.code === INLINE_LIMIT);
    expect(limit?.message).toContain('More than 100 template files');
    expect(result.inlined).toHaveLength(100);
  });

  it('an empty template file is reported, not spliced as nothing', () => {
    const result = bundle('steps:\n- template: /empty.yml\n', { '/empty.yml': '' });
    expect(result.diagnostics[0]?.code).toBe(INLINE_MISSING_FILE);
    expect(result.diagnostics[0]?.message).toContain('no `steps:` sequence');
  });

  it('never throws for any of the failure shapes, and always returns usable YAML', () => {
    const cases: [string, Record<string, string>][] = [
      ['steps:\n- template: /gone.yml\n', {}],
      ['steps:\n- template: /broken.yml\n', { '/broken.yml': 'a:\n- b\n  c: d\n' }],
      ['steps:\n- template: ../../escape.yml\n', {}],
      ['steps:\n- template: /empty.yml\n', { '/empty.yml': '' }],
      ['steps:\n- template: /cyc.yml\n', { '/cyc.yml': 'steps:\n- template: /cyc.yml\n' }],
    ];
    for (const [source, files] of cases) {
      const result = bundle(source, files);
      expect(typeof result.yaml).toBe('string');
      expect(result.yaml.length).toBeGreaterThan(0);
    }
  });
});
