// E01-S01-T02 — server-quirk conformance.
//
// Every case below is a live preview-endpoint transcript in research/experiments/E01-quirks/;
// the probe YAML here is byte-for-byte the `yamlOverride` that produced it, so a failure means
// our front end disagrees with what the service actually did on 2026-08-11.
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_UNSUPPORTED,
  DUPLICATE_KEY,
  MULTIPLE_DOCUMENTS,
  SERVER_QUIRKS,
  parsePipelineYaml,
} from '../../src/index.js';

const FILE = '/azure-pipelines.yml';

/** The exact probe payloads submitted by `pnpm oracle-quirks`. */
const PROBE = {
  controlVariables: 'variables:\n  a: first\n  b: second\nsteps:\n- script: echo $(a) $(b)\n',
  anchorAlias: 'variables:\n  a: &shared first\n  b: *shared\nsteps:\n- script: echo $(a) $(b)\n',
  anchorOnly: 'variables:\n  a: &shared first\n  b: second\nsteps:\n- script: echo $(a) $(b)\n',
  mergeKey:
    'jobs:\n- job: A\n  pool: &shared\n    vmImage: ubuntu-latest\n  steps:\n' +
    '  - script: echo one\n- job: B\n  pool:\n    <<: *shared\n  steps:\n  - script: echo two\n',
  dupKeyMapping: 'variables:\n  a: first\n  a: second\nsteps:\n- script: echo $(a)\n',
  dupKeyRoot: 'variables:\n  a: first\nvariables:\n  a: second\nsteps:\n- script: echo $(a)\n',
  dupKeyStep: 'steps:\n- script: echo one\n  displayName: first\n  displayName: second\n',
  dupKeyCase: 'steps:\n- script: echo one\n  displayName: first\n  displayname: second\n',
  dupKeyCaseUserData: 'variables:\n  a: first\n  A: second\nsteps:\n- script: echo $(a)\n',
  controlSingleDoc: 'steps:\n- script: echo one\n',
  multiDoc: 'steps:\n- script: echo one\n---\nsteps:\n- script: echo two\n',
  leadingDocStart: '---\nsteps:\n- script: echo one\n',
  trailingDocEnd: 'steps:\n- script: echo one\n...\n',
} as const;

function errors(source: string) {
  return parsePipelineYaml(source, FILE).errors;
}

describe('server quirks — anchors (C-E01-022, research/experiments/E01-quirks/anchor-*.md)', () => {
  it('control: the same pipeline without an anchor parses clean', () => {
    expect(errors(PROBE.controlVariables)).toEqual([]);
  });

  it('rejects an anchor that is never aliased — the service rejects the definition itself', () => {
    const [error, ...rest] = errors(PROBE.anchorOnly);
    expect(rest).toEqual([]);
    expect(error?.code).toBe(ANCHOR_UNSUPPORTED);
    // message mirrors the service, minus its trailing null-reference artifact
    expect(error?.message).toBe("Anchors are not currently supported. Remove the anchor 'shared'");
  });

  it('rejects anchor + alias, pointing at the anchored node', () => {
    const [error] = errors(PROBE.anchorAlias);
    expect(error?.code).toBe(ANCHOR_UNSUPPORTED);
    expect(error?.pos.range).toMatchObject({ line: 2, col: 6 });
  });

  it('rejects the merge key `<<: *shared` with the same anchor error (no separate path)', () => {
    const found = errors(PROBE.mergeKey);
    expect(found.map((e) => e.code)).toEqual([ANCHOR_UNSUPPORTED]);
    expect(found[0]?.message).toContain("Remove the anchor 'shared'");
  });
});

describe('server quirks — duplicate keys (C-E01-023, .../dup-key-*.md)', () => {
  // The service points at the SECOND occurrence; these are the exact positions it returned.
  it.each([
    ['inside a mapping', PROBE.dupKeyMapping, "'a' is already defined", 3, 3],
    ['at the document root', PROBE.dupKeyRoot, "'variables' is already defined", 3, 1],
    ['inside a step mapping', PROBE.dupKeyStep, "'displayName' is already defined", 4, 3],
    // C-E01-028 — the check folds case, and the message quotes the *second* spelling.
    ['differing only in case', PROBE.dupKeyCase, "'displayname' is already defined", 4, 3],
    ['case-folded in user data', PROBE.dupKeyCaseUserData, "'A' is already defined", 3, 3],
  ])('rejects a duplicate key %s at the service position', (_name, src, message, line, col) => {
    const found = errors(src as string);
    expect(found.map((e) => e.code)).toEqual([DUPLICATE_KEY]);
    expect(found[0]?.message).toBe(message);
    expect(found[0]?.pos.range).toMatchObject({ line, col });
  });

  it('keeps both pairs in the DOM — uniqueKeys is off, so the mapping shape is unchanged', () => {
    // Guard for downstream stages (validate.ts, E04): a duplicate-key document is fatal, but the
    // DOM it produces must still be well-formed rather than silently collapsed.
    const parsed = parsePipelineYaml('a: 1\nA: 2\n', FILE);
    expect(parsed.root?.kind).toBe('mapping');
    expect(
      parsed.root?.kind === 'mapping' ? parsed.root.entries.map((e) => e.key.value) : [],
    ).toEqual(['a', 'A']);
  });
});

describe('server quirks — documents (C-E01-024/025, .../multi-doc.md, .../*-doc-*.md)', () => {
  it('control: a plain single document parses clean', () => {
    expect(errors(PROBE.controlSingleDoc)).toEqual([]);
  });

  it('rejects a second document', () => {
    const found = errors(PROBE.multiDoc);
    expect(found.map((e) => e.code)).toEqual([MULTIPLE_DOCUMENTS]);
    expect(found[0]?.pos.range.line).toBe(3); // the `---` line
  });

  it('accepts a leading `---` — a marker is not a separator (the service returns 200)', () => {
    const parsed = parsePipelineYaml(PROBE.leadingDocStart, FILE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.root?.kind).toBe('mapping');
  });

  it('accepts a trailing `...` end-of-document marker (the service returns 200)', () => {
    expect(errors(PROBE.trailingDocEnd)).toEqual([]);
  });
});

describe('server quirks — conformance table', () => {
  it('every entry names a claim and the transcript that proves it', () => {
    expect(SERVER_QUIRKS.length).toBeGreaterThan(0);
    for (const quirk of SERVER_QUIRKS) {
      expect(quirk.claim).toMatch(/^C-E01-\d{3}$/);
      expect(quirk.transcript).toMatch(/\.md$/);
      expect(quirk.accepted).toBe(quirk.code === undefined);
    }
  });
});
