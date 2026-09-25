/**
 * E09-S03-T06 — `azdo-emu fetch-artifacts`.
 *
 * Every dependency is injected, so these exercise the decisions the command actually makes —
 * which run to fetch, what to skip, what to refuse — without a network or a credential store.
 */
import { describe, expect, it } from 'vitest';

import {
  fetchArtifacts,
  type FetchArtifactsDeps,
  type FetchArtifactsFlags,
} from '../src/fetch/fetch-artifacts.js';
import { CliError } from '../src/exit.js';

const PIN = { pipelineId: 42, runId: 1234, artifacts: ['drop'] } as const;

const LOCKFILE = {
  version: 1 as const,
  convertedAt: '2026-09-25T00:00:00.000Z',
  pipelines: { upstream: { ...PIN, projectName: 'Fabrikam' } },
};

interface Call {
  readonly cacheDir: string;
  readonly alias: string;
  readonly pipelineId: number;
  readonly runId: number;
  readonly artifactName: string;
}

function deps(over: Partial<FetchArtifactsDeps> = {}): FetchArtifactsDeps & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    selectAzureCredential: (async () => ({
      kind: 'selected',
      mode: 'pat',
      credential: { version: 1, orgUrl: 'https://dev.azure.com/example', mode: 'pat', token: 't' },
      skipped: [],
    })) as unknown as FetchArtifactsDeps['selectAzureCredential'],
    listRuns: (async () => [
      { id: 1300, state: 'completed', result: 'succeeded' },
      { id: 1234, state: 'completed', result: 'succeeded' },
    ]) as unknown as FetchArtifactsDeps['listRuns'],
    downloadArtifact: (async (_client: unknown, options: Call) => {
      calls.push(options);
      return {
        dir: 'x',
        artifactName: options.artifactName,
        runId: options.runId,
        bytes: 10,
        files: 1,
      };
    }) as unknown as FetchArtifactsDeps['downloadArtifact'],
    readLockfile: (async () => LOCKFILE) as unknown as FetchArtifactsDeps['readLockfile'],
    env: { AZDO_ORG_URL: 'https://dev.azure.com/example' },
    exists: () => true,
    ...over,
  } as FetchArtifactsDeps & { calls: Call[] };
}

const FLAGS: FetchArtifactsFlags = { refresh: false, latest: false };

describe('fetch-artifacts (E09-S03-T06)', () => {
  it('fetches each pinned artifact into the run-keyed cache directory', async () => {
    const d = deps({ exists: (target) => !target.includes('.cache') });
    const report = await fetchArtifacts('/out', FLAGS, d);

    expect(d.calls).toEqual([
      {
        cacheDir: '/out/.cache',
        alias: 'upstream',
        pipelineId: 42,
        runId: 1234,
        artifactName: 'drop',
      },
    ]);
    expect(report.downloaded).toBe(1);
    expect(report.lines[0]).toContain('fetched   upstream/drop@1234');
  });

  it('skips a warm cache, and --refresh re-downloads it', async () => {
    const warm = deps();
    const cachedReport = await fetchArtifacts('/out', FLAGS, warm);
    expect(warm.calls).toEqual([]);
    expect(cachedReport.cached).toBe(1);
    expect(cachedReport.lines[0]).toContain('cached    upstream/drop@1234');

    const refreshed = deps();
    await fetchArtifacts('/out', { ...FLAGS, refresh: true }, refreshed);
    expect(refreshed.calls).toHaveLength(1);
  });

  describe('--latest', () => {
    it('fetches the newest completed run, leaving the pinned run’s cache directory alone', async () => {
      // The safety property is the *layout*: a different runId is a different directory, so the
      // bytes `verifyLockfile` resolves from the pin cannot be replaced by a newer run's.
      const d = deps({ exists: (target) => !target.includes('.cache') });
      await fetchArtifacts('/out', { ...FLAGS, latest: true }, d);

      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]!.runId).toBe(1300);
      expect(d.calls[0]!.cacheDir).toBe('/out/.cache');
      expect(d.calls.some((call) => call.runId === PIN.runId)).toBe(false);
    });

    it('says the pin was not moved, because the operator cannot see that from the output', async () => {
      const d = deps({ exists: (target) => !target.includes('.cache') });
      const report = await fetchArtifacts('/out', { ...FLAGS, latest: true }, d);
      expect(report.lines[0]).toContain('pinned run 1234 left as it is');
      expect(report.lines.join('\n')).toContain('convert --update');
    });

    it('notes when latest and pinned are the same run rather than implying a move', async () => {
      const d = deps({
        exists: (target) => !target.includes('.cache'),
        listRuns: (async () => [
          { id: 1234, state: 'completed' },
        ]) as unknown as FetchArtifactsDeps['listRuns'],
      });
      const report = await fetchArtifacts('/out', { ...FLAGS, latest: true }, d);
      expect(report.lines[0]).toContain('latest is the pinned run');
    });

    it('refuses when the pipeline has no completed run', async () => {
      const d = deps({
        listRuns: (async () => [
          { id: 9, state: 'inProgress' },
        ]) as unknown as FetchArtifactsDeps['listRuns'],
      });
      await expect(fetchArtifacts('/out', { ...FLAGS, latest: true }, d)).rejects.toThrow(
        /no completed run/,
      );
    });
  });

  describe('refusals', () => {
    it('a missing project directory is diagnosed before any credential is touched', async () => {
      let selected = false;
      const d = deps({
        exists: () => false,
        selectAzureCredential: (async () => {
          selected = true;
          throw new Error('should not be reached');
        }) as unknown as FetchArtifactsDeps['selectAzureCredential'],
      });
      await expect(fetchArtifacts('/nope', FLAGS, d)).rejects.toThrow(/no such directory/);
      expect(selected).toBe(false);
    });

    it('a project with no lockfile says so, and names the file', async () => {
      const d = deps({
        readLockfile: (async () => undefined) as unknown as FetchArtifactsDeps['readLockfile'],
      });
      await expect(fetchArtifacts('/out', FLAGS, d)).rejects.toThrow(/azdo-emu\.lock\.json/);
    });

    it('a lockfile that pins no artifacts is not an error', async () => {
      // `fetch-artifacts.sh` runs in projects that have no `resources.pipelines` at all; failing
      // here would make it a broken step in every one of them.
      const d = deps({
        readLockfile: (async () => ({
          version: 1,
          convertedAt: LOCKFILE.convertedAt,
        })) as unknown as FetchArtifactsDeps['readLockfile'],
      });
      const report = await fetchArtifacts('/out', FLAGS, d);
      expect(report).toMatchObject({ downloaded: 0, cached: 0 });
      expect(report.lines[0]).toContain('pins no artifacts');
    });

    it('refuses when neither the flag, the lockfile nor the environment names an organization', async () => {
      // This fixture's lockfile has no `repositories`, which is the only case where there is
      // genuinely nothing to derive from.
      const d = deps({ env: {} });
      await expect(fetchArtifacts('/out', FLAGS, d)).rejects.toThrow(/no organization/);
    });

    it('reports the auth chain’s own remediation when no credential works', async () => {
      const d = deps({
        selectAzureCredential: (async () => ({
          kind: 'unavailable',
          attempts: [{ mode: 'pat', reason: 'no-credential', detail: 'AZDO_PAT is not set' }],
        })) as unknown as FetchArtifactsDeps['selectAzureCredential'],
      });
      const error = await fetchArtifacts('/out', FLAGS, d).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CliError);
      // The chain's own wording, not a second one invented here: C-E09-023 is that "sign in" and
      // "this org will never accept that" are different remediations, and re-phrasing them at
      // each call site is how they drift back together.
      expect((error as CliError).hint).toBe(
        'Set AZDO_PAT to a personal access token for this organization.',
      );
    });

    it('requires a project when the pin does not name one', async () => {
      const d = deps({
        env: { AZDO_ORG_URL: 'https://dev.azure.com/example' },
        readLockfile: (async () => ({
          version: 1,
          convertedAt: LOCKFILE.convertedAt,
          pipelines: { upstream: { ...PIN } },
        })) as unknown as FetchArtifactsDeps['readLockfile'],
      });
      await expect(fetchArtifacts('/out', FLAGS, d)).rejects.toThrow(
        /no project for pipelines\.upstream/,
      );
    });
  });

  describe('where to fetch from (the lockfile knows, and `.env.example` does not)', () => {
    const withSelf = (url: string, type?: string) =>
      (async () => ({
        version: 1,
        convertedAt: LOCKFILE.convertedAt,
        repositories: {
          self: {
            url,
            ref: 'refs/heads/main',
            commit: 'abc',
            ...(type === undefined ? {} : { type }),
          },
        },
        pipelines: { upstream: { ...PIN } },
      })) as unknown as FetchArtifactsDeps['readLockfile'];

    it('derives the organization and project from repositories.self', async () => {
      // A converted project has no AZDO_ORG_URL: `.env.example` emits SYSTEM_ACCESSTOKEN and not
      // this. Without the derivation, `bash fetch-artifacts.sh` refuses in a project whose own
      // lockfile records the answer a few lines above the pins.
      const d = deps({
        env: {},
        exists: (target) => !target.includes('.cache'),
        readLockfile: withSelf('https://dev.azure.com/contoso/App/_git/app'),
      });
      const report = await fetchArtifacts('/out', FLAGS, d);
      expect(report.downloaded).toBe(1);
    });

    it('handles the legacy <org>.visualstudio.com spelling, where the org is the host', async () => {
      const d = deps({
        env: {},
        exists: (target) => !target.includes('.cache'),
        readLockfile: withSelf('https://contoso.visualstudio.com/App/_git/app'),
      });
      await expect(fetchArtifacts('/out', FLAGS, d)).resolves.toMatchObject({ downloaded: 1 });
    });

    it('does not read a GitHub self repository as an organization', async () => {
      // `github.com/<owner>` is not an Azure DevOps organization, and guessing would produce 404s
      // that read like a missing artifact.
      const d = deps({
        env: {},
        readLockfile: withSelf('https://github.com/contoso/app', 'github'),
      });
      await expect(fetchArtifacts('/out', FLAGS, d)).rejects.toThrow(/no organization/);
    });

    it('--org overrides the lockfile, and the lockfile overrides the ambient environment', async () => {
      const seen: string[] = [];
      const record = ((orgUrl: string) => {
        seen.push(orgUrl);
        return Promise.resolve({
          kind: 'selected',
          mode: 'pat',
          credential: { version: 1, orgUrl, mode: 'pat', token: 't' },
          skipped: [],
        });
      }) as unknown as FetchArtifactsDeps['selectAzureCredential'];

      const base = {
        exists: (target: string) => !target.includes('.cache'),
        readLockfile: withSelf('https://dev.azure.com/from-lockfile/App/_git/app'),
        selectAzureCredential: record,
      };
      await fetchArtifacts(
        '/out',
        FLAGS,
        deps({ ...base, env: { AZDO_ORG_URL: 'https://dev.azure.com/from-env' } }),
      );
      await fetchArtifacts(
        '/out',
        { ...FLAGS, org: 'https://dev.azure.com/from-flag' },
        deps({ ...base, env: {} }),
      );

      // The lockfile describes *this* project; AZDO_ORG_URL is ambient and may belong to whatever
      // the operator was working on last.
      expect(seen).toEqual([
        'https://dev.azure.com/from-lockfile',
        'https://dev.azure.com/from-flag',
      ]);
    });

    it('a pin’s own projectName wins over --project, because it means another project', async () => {
      const d = deps({
        exists: (target) => !target.includes('.cache'),
        readLockfile: (async () => ({
          version: 1,
          convertedAt: LOCKFILE.convertedAt,
          repositories: {
            self: { url: 'https://dev.azure.com/contoso/App/_git/app', ref: 'r', commit: 'c' },
          },
          pipelines: { upstream: { ...PIN, projectName: 'Fabrikam' } },
        })) as unknown as FetchArtifactsDeps['readLockfile'],
      });
      // docs/05 §4 writes projectName only when the resource declared `project:` — i.e. when it
      // lives somewhere else. A global --project overriding it would fetch from the wrong project.
      await expect(
        fetchArtifacts('/out', { ...FLAGS, project: 'Elsewhere' }, d),
      ).resolves.toMatchObject({ downloaded: 1 });
    });
  });

  it('reports in a stable order whatever order the lockfile lists', async () => {
    const d = deps({
      exists: (target) => !target.includes('.cache'),
      readLockfile: (async () => ({
        version: 1,
        convertedAt: LOCKFILE.convertedAt,
        pipelines: {
          zeta: { pipelineId: 2, runId: 2, artifacts: ['b', 'a'], projectName: 'P' },
          alpha: { pipelineId: 1, runId: 1, artifacts: ['x'], projectName: 'P' },
        },
      })) as unknown as FetchArtifactsDeps['readLockfile'],
    });
    const report = await fetchArtifacts('/out', FLAGS, d);
    expect(report.lines.map((line) => line.split(/\s+/)[1])).toEqual([
      'alpha/x@1',
      'zeta/a@2',
      'zeta/b@2',
    ]);
  });
});
