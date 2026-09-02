/**
 * Oracle client — Azure DevOps Pipelines *preview* endpoint (E00-S03-T02).
 *
 * The preview endpoint is this project's parity oracle (PLAN D6, docs/02 §8): it returns the
 * service's own fully expanded YAML for an arbitrary payload, so engine behaviour is verified
 * against the real service instead of guessed.
 *
 * Grounding: C-E00-017 (route), C-E00-018/022 (body + response), C-E00-020 (auth),
 * C-E00-023..027 (failure modes, all established by live experiment — see
 * research/experiments/oracle-spike/).
 */

/** Canonical api-version moniker for the preview operation (C-E00-017). */
export const DEFAULT_API_VERSION = '7.1';

/** Environment variables the oracle reads, in the order the runbook documents them. */
export const ORACLE_ENV_VARS = [
  'AZDO_ORG_URL',
  'AZDO_PROJECT',
  'AZDO_ORACLE_PIPELINE_ID',
  'AZDO_PAT',
] as const;

export interface OracleConfig {
  /** e.g. `https://dev.azure.com/{org}` — no trailing slash required. */
  readonly orgUrl: string;
  readonly project: string;
  readonly pipelineId: number;
  readonly pat: string;
  readonly apiVersion: string;
}

export interface PreviewRequest {
  /** The pipeline YAML to expand. Must be non-empty — see {@link OracleUsageError}. */
  readonly yamlOverride: string;
  readonly templateParameters?: Readonly<Record<string, string>>;
  readonly stagesToSkip?: readonly string[];
}

/**
 * Result of a preview call. Every failure the live service actually produces has its own
 * variant, because they are not distinguishable by status code alone (C-E00-025/026).
 */
export type PreviewOutcome =
  | { readonly kind: 'expanded'; readonly status: number; readonly finalYaml: string }
  | {
      readonly kind: 'rejected';
      readonly status: number;
      readonly message: string;
      readonly typeKey: string | undefined;
      readonly body: unknown;
    }
  | {
      readonly kind: 'unauthenticated';
      readonly status: number;
      readonly signinUrl: string | undefined;
    }
  | { readonly kind: 'transport'; readonly status: number; readonly body: string };

/** Misuse of the client itself (bad config, empty override) — never a service response. */
export class OracleUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OracleUsageError';
  }
}

/**
 * Build the preview URL (C-E00-017). `pipelineId` is a required *path* parameter: the endpoint
 * is addressed per pipeline, which is the only reason the anchor pipeline definition exists.
 */
export function previewUrl(config: OracleConfig): string {
  const org = config.orgUrl.replace(/\/+$/, '');
  return (
    `${org}/${encodeURIComponent(config.project)}` +
    `/_apis/pipelines/${config.pipelineId}/preview?api-version=${config.apiVersion}`
  );
}

/**
 * A PAT authenticates as HTTP Basic with an **empty username** (C-E00-020):
 * `Authorization: Basic base64(":" + pat)`.
 */
export function authorizationHeader(pat: string): string {
  return `Basic ${Buffer.from(`:${pat}`, 'utf8').toString('base64')}`;
}

export function configFromEnv(env: Readonly<Record<string, string | undefined>>): OracleConfig {
  const missing = ORACLE_ENV_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new OracleUsageError(
      `oracle is not configured: missing ${missing.join(', ')}. ` +
        `Follow research/oracle-setup.md, then create .env.oracle at the repo root.`,
    );
  }

  const rawId = env.AZDO_ORACLE_PIPELINE_ID as string;
  const pipelineId = Number(rawId);
  if (!Number.isInteger(pipelineId) || pipelineId <= 0) {
    throw new OracleUsageError(
      `AZDO_ORACLE_PIPELINE_ID must be a positive integer, got ${JSON.stringify(rawId)}`,
    );
  }

  return {
    orgUrl: env.AZDO_ORG_URL as string,
    project: env.AZDO_PROJECT as string,
    pipelineId,
    pat: env.AZDO_PAT as string,
    apiVersion: env.AZDO_API_VERSION ?? DEFAULT_API_VERSION,
  };
}

/** The `fetch` seam every caller injects in tests (E11-S03-T01 drives the drift harness through it). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * POST `{previewRun: true, yamlOverride}` and classify the outcome (C-E00-018).
 *
 * Two behaviours here are counter-intuitive and are the reason this is a typed client rather
 * than an inline fetch:
 *
 * - **Redirects must not be followed** (`redirect: 'manual'`). An invalid PAT does not produce
 *   401/403; the service answers 302 towards a sign-in page, so a redirect-following client
 *   reports a cheerful 200 with an HTML login form (C-E00-025).
 * - **An empty `yamlOverride` is not an error.** The service falls back to the pipeline's
 *   committed YAML and returns 200, so a bug that empties the override yields a valid-looking
 *   expansion *of the wrong pipeline* (C-E00-024). We reject it before it reaches the wire.
 */
export async function preview(
  config: OracleConfig,
  request: PreviewRequest,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<PreviewOutcome> {
  if (request.yamlOverride.length === 0) {
    throw new OracleUsageError(
      'yamlOverride is empty; the service would silently expand the anchor pipeline instead (C-E00-024)',
    );
  }

  const response = await fetchImpl(previewUrl(config), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: authorizationHeader(config.pat),
    },
    body: JSON.stringify({
      previewRun: true,
      yamlOverride: request.yamlOverride,
      ...(request.templateParameters ? { templateParameters: request.templateParameters } : {}),
      ...(request.stagesToSkip ? { stagesToSkip: request.stagesToSkip } : {}),
    }),
  });

  const status = response.status;

  // 302 -> sign-in: bad or expired PAT (C-E00-025). `redirect: 'manual'` also surfaces as an
  // opaqueredirect response (status 0) under some fetch implementations.
  if (status === 0 || (status >= 300 && status < 400)) {
    return {
      kind: 'unauthenticated',
      status,
      signinUrl: response.headers.get('location') ?? undefined,
    };
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { kind: 'transport', status, body: text };
  }

  if (response.ok) {
    const finalYaml = (parsed as { finalYaml?: unknown }).finalYaml;
    if (typeof finalYaml !== 'string') {
      return { kind: 'transport', status, body: text };
    }
    return { kind: 'expanded', status, finalYaml };
  }

  // Validation failures are 400; a *nonexistent pipelineId* is 500, not 404 (C-E00-026).
  const body = parsed as { message?: unknown; typeKey?: unknown };
  return {
    kind: 'rejected',
    status,
    message: typeof body.message === 'string' ? body.message : text,
    typeKey: typeof body.typeKey === 'string' ? body.typeKey : undefined,
    body: parsed,
  };
}

const PAT_PATTERN = /[A-Za-z0-9]{75}AZDO[A-Za-z0-9]{4}/g;

/**
 * Redact secrets and identifying data before a transcript is committed (CLAUDE.md rule 4).
 *
 * Both substitutions are load-bearing. The PAT is mechanically detectable by its fixed `AZDO`
 * signature at positions 76-80 (C-E00-021). The organization name is not optional either:
 * service error messages embed the full clone URL of the anchor repository, so a
 * missing-template error leaks the org into the transcript verbatim (C-E00-027).
 */
export function redact(text: string, config: Pick<OracleConfig, 'orgUrl' | 'pat'>): string {
  let out = text;
  if (config.pat.length > 0) out = out.split(config.pat).join('{pat}');
  out = out.replace(PAT_PATTERN, '{pat}');

  const org = organizationName(config.orgUrl);
  if (org !== undefined) {
    out = out.split(config.orgUrl.replace(/\/+$/, '')).join('https://dev.azure.com/{org}');
    out = out.split(org).join('{org}');
  }
  return out;
}

/** Last path segment of `https://dev.azure.com/{org}`. */
export function organizationName(orgUrl: string): string | undefined {
  const segments = orgUrl.replace(/\/+$/, '').split('/');
  const last = segments[segments.length - 1];
  return last === undefined || last.length === 0 ? undefined : last;
}
