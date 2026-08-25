// E03-S04-T03 — strict validation of the expanded pipeline.
//
// Three Done criteria, three sections:
//
//   1. **"corpus expansions validate"** — all ten committed `final.yml`s, clean. They do *not*
//      validate under the authored-document validator, and the two families that fail are the
//      point of this module: the service emits shapes it refuses as input. A test that only
//      checked the happy path would pass with the relaxations removed, so each is also pinned by a
//      negative case proving the relaxation is narrow.
//   2. **"injected mutations fail with pointers into expanded YAML + original source"** — the
//      mutation is injected into a *known-good expansion*, and the diagnostic is asserted to carry
//      both pointers, the second through the provenance port.
//   3. **"3 mutation cases matched against recorded service errors"** — the three mutations were
//      submitted to the live preview endpoint and all three were rejected
//      (`research/experiments/E03-strict-validation/`). The test reads those transcripts back, so
//      it fails if someone relaxes a family the service actually enforces.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DESUGARED_TASK_GUIDS,
  EXPANDED_FILE,
  formatExpandedDiagnostic,
  validateExpandedPipeline,
} from '../../src/frontend/validate-expanded.js';
import { SCHEMA_UNKNOWN_KEY, SCHEMA_UNKNOWN_TASK } from '../../src/frontend/validate.js';
import { expandDocument, originLookup } from '../../src/template/expand.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const EXPERIMENTS = join(repoRoot, 'research', 'experiments', 'E03-strict-validation');

const oracleFinals = (): { name: string; text: string }[] =>
  readdirSync(join(repoRoot, 'fixtures', 'oracle'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.final.yml'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      name: e.name,
      text: readFileSync(join(repoRoot, 'fixtures', 'oracle', e.name), 'utf8'),
    }));

/** The service's answer to a mutation probe, read out of its committed transcript. */
function serviceOutcome(probe: string): { message: string; rejected: boolean } {
  const body = JSON.parse(
    readFileSync(join(EXPERIMENTS, probe, 'response.json'), 'utf8'),
  ) as Record<string, unknown>;
  const message = typeof body.message === 'string' ? body.message : '';
  return { message, rejected: message.length > 0 };
}

const BASE = readFileSync(
  join(repoRoot, 'fixtures', 'oracle', '10-monorepo-triggers-pools.final.yml'),
  'utf8',
);

/** The same three mutations the survey submitted, applied the same way. */
const MUTATIONS = {
  'unknown-key': (base: string) => base.replace(/^(- stage: .*)$/m, '$1\n  notAStageKey: whatever'),
  'bad-type': (base: string) =>
    base.replace(/^(- stage: .*)$/m, '$1\n  condition:\n    not: a-string'),
  'unknown-task': (base: string) => base.replace(/task: [A-Za-z0-9-]+@\d+/, 'task: NoSuchTask@9'),
} as const;

describe('corpus expansions validate', () => {
  it.each(oracleFinals())('$name has no diagnostics', ({ text }) => {
    expect(validateExpandedPipeline(text)).toEqual([]);
  });

  it('reports against `pipeline.expanded.yml` by default', () => {
    const broken = MUTATIONS['unknown-key'](BASE);
    expect(validateExpandedPipeline(broken)[0]!.file).toBe(EXPANDED_FILE);
    expect(validateExpandedPipeline(broken, { file: 'other.yml' })[0]!.file).toBe('other.yml');
  });
});

describe('the relaxations are narrow', () => {
  it('accepts `{enabled: false}` only under trigger/pr, not anywhere it appears (C-E03-002)', () => {
    expect(validateExpandedPipeline('trigger:\n  enabled: false\nsteps: []\n')).toEqual([]);
    expect(validateExpandedPipeline('pr:\n  enabled: false\nsteps: []\n')).toEqual([]);
    // The same key somewhere else is still an unknown key — the relaxation is two paths, not a
    // property name.
    const elsewhere = validateExpandedPipeline(
      'stages:\n- stage: a\n  enabled: false\n  jobs: []\n',
    );
    expect(elsewhere.map((d) => d.code)).toContain(SCHEMA_UNKNOWN_KEY);
  });

  it('accepts the three desugared GUIDs and nothing else that looks like one (C-E04-031)', () => {
    const step = (task: string) => `steps:\n- task: ${task}\n  inputs:\n    repository: self\n`;
    for (const guid of Object.keys(DESUGARED_TASK_GUIDS))
      expect(validateExpandedPipeline(step(`${guid}@1`)).map((d) => d.code)).not.toContain(
        SCHEMA_UNKNOWN_TASK,
      );
    // A different GUID is an unknown task, not a free pass for anything GUID-shaped.
    expect(
      validateExpandedPipeline(step('00000000-0000-0000-0000-000000000000@1')).map((d) => d.code),
    ).toContain(SCHEMA_UNKNOWN_TASK);
  });

  it('names the three GUIDs the shorthands they came from', () => {
    expect(Object.values(DESUGARED_TASK_GUIDS).sort()).toEqual(['checkout', 'download', 'publish']);
  });
});

describe('injected mutations fail with both pointers', () => {
  it.each(Object.keys(MUTATIONS))(
    '%s is reported, with a pointer into the expanded document',
    (name) => {
      const diagnostics = validateExpandedPipeline(MUTATIONS[name as keyof typeof MUTATIONS](BASE));
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]!.range.line).toBeGreaterThan(0);
    },
  );

  it('unknown-key and bad-type are errors; unknown-task is a warning, deliberately', () => {
    // The vendored catalogue holds in-box tasks only, so erroring on an unknown task would fail
    // every pipeline using a marketplace task (C-E01-033). The service *does* reject it, because
    // there the catalogue is the organization's — the divergence is severity, and it closes when
    // an org schema is available (E01-S02-T03 / E09).
    for (const name of ['unknown-key', 'bad-type'] as const)
      expect(
        validateExpandedPipeline(MUTATIONS[name](BASE)).some((d) => d.severity === 'error'),
      ).toBe(true);
    const task = validateExpandedPipeline(MUTATIONS['unknown-task'](BASE)).find(
      (d) => d.code === SCHEMA_UNKNOWN_TASK,
    )!;
    expect(task.severity).toBe('warning');
    expect(task.message).toContain('NoSuchTask');
  });

  it('carries the original source through the provenance port', () => {
    // An offline expansion supplies the map; the diagnostic then points at both documents.
    const authored = 'stages:\n- stage: build\n  notAStageKey: whatever\n  jobs:\n  - job: a\n';
    const expansion = expandDocument(authored, 'pipeline.yml');
    const diagnostics = validateExpandedPipeline(expansion.yaml, {
      originAt: originLookup(expansion.map),
    });
    const unknown = diagnostics.find((d) => d.code === SCHEMA_UNKNOWN_KEY)!;
    expect(unknown.origin).toBeDefined();
    expect(unknown.origin!.file).toBe('pipeline.yml');
    expect(unknown.origin!.line).toBe(3);
    expect(formatExpandedDiagnostic(unknown)).toContain('(from pipeline.yml:3:');
  });

  it('omits the origin when no map is supplied, which is the default path', () => {
    const diagnostics = validateExpandedPipeline(MUTATIONS['unknown-key'](BASE));
    expect(diagnostics[0]!.origin).toBeUndefined();
    expect(formatExpandedDiagnostic(diagnostics[0]!)).not.toContain('(from ');
  });

  it('reports a parse failure as a diagnostic rather than throwing', () => {
    const diagnostics = validateExpandedPipeline('stages: [\n');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.file).toBe(EXPANDED_FILE);
  });
});

describe('matched against the recorded service errors', () => {
  it.each(Object.keys(MUTATIONS))('the service also rejects %s', (name) => {
    const outcome = serviceOutcome(name);
    // If the service had *accepted* one of these, our rejection would be stricter than the
    // authority — which turns a working pipeline into a conversion failure.
    expect(outcome.rejected).toBe(true);
    expect(outcome.message.length).toBeGreaterThan(0);
    expect(
      validateExpandedPipeline(MUTATIONS[name as keyof typeof MUTATIONS](BASE)).length,
    ).toBeGreaterThan(0);
  });

  it('the unknown-key rejection names the same property we do', () => {
    expect(serviceOutcome('unknown-key').message).toContain("Unexpected value 'notAStageKey'");
    expect(
      validateExpandedPipeline(MUTATIONS['unknown-key'](BASE))
        .map((d) => d.message)
        .join('\n'),
    ).toContain('notAStageKey');
  });

  it('the unknown-task rejection names the same task we do', () => {
    expect(serviceOutcome('unknown-task').message).toContain("'NoSuchTask'");
    expect(
      validateExpandedPipeline(MUTATIONS['unknown-task'](BASE))
        .map((d) => d.message)
        .join('\n'),
    ).toContain('NoSuchTask');
  });

  it('the bad-type rejection is about the mapping, on both sides', () => {
    // The service says "A mapping was not expected"; we say the type does not match. Different
    // words, same finding — the transcript is the record of what it actually said.
    expect(serviceOutcome('bad-type').message).toContain('A mapping was not expected');
    expect(validateExpandedPipeline(MUTATIONS['bad-type'](BASE)).length).toBeGreaterThan(0);
  });
});
