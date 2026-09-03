import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPipeline, parsePipelineYaml, type Step } from '@azdo-emu/engine';

import {
  collectConnections,
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
