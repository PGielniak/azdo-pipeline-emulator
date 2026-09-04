import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPipeline, parsePipelineYaml, type Step } from '@azdo-emu/engine';

import {
  collectConnections,
  dockerStepWarnings,
  localSessionWarnings,
  REAL_TASK_ENDPOINT_USE,
  type StepSite,
  type TaskDefinitions,
} from '../src/connections.js';
import { connectionKeys } from '../src/service-connection.js';
import { emitEntrypoints } from '../src/entrypoints.js';
import { scaffold } from '../src/scaffold.js';
import { loadVendoredTaskDefinitions, vendoredTasksDir } from '../src/vendor.js';

/** The real snapshots — the point of these tests is that the declarations are not hand-written. */
const VENDORED: TaskDefinitions = loadVendoredTaskDefinitions();

const step = (name: string, version: string, inputs: Record<string, string>, id = 1): Step =>
  ({
    id,
    displayName: `${name} step`,
    task: { name, version },
    inputs,
  }) as Step;

const site = (step: Step, path = 'Build/Job/step 1'): StepSite => ({ step, path });

describe('the vendored declarations this task depends on (C-E08-035)', () => {
  it('both tasks declare the connection input as connectedService:AzureRM, aliased', () => {
    // Same task family, different input *name* and different *case* — which is exactly why the
    // collector keys on the declared type and not on a name list.
    const cli = VENDORED['AzureCLI@2']?.inputs?.find(
      (input) => input.type === 'connectedService:AzureRM',
    );
    const ps = VENDORED['AzurePowerShell@5']?.inputs?.find(
      (input) => input.type === 'connectedService:AzureRM',
    );
    expect(cli?.name).toBe('connectedServiceNameARM');
    expect(ps?.name).toBe('ConnectedServiceNameARM');
    expect(cli?.aliases).toContain('azureSubscription');
    expect(ps?.aliases).toContain('azureSubscription');
    expect(cli?.required).toBe(true);
    expect(ps?.required).toBe(true);
  });
});

describe('collecting connections (E08-S02-T01)', () => {
  it('finds a connection written under its alias (C-E08-030/031)', () => {
    // The expansion hands back `azureSubscription:` verbatim, so a name-only match finds nothing.
    const { connections } = collectConnections(
      [site(step('AzureCLI', '2', { azureSubscription: 'my-prod-sub', scriptType: 'bash' }))],
      VENDORED,
    );
    expect(connections.map((c) => c.name)).toEqual(['my-prod-sub']);
  });

  it('finds it under the declared name in either case (C-E08-032/035)', () => {
    const declared = collectConnections(
      [site(step('AzureCLI', '2', { connectedServiceNameARM: 'my-prod-sub' }))],
      VENDORED,
    );
    const folded = collectConnections(
      [site(step('AzurePowerShell', '5', { connectedservicenamearm: 'my-prod-sub' }))],
      VENDORED,
    );
    expect(declared.connections.map((c) => c.name)).toEqual(['my-prod-sub']);
    expect(folded.connections.map((c) => c.name)).toEqual(['my-prod-sub']);
  });

  it('forces `sp` mode for a real-task consumer, because ambient cannot work (C-E08-036)', () => {
    // Two independent reasons, either one sufficient: `loginAzureRM` reads the scheme with
    // required=true and has no reuse arm (C-E08-036); and the task repoints AZURE_CONFIG_DIR at a
    // per-invocation directory (C-E08-037), so a prior `az login` would be invisible even if the
    // scheme read had passed.
    const { connections } = collectConnections(
      [site(step('AzureCLI', '2', { azureSubscription: 'prod' }))],
      VENDORED,
    );
    expect(connections[0]?.mode).toBe('sp');
    const keys = connectionKeys(connections[0]!).map((entry) => entry.key);
    expect(keys).toContain('ENDPOINT_AUTH_SCHEME_prod');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_prod_SERVICEPRINCIPALID');
  });

  it('drops the certificate fields when a consumer rejects them (C-E08-040)', () => {
    // AzurePowerShell@5 on a non-Windows host throws for any authenticationType but SPNKey, so a
    // PEM line would ask for a credential the task refuses.
    const { connections } = collectConnections(
      [site(step('AzurePowerShell', '5', { azureSubscription: 'prod' }))],
      VENDORED,
    );
    const keys = connectionKeys(connections[0]!).map((entry) => entry.key);
    expect(keys).not.toContain('ENDPOINT_AUTH_PARAMETER_prod_SERVICEPRINCIPALCERTIFICATE');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_prod_SERVICEPRINCIPALKEY');
  });

  it('narrows to the strictest consumer when one connection serves both (C-E08-040)', () => {
    // One `.env` block holds one credential, and both steps read it. AzureCLI@2 accepts a
    // certificate and AzurePowerShell@5 does not, so offering the PEM would let a user fill in a
    // value that makes the *second* step throw — the intersection is the only set that works for
    // every consumer.
    const { connections } = collectConnections(
      [
        site(step('AzurePowerShell', '5', { azureSubscription: 'prod' }, 1)),
        site(step('AzureCLI', '2', { azureSubscription: 'prod' }, 2), 'Build/Job/step 2'),
      ],
      VENDORED,
    );
    expect(connections).toHaveLength(1);
    const keys = connectionKeys(connections[0]!).map((e) => e.key);
    expect(keys).not.toContain('ENDPOINT_AUTH_PARAMETER_prod_SERVICEPRINCIPALCERTIFICATE');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_prod_SERVICEPRINCIPALKEY');
  });

  it('records every step that uses a connection, once each', () => {
    const { connections } = collectConnections(
      [
        site(step('AzureCLI', '2', { azureSubscription: 'prod' }, 1), 'Build/Job/step 1'),
        site(step('AzureCLI', '2', { azureSubscription: 'prod' }, 2), 'Build/Job/step 2'),
        site(step('AzureCLI', '2', { azureSubscription: 'dev' }, 3), 'Build/Job/step 3'),
      ],
      VENDORED,
    );
    expect(connections.map((c) => c.name)).toEqual(['dev', 'prod']);
    expect(connections.find((c) => c.name === 'prod')?.usedBy).toEqual([
      'Build/Job/step 1',
      'Build/Job/step 2',
    ]);
  });

  it('refuses to invent a block for a macro-named connection', () => {
    // `ENDPOINT_DATA_$(azureSub)_SUBSCRIPTIONID` is a variable no task reads; the honest output is
    // a warning naming the step, not a block that cannot work.
    const { connections, warnings } = collectConnections(
      [site(step('AzureCLI', '2', { azureSubscription: '$(azureSub)' }))],
      VENDORED,
    );
    expect(connections).toEqual([]);
    expect(warnings.map((w) => w.code)).toContain('connection-macro-name');
    expect(warnings[0]?.message).toContain('Build/Job/step 1');
  });

  it('reports a missing required connection, which the expansion does not (C-E08-034)', () => {
    const { warnings } = collectConnections(
      [site(step('AzureCLI', '2', { scriptType: 'bash' }))],
      VENDORED,
    );
    expect(warnings.map((w) => w.code)).toContain('connection-missing');
  });

  it('contributes nothing for a task with no vendored declaration', () => {
    // Without the declaration there is no way to tell a connection input from a string one, and
    // guessing from the name would miss the case-differing spellings C-E08-035 records.
    const { connections, warnings } = collectConnections(
      [site(step('SomeMarketplaceTask', '1', { azureSubscription: 'prod' }))],
      VENDORED,
    );
    expect(connections).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('matches a patch-pinned task reference by its major (Name@major)', () => {
    const { connections } = collectConnections(
      [site(step('AzureCLI', '2.277.2', { azureSubscription: 'prod' }))],
      VENDORED,
    );
    expect(connections.map((c) => c.name)).toEqual(['prod']);
  });
});

describe('the local-session hazards (C-E08-038/039)', () => {
  it('warns once per task, whatever the step count', () => {
    const { warnings } = collectConnections(
      [
        site(step('AzureCLI', '2', { azureSubscription: 'prod' }, 1), 'Build/Job/step 1'),
        site(step('AzureCLI', '2', { azureSubscription: 'prod' }, 2), 'Build/Job/step 2'),
      ],
      VENDORED,
    );
    const clobber = warnings.filter((w) => w.code === 'local-session-clobber');
    expect(clobber).toHaveLength(1);
  });

  it('names `az account clear` for AzureCLI@2 (C-E08-038)', () => {
    const [warning] = localSessionWarnings([
      {
        value: 'prod',
        input: 'connectedServiceNameARM',
        endpointType: 'AzureRM',
        taskRef: 'AzureCLI@2',
        path: 'Build/Job/step 1',
      },
    ]);
    expect(warning?.message).toContain('az account clear');
    expect(warning?.message).toContain('useGlobalConfig');
  });

  it('names `Clear-AzContext -Scope CurrentUser` for AzurePowerShell@5, with no opt-out (C-E08-039)', () => {
    // The distinguishing fact: unlike AzureCLI@2's config-dir escape, nothing gates this one.
    const [warning] = localSessionWarnings([
      {
        value: 'prod',
        input: 'ConnectedServiceNameARM',
        endpointType: 'AzureRM',
        taskRef: 'AzurePowerShell@5',
        path: 'Build/Job/step 1',
      },
    ]);
    expect(warning?.message).toContain('Clear-AzContext -Scope CurrentUser -Force');
    expect(warning?.message).toContain('there is no input that opts out');
  });

  it('says nothing for a task reference carrying no version', () => {
    // `Name` with no `@version` cannot be matched to a registry entry keyed by `Name@major`, and
    // the honest answer is no hazard rather than a guessed one.
    expect(
      localSessionWarnings([
        {
          value: 'prod',
          input: 'connectedServiceNameARM',
          endpointType: 'AzureRM',
          taskRef: 'AzureCLI',
          path: 'Build/Job/step 1',
        },
      ]),
    ).toEqual([]);
  });

  it('records certificate support per task, not globally (C-E08-040)', () => {
    expect(REAL_TASK_ENDPOINT_USE['AzureCLI@2']?.certificateAuth).toBe(true);
    expect(REAL_TASK_ENDPOINT_USE['AzurePowerShell@5']?.certificateAuth).toBe(false);
  });
});

describe('the vendored snapshot loader (E08-S02-T01)', () => {
  it('reads the snapshots from the package’s own vendor directory', () => {
    expect(vendoredTasksDir().endsWith(join('vendor', 'tasks-meta'))).toBe(true);
    expect(Object.keys(VENDORED)).toContain('AzureCLI@2');
  });

  it('yields nothing rather than throwing when the directory is absent', () => {
    // A conversion should lose the connections it could not read, not fail outright — the vendor
    // test is what makes a broken snapshot loud.
    expect(loadVendoredTaskDefinitions(join(tmpdir(), 'azdo-emu-no-such-vendor-dir'))).toEqual({});
  });

  it('skips a directory that holds no readable task.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'azdo-emu-vendor-'));
    try {
      await mkdir(join(dir, 'Broken@1'), { recursive: true });
      await writeFile(join(dir, 'Broken@1', 'task.json'), 'not json at all');
      await mkdir(join(dir, 'Empty@1'), { recursive: true });
      expect(loadVendoredTaskDefinitions(dir)).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Docker@2: a different endpoint kind, and a different verdict (E08-S02-T02)', () => {
  const dockerStep = (inputs: Record<string, string>): Step =>
    ({
      id: 1,
      displayName: 'Docker build',
      task: { name: 'Docker', version: '2' },
      inputs,
    }) as Step;

  it('declares its connection as connectedService:dockerregistry, not required (C-E08-043)', () => {
    const input = VENDORED['Docker@2']?.inputs?.find((i) => i.name === 'containerRegistry');
    expect(input?.type).toBe('connectedService:dockerregistry');
    // A build-only pipeline needs no registry — which is why the mode rule below differs.
    expect(input?.required).toBeUndefined();
    expect(input?.aliases).toBeUndefined();
  });

  it('leaves the connection ambient, because Docker@2 only *accepts* an endpoint (C-E08-043)', () => {
    // The contrast with AzureCLI@2 is the point: forcing `sp` here would demand registry
    // credentials from a pipeline that builds locally and needs none (C-E08-005).
    const { connections } = collectConnections(
      [site(dockerStep({ containerRegistry: 'myreg', repository: 'app', command: 'build' }))],
      VENDORED,
    );
    expect(connections[0]).toMatchObject({
      name: 'myreg',
      mode: 'ambient',
      kind: 'dockerregistry',
    });
  });

  it('offers registry fields, never the AzureRM ones (C-E08-043/044/046)', () => {
    const keys = connectionKeys({ name: 'myreg', kind: 'dockerregistry', mode: 'sp' }).map(
      (entry) => entry.key,
    );
    // The four the generic provider reads out of the blob, plus ACR's login server…
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_myreg_USERNAME');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_myreg_PASSWORD');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_myreg_REGISTRY');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_myreg_EMAIL');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_myreg_LOGINSERVER');
    expect(keys).toContain('ENDPOINT_DATA_myreg_REGISTRYTYPE');
    // …and none of the AzureRM set, which nothing on this path reads.
    expect(keys).not.toContain('ENDPOINT_DATA_myreg_SUBSCRIPTIONID');
    expect(keys).not.toContain('ENDPOINT_AUTH_PARAMETER_myreg_SERVICEPRINCIPALID');
  });

  it('asks a registry connection for registrytype even in ambient mode (C-E08-046)', () => {
    const keys = connectionKeys({ name: 'myreg', kind: 'dockerregistry' }).map((e) => e.key);
    expect(keys).toEqual(['ENDPOINT_DATA_myreg_REGISTRYTYPE']);
  });

  it('warns about the unqualified image name, not about a clobbered session (C-E08-047/048)', () => {
    // Docker@2 restores the docker config it touched and guards deletion by temp-directory, so it
    // gets no session-clobber warning — the absence is measured, not an oversight.
    const { warnings } = collectConnections(
      [site(dockerStep({ containerRegistry: 'myreg', repository: 'app' }))],
      VENDORED,
    );
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain('local-task-delta');
    expect(codes).not.toContain('local-session-clobber');
    const delta = warnings.find((w) => w.code === 'local-task-delta');
    expect(delta?.message).toContain('~/.docker/config.json');
    expect(delta?.message).toContain('Docker Hub');
  });

  it('records Docker@2 as accepting, not requiring, an endpoint', () => {
    expect(REAL_TASK_ENDPOINT_USE['Docker@2']?.requiresEndpoint).toBe(false);
    expect(REAL_TASK_ENDPOINT_USE['AzureCLI@2']?.requiresEndpoint).toBe(true);
    // C-E08-048: checked and safe, so no hazard string — distinguishable from "never examined",
    // which is an absent registry entry.
    expect(REAL_TASK_ENDPOINT_USE['Docker@2']?.hazard).toBeUndefined();
  });
});

describe('Docker@2 per-step deltas, warned only when they can bite (E08-S02-T02)', () => {
  const dockerStep = (inputs: Record<string, string>): Step =>
    ({ id: 1, displayName: 'Docker', task: { name: 'Docker', version: '2' }, inputs }) as Step;
  const codes = (inputs: Record<string, string>): string[] =>
    dockerStepWarnings(dockerStep(inputs), 'Build/Job/step 1').map((w) => w.code);

  it('warns that the repository is lower-cased and de-spaced (C-E08-049)', () => {
    // Confirmed live: `E08 Parity` was pushed as `e08parity`.
    const warnings = dockerStepWarnings(
      dockerStep({ repository: 'E08 Parity', Dockerfile: 'src/Dockerfile' }),
      'Build/Job/step 1',
    );
    const named = warnings.find((w) => w.code === 'docker-image-name-normalized');
    expect(named?.message).toContain("'E08 Parity' is built and pushed as 'e08parity'");
  });

  it('stays quiet when the repository is already what docker will use', () => {
    // The warning exists to be read; emitting it for `myapp` would train the reader to skip it.
    expect(codes({ repository: 'myapp', Dockerfile: 'src/Dockerfile' })).not.toContain(
      'docker-image-name-normalized',
    );
  });

  it('does not guess at a macro repository', () => {
    expect(codes({ repository: '$(imageName)', Dockerfile: 'src/Dockerfile' })).not.toContain(
      'docker-image-name-normalized',
    );
  });

  it('warns that a Dockerfile glob takes the first match (C-E08-050)', () => {
    // Including the case that bites hardest: no input at all, where the default `**/Dockerfile`
    // is a glob the author never wrote and may not know about.
    const fromDefault = dockerStepWarnings(dockerStep({ repository: 'app' }), 'Build/Job/step 1');
    expect(fromDefault.find((w) => w.code === 'docker-dockerfile-glob')?.message).toContain(
      "its default Dockerfile pattern '**/Dockerfile'",
    );
    expect(codes({ repository: 'app', Dockerfile: '**/api/Dockerfile' })).toContain(
      'docker-dockerfile-glob',
    );
    // An exact path resolves to itself, so there is nothing to warn about.
    expect(codes({ repository: 'app', Dockerfile: 'src/Dockerfile' })).not.toContain(
      'docker-dockerfile-glob',
    );
  });

  it('does not warn about a Dockerfile for a command that does not build (C-E08-050)', () => {
    expect(codes({ command: 'push', repository: 'app' })).not.toContain('docker-dockerfile-glob');
    expect(codes({ command: 'login' })).toEqual([]);
  });

  it('warns that buildAndPush drops `arguments` (C-E08-052)', () => {
    // Only reachable from hand-written YAML — which is exactly what a converted pipeline is.
    expect(codes({ repository: 'app', arguments: '--no-cache', Dockerfile: 'D' })).toContain(
      'docker-arguments-ignored',
    );
    // `build` honours them, so no warning.
    expect(
      codes({ command: 'build', repository: 'app', arguments: '--no-cache', Dockerfile: 'D' }),
    ).not.toContain('docker-arguments-ignored');
  });

  it('warns that a comma inside `tags` is a separator, not a character (C-E08-051)', () => {
    const warnings = dockerStepWarnings(
      dockerStep({ repository: 'app', Dockerfile: 'D', tags: '1.0.0,latest' }),
      'Build/Job/step 1',
    );
    expect(warnings.find((w) => w.code === 'docker-tags-split')?.message).toContain(
      '2 separate tags',
    );
    expect(codes({ repository: 'app', Dockerfile: 'D', tags: '1.0.0' })).not.toContain(
      'docker-tags-split',
    );
  });

  it('says nothing at all about a task that is not Docker@2', () => {
    const step = {
      ...dockerStep({ repository: 'App Name' }),
      task: { name: 'CopyFiles', version: '2' },
    } as Step;
    expect(dockerStepWarnings(step, 'Build/Job/step 1')).toEqual([]);
  });
});

describe('the prerequisites both tasks need from the runtime (C-E08-042)', () => {
  it('`Agent.TempDirectory` is seeded before any step, so neither task trips on it', () => {
    // `AzurePowerShell@5` calls `tl.checkPath` on `agent.tempDirectory` and *throws* when it is
    // unset; `AzureCLI@2` warns and falls back to the global az config dir — which is the very
    // profile C-E08-038 clears. Asserted here rather than left as prose, so a change to the
    // entry-point seeding shows up as a failure against the tasks that depend on it.
    const { pipeline } = buildPipeline(
      parsePipelineYaml(
        'stages:\n- stage: Deploy\n  jobs:\n  - job: deploy\n    steps:\n' +
          '    - task: AzureCLI@2\n      inputs:\n        azureSubscription: prod\n',
        'pipeline.expanded.yml',
      ),
    );
    const plan = scaffold(pipeline!);
    const emitted = [...emitEntrypoints(pipeline!, plan, 'pipeline.expanded.yml', [], [])]
      .map(([, content]) => content)
      .join('\n');
    expect(emitted).toContain("azdo_var_set 'Agent.TempDirectory'");
  });
});
