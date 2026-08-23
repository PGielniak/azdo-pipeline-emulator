// E04-S01-T02 — the normalization boundary.
//
// Table-driven against the captured expansions, as the Done field asks: "every shorthand either
// provably desugared by the service or normalized by us with a claim". The first suite is the
// *provably desugared* half and it reads the proof off the transcripts rather than off a literal —
// if a probe is re-run and the service's answer moves, these fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import { buildPipeline } from '../../src/model/build.js';
import {
  DESUGARED_TO_NAMED_TASK,
  ORIGIN_BY_TASK_GUID,
  UNMEASURED_SHORTHANDS,
  stepOriginOf,
} from '../../src/model/shorthand.js';
import { TASK_GUID_NAMES } from '../../src/normalize/normalize.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const transcript = (probe: string, file: string): string =>
  readFileSync(join(repoRoot, 'research/experiments/E04-normalization', probe, file), 'utf8');

/** The single step the model built from a probe's captured expansion. */
const stepOf = (probe: string) => {
  const parsed = parsePipelineYaml(transcript(probe, 'final.yml'), 'final.yml');
  return buildPipeline(parsed).pipeline?.stages[0]?.jobs[0]?.steps[0];
};

describe('what the service desugars — we do nothing (C-E04-030)', () => {
  it.each([
    ['script', 'CmdLine', '2'],
    ['bash', 'Bash', '3'],
    ['pwsh', 'PowerShell', '2'],
    ['powershell', 'PowerShell', '2'],
  ])('%s arrives as the named task %s@%s', (probe, name, version) => {
    const step = stepOf(probe);
    expect(step?.task).toStrictEqual({ name, version });
    // A named task needs no origin: the name is already the identity.
    expect(step?.origin).toBeUndefined();
  });

  it('the table of named desugarings matches the transcripts it documents', () => {
    for (const [keyword, expected] of Object.entries(DESUGARED_TO_NAMED_TASK)) {
      const step = stepOf(keyword);
      expect(`${step?.task.name}@${step?.task.version}`).toBe(expected);
    }
  });

  it('an already-canonical task passes through, so the rows above are attributable (C-E04-036)', () => {
    const step = stepOf('task-explicit');
    expect(step?.task).toStrictEqual({ name: 'CmdLine', version: '2' });
    expect(step?.inputs).toStrictEqual({ script: 'echo hello' });
  });

  it('tells `pwsh` and `powershell` apart by an input, not by the task (C-E04-037)', () => {
    expect(stepOf('pwsh')?.task).toStrictEqual(stepOf('powershell')?.task);
    expect(stepOf('pwsh')?.inputs['pwsh']).toBe('true');
    expect(stepOf('powershell')?.inputs['pwsh']).toBeUndefined();
  });
});

describe('what is left for us — recovering the origin keyword (C-E04-031/032)', () => {
  it.each([
    ['checkout', 'checkout', '6d15af64-176c-496d-b583-fd2ae21d4df4'],
    ['download', 'download', '30f35852-3f7e-4c0c-9a88-e127b4f97211'],
    ['publish', 'publish', 'ecdc45f6-832d-4ad9-b52b-ee49e94659be'],
  ])('%s arrives as a bare GUID and its keyword is recovered', (probe, origin, guid) => {
    const step = stepOf(probe);
    expect(step?.task.name).toBe(guid);
    expect(step?.origin).toBe(origin);
  });

  it('carries the renamed inputs the desugaring produced, not the authored keys (C-E04-032)', () => {
    // `publish:`'s `artifact:` becomes `artifactName:`, while `download:`'s stays `artifact:` and
    // its scalar becomes `alias:`. A model assuming the authored names would read the wrong input.
    expect(stepOf('publish')?.inputs).toStrictEqual({
      path: '$(Build.ArtifactStagingDirectory)',
      artifactName: 'drop',
    });
    expect(stepOf('download')?.inputs).toStrictEqual({ alias: 'current', artifact: 'drop' });
    expect(stepOf('checkout')?.inputs).toStrictEqual({ repository: 'self' });
  });

  it('matches a GUID case-insensitively', () => {
    expect(stepOriginOf('6D15AF64-176C-496D-B583-FD2AE21D4DF4')).toBe('checkout');
  });

  it('leaves an ordinary task alone', () => {
    expect(stepOriginOf('CmdLine')).toBeUndefined();
    expect(stepOriginOf('')).toBeUndefined();
  });
});

describe('the boundary with the normalizer (C-E04-033/034)', () => {
  it('does not rename the GUIDs the normalizer deliberately refuses to name', () => {
    // `normalize.ts` holds exactly one grounded GUID→name entry and omits checkout/download
    // because they 404 from the task catalogue. This module must not have quietly added them.
    expect(Object.keys(TASK_GUID_NAMES)).toStrictEqual(['ecdc45f6-832d-4ad9-b52b-ee49e94659be']);
    for (const guid of Object.keys(ORIGIN_BY_TASK_GUID)) {
      if (guid === 'ecdc45f6-832d-4ad9-b52b-ee49e94659be') continue;
      expect(TASK_GUID_NAMES[guid]).toBeUndefined();
    }
  });

  it('keeps the task reference itself untouched — origin is a separate fact', () => {
    // Recovering the keyword must not rewrite `task.name`; the diff and the model stay consistent.
    expect(stepOf('checkout')?.task.name).toBe('6d15af64-176c-496d-b583-fd2ae21d4df4');
  });

  it('never folds `download:` onto the catalogue task of a similar name (C-E04-034)', () => {
    expect(stepOriginOf('DownloadPipelineArtifact')).toBeUndefined();
  });
});

describe('what was not measured, and says so (C-E04-035)', () => {
  it('lists `getPackage` as unmeasured rather than silently omitting it', () => {
    expect(UNMEASURED_SHORTHANDS).toStrictEqual(['getPackage']);
  });

  it('records why: the service rejects it without a package resource', () => {
    const response = JSON.parse(transcript('getPackage', 'response.json')) as {
      kind: string;
      message: string;
    };
    expect(response.kind).toBe('rejected');
    expect(response.message).toContain('Cannot find package resource');
  });
});
