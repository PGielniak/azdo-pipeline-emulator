import { describe, expect, it } from 'vitest';
import {
  MULTIPLE_DOCUMENTS,
  formatLocation,
  parseErrorToDiagnostic,
  parsePipelineYaml,
  renderDiagnostic,
  renderDiagnostics,
  renderDiagnosticsJson,
} from '../../src/index.js';
import type { Diagnostic } from '../../src/index.js';

const source =
  [
    'trigger:',
    '- week1',
    '',
    'pool: Azure Pipelines',
    '',
    '',
    '- task: AzureCLI@2',
    '  displayName: run',
  ].join('\n') + '\n';

// Mirrors the real service sample from C-E01-008.
const blockMappingError: Diagnostic = {
  severity: 'error',
  code: 'PARSE_BLOCK_MAPPING',
  message: 'While parsing a block mapping, did not find expected key.',
  file: '/azure-pipelines.yml',
  range: { line: 7, col: 1, endLine: 7, endCol: 2 },
  jsonPath: '$',
  hint: 'steps must live under a `steps:` block',
};

describe('diagnostics reporter (E01-S01-T03)', () => {
  it('location prefix matches the service style (C-E01-007/008)', () => {
    expect(formatLocation('/azure-pipelines.yml', blockMappingError.range)).toBe(
      '/azure-pipelines.yml (Line: 7, Col: 1)',
    );
  });

  it('renders a full diagnostic with code frame, jsonPath and hint (plain)', () => {
    expect(renderDiagnostic(blockMappingError, { source })).toMatchSnapshot();
  });

  it('renders without a code frame when no source is given', () => {
    const warning: Diagnostic = {
      severity: 'warning',
      code: 'UNKNOWN_KEY',
      message: "unknown key 'continueOnErro'",
      file: 'templates/build.yml',
      range: { line: 12, col: 5, endLine: 12, endCol: 19 },
    };
    expect(renderDiagnostic(warning)).toMatchSnapshot();
  });

  it('renders multiple diagnostics separated by blank lines', () => {
    const info: Diagnostic = {
      severity: 'info',
      code: 'TEMPLATE_HOLE',
      message: 'value supplied by template parameter',
      file: '/azure-pipelines.yml',
      range: { line: 2, col: 3, endLine: 2, endCol: 8 },
      jsonPath: '$.trigger[0]',
    };
    expect(renderDiagnostics([blockMappingError, info], { source })).toMatchSnapshot();
  });

  it('caret spans the range width on a single line', () => {
    const d: Diagnostic = {
      severity: 'error',
      code: 'X',
      message: 'bad value',
      file: 'f.yml',
      range: { line: 4, col: 7, endLine: 4, endCol: 22 },
    };
    const rendered = renderDiagnostic(d, { source });
    expect(rendered).toContain('^^^^^^^^^^^^^^^');
    expect(rendered).toMatchSnapshot();
  });

  it('colored output wraps severity, gutter and caret in ANSI codes', () => {
    const rendered = renderDiagnostic(blockMappingError, { source, color: true });
    expect(rendered).toContain('\x1b[31m');
    expect(rendered).toContain('\x1b[0m');
    expect(rendered).toMatchSnapshot();
  });

  it('json rendering is stable and round-trips', () => {
    const json = renderDiagnosticsJson([blockMappingError]);
    expect(JSON.parse(json)).toEqual({ diagnostics: [blockMappingError] });
    expect(json).toMatchSnapshot();
  });

  it('parse errors flow into the diagnostic type and render with a frame', () => {
    const bad = 'a: 1\n---\nb: 2\n';
    const parsed = parsePipelineYaml(bad, '/azure-pipelines.yml');
    const multiDoc = parsed.errors.find((e) => e.code === MULTIPLE_DOCUMENTS);
    if (!multiDoc) throw new Error('expected MULTIPLE_DOCUMENTS parse error');
    const diagnostic = parseErrorToDiagnostic(multiDoc);
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.file).toBe('/azure-pipelines.yml');
    expect(renderDiagnostic(diagnostic, { source: bad })).toMatchSnapshot();
  });

  it('clamps the frame at file boundaries (line 1 and EOF)', () => {
    const top: Diagnostic = {
      severity: 'error',
      code: 'X',
      message: 'at the top',
      file: 'f.yml',
      range: { line: 1, col: 1, endLine: 1, endCol: 8 },
    };
    const eof: Diagnostic = {
      severity: 'error',
      code: 'X',
      message: 'past the end',
      file: 'f.yml',
      range: { line: 99, col: 1, endLine: 99, endCol: 1 },
    };
    expect(renderDiagnostic(top, { source })).toMatchSnapshot();
    // out-of-range line: head still renders, frame is skipped
    expect(renderDiagnostic(eof, { source })).not.toContain('|');
  });
});
