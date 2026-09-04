/**
 * The service-connection `.env` contract (E08-S01-T01).
 *
 * A converted pipeline cannot use the org's service connections — they are server-side secrets — so
 * the generated project asks for what it needs in `.env`, under **exactly the names a real task
 * reads** (C-E08-001). Getting those names right is the whole task: a task calls
 * `getEndpointAuthorizationParameter(connection, 'tenantid')`, and if our key is spelled differently
 * the task sees nothing and fails in a way that looks like a missing credential.
 *
 * Three measured details shape the generator:
 *
 *  - **The key is upper-cased; the connection name is not** (C-E08-001). `'ENDPOINT_AUTH_PARAMETER_'
 *    + id + '_' + key.toUpperCase()` — so `MyProd-Sub` stays `MyProd-Sub`. Upper-casing the whole
 *    name would emit a variable no task ever reads.
 *  - **Auth values are secrets, data values are not** (C-E08-002). task-lib vaults every
 *    `ENDPOINT_AUTH_*` and deletes it from `process.env`; `ENDPOINT_DATA_*` stays. That split is
 *    reproduced in the emitted comments, so a reader knows which lines hold a credential.
 *  - **The scheme decides which fields exist** (C-E08-004). Emitting every field for every
 *    connection would ask a user to fill in credentials their connection does not have.
 *
 * `ambient` mode (C-E08-005) is ours, not a service behavior: a developer converting their own
 * pipeline is usually already logged in to `az`, so the default emits no credential fields at all.
 */

/** How a connection authenticates locally. `ambient` reuses the developer's own session. */
export type ConnectionMode = 'ambient' | 'sp';

/** C-E08-004: the schemes a generated block can be shaped for. */
export type ConnectionScheme = 'serviceprincipal' | 'workloadidentityfederation';

/**
 * The endpoint *kind*, as the consuming task's `task.json` declares it after `connectedService:`.
 *
 * E08-S02-T02 forced this distinction. `Docker@2` declares `connectedService:dockerregistry`
 * (C-E08-043), and a registry connection reads none of the AzureRM fields — offering it
 * `ENDPOINT_DATA_<name>_SUBSCRIPTIONID` asks for a value nothing will ever read, which is exactly
 * the failure C-E08-001 exists to prevent. Kinds are lower-cased because the declared spelling
 * differs between tasks (`AzureRM` vs `dockerregistry`) while the endpoint itself does not.
 */
export type ConnectionKind = 'azurerm' | 'dockerregistry' | 'kubernetes' | 'unknown';

/**
 * Normalize a declared `connectedService:<kind>` suffix.
 *
 * **`unknown` is deliberate, and it replaces a fallback that was safe with one kind and is a bug
 * generator with three** (docs/06 §5 decision 78). Until E08-S02-T03 this function answered
 * `azurerm` for anything it did not recognize, which was harmless while AzureRM was the only kind
 * anyone reached. With `dockerregistry` and `kubernetes` alongside it, that same fallback would
 * offer a `connectedService:github` connection `ENDPOINT_DATA_<name>_SUBSCRIPTIONID` — a variable no
 * task reads, which is C-E08-001's failure mode wearing a third costume. An unrecognized kind now
 * contributes **no** fields and the collector says so out loud, because "we have not read that
 * task's source" is a thing the user can act on and a wrong subscription field is not.
 */
export function connectionKind(endpointType: string | undefined): ConnectionKind {
  switch (endpointType?.toLowerCase()) {
    case 'azurerm':
      return 'azurerm';
    case 'dockerregistry':
      return 'dockerregistry';
    // C-E08-053: `Kubernetes@1`, `KubernetesManifest@1` and `HelmDeploy@0` all spell it lowercase.
    case 'kubernetes':
      return 'kubernetes';
    default:
      return 'unknown';
  }
}

export interface ServiceConnection {
  /** The connection name as the pipeline writes it — interpolated verbatim (C-E08-001). */
  readonly name: string;
  readonly mode?: ConnectionMode;
  readonly scheme?: ConnectionScheme;
  /** C-E08-043: which endpoint kind this is. Defaults to `azurerm`, the kind E08-S01 was built on. */
  readonly kind?: ConnectionKind;
  /**
   * Whether a consuming task accepts `spnCertificate` at all. Defaults to true.
   *
   * C-E08-040: `AzurePowerShell@5` on a non-Windows host throws "Only SPNKey auth type is supported
   * for ServicePrincipal auth scheme using non windows agent." Offering the PEM field anyway would
   * ask the user to fill in a credential the task refuses — the `.env.example` would be asking for
   * work that cannot pay off.
   */
  readonly certificateAuth?: boolean;
  /** Where in the pipeline this connection was referenced, for the provenance comment. */
  readonly usedBy?: readonly string[];
}

export interface EnvKey {
  readonly key: string;
  /** C-E08-002: an auth value is vaulted and removed from `process.env`; a data value is not. */
  readonly secret: boolean;
  readonly comment: string;
}

/** C-E08-001: `ENDPOINT_AUTH_SCHEME_<id>` — vaulted. */
export function schemeKey(connection: string): string {
  return `ENDPOINT_AUTH_SCHEME_${connection}`;
}

/** C-E08-001: `ENDPOINT_AUTH_PARAMETER_<id>_<KEY>` — the key upper-cased, the name verbatim. */
export function authKey(connection: string, field: string): string {
  return `ENDPOINT_AUTH_PARAMETER_${connection}_${field.toUpperCase()}`;
}

/** C-E08-001: `ENDPOINT_DATA_<id>_<KEY>` — read straight from `process.env`, never vaulted. */
export function dataKey(connection: string, field: string): string {
  return `ENDPOINT_DATA_${connection}_${field.toUpperCase()}`;
}

/**
 * C-E08-055: `ENDPOINT_URL_<id>` — the **fifth** endpoint variable family, and the first one that is
 * neither auth nor data.
 *
 * `getEndpointUrl(id, optional)` reads it directly, and `createKubeconfig` puts the result in the
 * kubeconfig's `clusters[0].cluster.server`. Nothing before E08-S02-T03 emitted it, so a
 * ServiceAccount-authorized Kubernetes connection would have produced a kubeconfig pointing at
 * `null` — a cluster address of literally nothing, which fails as a connection refusal rather than
 * as a missing credential.
 */
export function urlKey(connection: string): string {
  return `ENDPOINT_URL_${connection}`;
}

/**
 * The fields each scheme actually uses, named as `AzureCLIV2` reads them (C-E08-003/004).
 *
 * `serviceprincipalkey` and `servicePrincipalCertificate` are alternatives selected by
 * `authenticationType`, so both are offered and the comment says only one is needed.
 */
const SCHEME_AUTH_FIELDS: Readonly<Record<ConnectionScheme, readonly [string, string][]>> = {
  serviceprincipal: [
    ['serviceprincipalid', 'the application (client) id'],
    ['tenantid', 'the Entra tenant id'],
    ['authenticationType', "'spnKey' (default) or 'spnCertificate'"],
    ['serviceprincipalkey', 'the client secret — only for authenticationType=spnKey'],
    ['servicePrincipalCertificate', 'PEM contents — only for authenticationType=spnCertificate'],
  ],
  workloadidentityfederation: [
    ['serviceprincipalid', 'the application (client) id'],
    ['tenantid', 'the Entra tenant id'],
    ['idToken', 'the federated token; short-lived, so a local run usually prefers mode: ambient'],
  ],
};

const DATA_FIELDS: Readonly<Record<ConnectionKind, readonly [string, string][]>> = {
  azurerm: [
    ['SubscriptionID', 'the Azure subscription the pipeline deploys into'],
    ['environment', "'AzureCloud' unless you are on a sovereign cloud"],
  ],
  // C-E08-046: `registrytype` is what selects the ACR arm from the generic one, and the task reads
  // it as a *data* parameter, so it is not a secret.
  dockerregistry: [
    ['registrytype', "'ACR' for Azure Container Registry, anything else for generic"],
  ],
  // C-E08-054: `generickubernetescluster.getKubeConfig` branches on this one data parameter, read
  // optionally — an empty value takes the same arm as `Kubeconfig`.
  kubernetes: [
    [
      'authorizationType',
      "'Kubeconfig' (the default, and what an empty value means), 'ServiceAccount' or " +
        "'AzureSubscription'",
    ],
  ],
  // C-E08-053: an endpoint kind whose consuming task nobody has read contributes no fields; see
  // `connectionKind`.
  unknown: [],
};

/**
 * A Kubernetes connection's fields, per `authorizationType` arm (C-E08-054..057).
 *
 * Both arms are emitted, because the arm is chosen by a value the user fills in below rather than by
 * anything the pipeline declares — the task reads `authorizationType` at run time. Each line says
 * which arm needs it, so nobody fills in all five.
 */
const KUBERNETES_AUTH_FIELDS: readonly [string, string][] = [
  [
    'kubeconfig',
    'authorizationType=Kubeconfig: the whole kubeconfig document. `.env` is sourced by bash, so ' +
      'this can be a single-quoted multi-line value — or, far easier, ' +
      '"$(cat "$HOME/.kube/config")" (C-E08-056)',
  ],
  [
    'clusterContext',
    'authorizationType=Kubeconfig, optional: the context to select. Left empty, the kubeconfig is ' +
      'passed through byte-for-byte and its own `current-context` wins (C-E08-057)',
  ],
  [
    'apiToken',
    'authorizationType=ServiceAccount: the service-account token, **base64-encoded** — the task ' +
      'decodes it, so a raw token arrives as binary garbage (C-E08-058)',
  ],
  [
    'serviceAccountCertificate',
    'authorizationType=ServiceAccount: the cluster CA, base64 as it appears under ' +
      '`certificate-authority-data` in a kubeconfig',
  ],
];

/**
 * A Docker registry connection's credentials (C-E08-044).
 *
 * These are **not** `ENDPOINT_AUTH_PARAMETER_*` fields. `GenericAuthenticationTokenProvider` reads
 * them out of the `ENDPOINT_AUTH_<name>` JSON blob, under **lowercase** keys — so the per-key
 * variables are emitted for the user to fill in and the runtime derives the blob from them
 * (`azdo_sc_endpoint_auth_json`). Keeping the user-facing surface `NAME=value` matters: `.env` is
 * documented as a trusted Bash assignment file, and hand-written JSON does not belong in one.
 */
const REGISTRY_BLOB_FIELDS: readonly [string, string][] = [
  ['username', 'the registry user name'],
  ['password', 'the registry password or access token'],
  ['registry', 'the registry login server, e.g. https://index.docker.io/v1/ or myreg.azurecr.io'],
  ['email', 'the account e-mail; registries that do not use one accept an empty value'],
];

/** C-E08-046: the ACR arm needs `loginServer` on top of the service-principal fields. */
const ACR_AUTH_FIELDS: readonly [string, string][] = [
  ['loginServer', 'the ACR login server, e.g. myreg.azurecr.io — required for registrytype=ACR'],
];

/** Every key a connection contributes, in emission order. */
export function connectionKeys(connection: ServiceConnection): readonly EnvKey[] {
  const mode = connection.mode ?? 'ambient';
  const scheme = connection.scheme ?? 'serviceprincipal';
  const kind = connection.kind ?? 'azurerm';
  const keys: EnvKey[] = DATA_FIELDS[kind].map(([field, comment]) => ({
    key: dataKey(connection.name, field),
    secret: false,
    comment,
  }));

  // C-E08-005: ambient reuses the developer's own `az`/`docker`/`kubectl` session, so there is no
  // credential to ask for — asking anyway would be the emulator inventing work for the user.
  if (mode === 'ambient') return keys;

  if (kind === 'kubernetes') {
    // C-E08-055: the server address is its own family, and it is not a secret — `getEndpointUrl`
    // reads `process.env` directly, with none of the vaulting `ENDPOINT_AUTH_*` gets (C-E08-002).
    keys.push({
      key: urlKey(connection.name),
      secret: false,
      comment:
        'authorizationType=ServiceAccount: the API server URL, e.g. https://my-cluster:6443 — it ' +
        "becomes the kubeconfig's `clusters[0].cluster.server` (C-E08-055)",
    });
    for (const [field, comment] of KUBERNETES_AUTH_FIELDS) {
      keys.push({ key: authKey(connection.name, field), secret: true, comment });
    }
    return keys;
  }

  // C-E08-053: nothing is known about this endpoint's field set, so nothing is asked for.
  if (kind === 'unknown') return keys;

  if (kind === 'dockerregistry') {
    // C-E08-044: the generic provider reads these from the JSON blob, so they are emitted per key
    // and assembled at run time. The blob itself is never a `.env` line.
    for (const [field, comment] of REGISTRY_BLOB_FIELDS) {
      keys.push({ key: authKey(connection.name, field), secret: true, comment });
    }
    // C-E08-046: ACR authenticates as a service principal *and* needs its login server, so both
    // sets are offered with the comment saying which `registrytype` uses which.
    for (const [field, comment] of ACR_AUTH_FIELDS) {
      keys.push({ key: authKey(connection.name, field), secret: true, comment });
    }
    return keys;
  }

  keys.push({
    key: schemeKey(connection.name),
    secret: true,
    comment: `the endpoint scheme — '${scheme}'`,
  });
  const certificateAuth = connection.certificateAuth ?? true;
  for (const [field, comment] of SCHEME_AUTH_FIELDS[scheme]) {
    // C-E08-040: drop both certificate-only lines when no consumer accepts a certificate, and say
    // so on the `authenticationType` line rather than leaving a silently narrowed choice.
    if (!certificateAuth && field === 'servicePrincipalCertificate') continue;
    if (!certificateAuth && field === 'authenticationType') {
      keys.push({
        key: authKey(connection.name, field),
        secret: true,
        comment: "'spnKey' — a consuming task rejects spnCertificate on this host (C-E08-040)",
      });
      continue;
    }
    keys.push({ key: authKey(connection.name, field), secret: true, comment });
  }
  return keys;
}

/**
 * Render one connection's `.env.example` block.
 *
 * Provenance is a comment, not a guess: the block says which steps referenced the connection, so a
 * user filling in a credential can see what it is for without reading the pipeline.
 */
export function connectionBlock(connection: ServiceConnection): readonly string[] {
  const mode = connection.mode ?? 'ambient';
  const lines = [`# ── Service connection '${connection.name}' · mode: ${mode} ` + '─'.repeat(8)];
  if (connection.usedBy !== undefined && connection.usedBy.length > 0) {
    lines.push(`# used by: ${[...connection.usedBy].sort().join(', ')}`);
  }
  if (mode === 'ambient') {
    lines.push(
      '# Ambient mode reuses the session you already have — `az login`, `docker login`, your',
      '# kubeconfig. No credentials are requested here. Switch to `mode: sp` in azdo-emu.yaml if',
      '# you need this connection to authenticate on its own.',
    );
  } else {
    lines.push(
      '# Explicit service-principal mode. These names are the ones the real task reads, so a value',
      '# put here reaches it exactly as the service would have supplied it.',
    );
  }

  for (const entry of connectionKeys(connection)) {
    lines.push(`# ${entry.comment}${entry.secret ? ' (secret — never commit .env)' : ''}`);
    lines.push(`${entry.key}=`);
  }
  return lines;
}

export interface ConnectionManifestEntry {
  readonly name: string;
  readonly mode: ConnectionMode;
  readonly scheme: ConnectionScheme;
  readonly keys: readonly string[];
  readonly secretKeys: readonly string[];
}

/**
 * What the manifest records for a connection.
 *
 * The key list is the machine-readable half of the same contract the `.env.example` block states in
 * prose, so `doctor` can check a `.env` against it without re-deriving the names.
 */
export function connectionManifestEntry(connection: ServiceConnection): ConnectionManifestEntry {
  const keys = connectionKeys(connection);
  return {
    name: connection.name,
    mode: connection.mode ?? 'ambient',
    scheme: connection.scheme ?? 'serviceprincipal',
    keys: keys.map((entry) => entry.key),
    secretKeys: keys.filter((entry) => entry.secret).map((entry) => entry.key),
  };
}

/** The whole `.env.example` section for a pipeline's connections, sorted by name. */
export function connectionsSection(connections: readonly ServiceConnection[]): readonly string[] {
  if (connections.length === 0) return [];
  const sorted = [...connections].sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    '# Service connections',
    '#',
    '# Each block below names the environment variables the real task reads for that connection',
    '# (ENDPOINT_AUTH_* and ENDPOINT_DATA_*). The connection name is used verbatim — case and all —',
    '# because that is how the task spells it.',
    '',
  ];
  for (const connection of sorted) {
    lines.push(...connectionBlock(connection), '');
  }
  return lines;
}
