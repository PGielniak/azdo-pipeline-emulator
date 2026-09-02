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

export interface ServiceConnection {
  /** The connection name as the pipeline writes it — interpolated verbatim (C-E08-001). */
  readonly name: string;
  readonly mode?: ConnectionMode;
  readonly scheme?: ConnectionScheme;
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

const DATA_FIELDS: readonly [string, string][] = [
  ['SubscriptionID', 'the Azure subscription the pipeline deploys into'],
  ['environment', "'AzureCloud' unless you are on a sovereign cloud"],
];

/** Every key a connection contributes, in emission order. */
export function connectionKeys(connection: ServiceConnection): readonly EnvKey[] {
  const mode = connection.mode ?? 'ambient';
  const scheme = connection.scheme ?? 'serviceprincipal';
  const keys: EnvKey[] = DATA_FIELDS.map(([field, comment]) => ({
    key: dataKey(connection.name, field),
    secret: false,
    comment,
  }));

  // C-E08-005: ambient reuses the developer's own `az`/`docker`/`kubectl` session, so there is no
  // credential to ask for — asking anyway would be the emulator inventing work for the user.
  if (mode === 'ambient') return keys;

  keys.push({
    key: schemeKey(connection.name),
    secret: true,
    comment: `the endpoint scheme — '${scheme}'`,
  });
  for (const [field, comment] of SCHEME_AUTH_FIELDS[scheme]) {
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
