import { describe, expect, it } from 'vitest';
import {
  authKey,
  connectionBlock,
  connectionKeys,
  connectionManifestEntry,
  connectionsSection,
  dataKey,
  connectionKind,
  schemeKey,
  urlKey,
  type ServiceConnection,
} from '../src/service-connection.js';

describe('the env-key contract (C-E08-001)', () => {
  it('upper-cases the key but leaves the connection name verbatim', () => {
    // `'ENDPOINT_AUTH_PARAMETER_' + id + '_' + key.toUpperCase()` — upper-casing the whole name
    // would emit a variable no task ever reads.
    expect(authKey('MyProd-Sub', 'tenantid')).toBe('ENDPOINT_AUTH_PARAMETER_MyProd-Sub_TENANTID');
    expect(dataKey('MyProd-Sub', 'SubscriptionID')).toBe('ENDPOINT_DATA_MyProd-Sub_SUBSCRIPTIONID');
    expect(schemeKey('MyProd-Sub')).toBe('ENDPOINT_AUTH_SCHEME_MyProd-Sub');
  });

  it('spells the AzureCLIV2 field names exactly as the task reads them (C-E08-003)', () => {
    const keys = connectionKeys({ name: 'azure', mode: 'sp' }).map((entry) => entry.key);
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_azure_SERVICEPRINCIPALID');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_azure_TENANTID');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_azure_SERVICEPRINCIPALKEY');
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_azure_AUTHENTICATIONTYPE');
    expect(keys).toContain('ENDPOINT_DATA_azure_SUBSCRIPTIONID');
    expect(keys).toContain('ENDPOINT_DATA_azure_ENVIRONMENT');
  });
});

describe('secret marking follows task-lib, not intuition (C-E08-002)', () => {
  it('marks every ENDPOINT_AUTH_* secret and no ENDPOINT_DATA_*', () => {
    // task-lib vaults the AUTH family and deletes it from process.env; DATA stays visible. A
    // subscription id is not a credential and marking it secret would train the reader to ignore
    // the marker.
    for (const entry of connectionKeys({ name: 'azure', mode: 'sp' })) {
      expect(entry.secret).toBe(entry.key.startsWith('ENDPOINT_AUTH_'));
    }
  });
});

describe('ambient mode asks for nothing (C-E08-005)', () => {
  it('emits the data keys but no credential at all', () => {
    const keys = connectionKeys({ name: 'azure' });
    expect(keys.map((entry) => entry.key)).toEqual([
      'ENDPOINT_DATA_azure_SUBSCRIPTIONID',
      'ENDPOINT_DATA_azure_ENVIRONMENT',
    ]);
    expect(keys.every((entry) => !entry.secret)).toBe(true);
  });

  it('is the default, and says how to leave it', () => {
    const block = connectionBlock({ name: 'azure' }).join('\n');
    expect(block).toContain('mode: ambient');
    expect(block).toContain('`az login`');
    expect(block).toContain('Switch to `mode: sp`');
  });
});

describe('the scheme decides which fields exist (C-E08-004)', () => {
  it('offers both credential shapes for serviceprincipal, saying only one is needed', () => {
    const block = connectionBlock({ name: 'azure', mode: 'sp', scheme: 'serviceprincipal' }).join(
      '\n',
    );
    expect(block).toContain('only for authenticationType=spnKey');
    expect(block).toContain('only for authenticationType=spnCertificate');
  });

  it('asks for an idToken under federation, not a client secret', () => {
    // Emitting every field for every scheme would ask a user to fill in credentials their
    // connection does not have.
    const keys = connectionKeys({
      name: 'azure',
      mode: 'sp',
      scheme: 'workloadidentityfederation',
    }).map((entry) => entry.key);
    expect(keys).toContain('ENDPOINT_AUTH_PARAMETER_azure_IDTOKEN');
    expect(keys).not.toContain('ENDPOINT_AUTH_PARAMETER_azure_SERVICEPRINCIPALKEY');
  });

  it('notes that a federated token is short-lived, so ambient is usually better locally', () => {
    expect(
      connectionBlock({ name: 'azure', mode: 'sp', scheme: 'workloadidentityfederation' }).join(
        '\n',
      ),
    ).toContain('short-lived');
  });
});

describe('provenance and rendering', () => {
  it('names the steps that referenced the connection, sorted', () => {
    const block = connectionBlock({
      name: 'azure',
      usedBy: ['030-deploy.sh', '010-login.sh'],
    }).join('\n');
    expect(block).toContain('# used by: 010-login.sh, 030-deploy.sh');
  });

  it('omits the provenance line when nothing is recorded', () => {
    expect(connectionBlock({ name: 'azure' }).join('\n')).not.toContain('used by:');
    expect(connectionBlock({ name: 'azure', usedBy: [] }).join('\n')).not.toContain('used by:');
  });

  it('marks a secret line and leaves a data line unmarked', () => {
    const block = connectionBlock({ name: 'azure', mode: 'sp' }).join('\n');
    expect(block).toContain('(secret — never commit .env)');
    const dataLine = block
      .split('\n')
      .find((line) => line.includes('the Azure subscription the pipeline deploys into'));
    expect(dataLine).not.toContain('secret');
  });

  it('writes an assignable `KEY=` line for every key', () => {
    const block = connectionBlock({ name: 'azure', mode: 'sp' });
    for (const entry of connectionKeys({ name: 'azure', mode: 'sp' })) {
      expect(block).toContain(`${entry.key}=`);
    }
  });
});

describe('connectionsSection', () => {
  it('is empty when the pipeline uses no connections', () => {
    expect(connectionsSection([])).toEqual([]);
  });

  it('sorts blocks by name so the file is stable across converts', () => {
    const section = connectionsSection([{ name: 'zeta' }, { name: 'alpha' }]).join('\n');
    expect(section.indexOf("'alpha'")).toBeLessThan(section.indexOf("'zeta'"));
  });

  it('explains the verbatim-name rule once, at the top', () => {
    const section = connectionsSection([{ name: 'azure' }]).join('\n');
    expect(section).toContain('used verbatim — case and all');
  });
});

describe('connectionManifestEntry', () => {
  it('records the same contract the block states in prose', () => {
    const connection: ServiceConnection = { name: 'azure', mode: 'sp' };
    const entry = connectionManifestEntry(connection);
    expect(entry).toMatchObject({ name: 'azure', mode: 'sp', scheme: 'serviceprincipal' });
    // doctor checks a .env against this without re-deriving the names.
    expect(entry.keys).toEqual(connectionKeys(connection).map((key) => key.key));
    expect(entry.secretKeys.every((key) => key.startsWith('ENDPOINT_AUTH_'))).toBe(true);
  });

  it('defaults mode and scheme so the manifest is never ambiguous', () => {
    expect(connectionManifestEntry({ name: 'azure' })).toMatchObject({
      mode: 'ambient',
      scheme: 'serviceprincipal',
      secretKeys: [],
    });
  });
});

describe('the Kubernetes endpoint kind (E08-S02-T03)', () => {
  it('recognises the lowercase spelling all three tasks declare (C-E08-053)', () => {
    expect(connectionKind('kubernetes')).toBe('kubernetes');
    expect(connectionKind('AzureRM')).toBe('azurerm');
    expect(connectionKind('dockerRegistry')).toBe('dockerregistry');
  });

  it('answers `unknown` rather than guessing AzureRM (C-E08-053)', () => {
    // The pre-E08-S02-T03 fallback returned `azurerm` here, which offered a GitHub connection a
    // subscription id — C-E08-001's failure mode in a third costume.
    expect(connectionKind('github')).toBe('unknown');
    expect(connectionKind(undefined)).toBe('unknown');
    expect(connectionKeys({ name: 'gh', mode: 'sp', kind: 'unknown' })).toEqual([]);
  });

  it('emits the URL family, which nothing before this task did (C-E08-055)', () => {
    expect(urlKey('my-cluster')).toBe('ENDPOINT_URL_my-cluster');
    const keys = connectionKeys({ name: 'my-cluster', mode: 'sp', kind: 'kubernetes' });
    const url = keys.find((key) => key.key === urlKey('my-cluster'));
    expect(url).toBeDefined();
    // `getEndpointUrl` reads process.env directly — none of the vaulting ENDPOINT_AUTH_* gets.
    expect(url?.secret).toBe(false);
  });

  it('offers both authorizationType arms, each labelled with the arm that needs it', () => {
    const keys = connectionKeys({ name: 'k8s', mode: 'sp', kind: 'kubernetes' });
    const byKey = new Map(keys.map((key) => [key.key, key]));
    expect(byKey.get(dataKey('k8s', 'authorizationType'))?.secret).toBe(false);
    expect([...byKey.keys()]).toEqual([
      'ENDPOINT_DATA_k8s_AUTHORIZATIONTYPE',
      'ENDPOINT_URL_k8s',
      'ENDPOINT_AUTH_PARAMETER_k8s_KUBECONFIG',
      'ENDPOINT_AUTH_PARAMETER_k8s_CLUSTERCONTEXT',
      'ENDPOINT_AUTH_PARAMETER_k8s_APITOKEN',
      'ENDPOINT_AUTH_PARAMETER_k8s_SERVICEACCOUNTCERTIFICATE',
    ]);
    // C-E08-058: a raw token pasted here arrives at the cluster as decoded binary.
    expect(byKey.get(authKey('k8s', 'apiToken'))?.comment).toContain('base64');
    // C-E08-056: the multi-line answer, because `.env` is sourced by bash.
    expect(byKey.get(authKey('k8s', 'kubeconfig'))?.comment).toContain('cat');
  });

  it('asks for nothing in ambient mode, exactly as the other kinds do (C-E08-005)', () => {
    const keys = connectionKeys({ name: 'k8s', kind: 'kubernetes' });
    expect(keys.map((key) => key.key)).toEqual(['ENDPOINT_DATA_k8s_AUTHORIZATIONTYPE']);
  });

  it('renders a block a reader can fill in without opening the pipeline', () => {
    const block = connectionBlock({
      name: 'prod-cluster',
      mode: 'sp',
      kind: 'kubernetes',
      usedBy: ['Deploy/Apply/step 1'],
    }).join('\n');
    expect(block).toContain("Service connection 'prod-cluster' · mode: sp");
    expect(block).toContain('used by: Deploy/Apply/step 1');
    expect(block).toContain('ENDPOINT_URL_prod-cluster=');
  });
});
