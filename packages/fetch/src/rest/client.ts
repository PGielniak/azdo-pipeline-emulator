/**
 * Typed Azure DevOps REST client core (E09-S03-T01).
 *
 * One place that knows how to talk to the service: base URLs, the api-version table, retry and
 * throttling, error surfacing, and redaction. Every E09-S03 endpoint module is built on it so those
 * decisions are made once.
 *
 * Three behaviors here are not the obvious implementation, and each is grounded:
 *
 *  - **Every request pins an api-version, because omitting it succeeds.** The docs say the version
 *    "must be specified with every request" (C-E09-060) — but a request without one returns 200
 *    against a server-chosen version (C-E09-061). An omission is therefore not a loud failure but a
 *    silent floating dependency, which is the worse of the two.
 *  - **`Retry-After` is read on *every* response, including 200.** "Honor the Retry-After header…
 *    The response still returns HTTP 200, so retry logic isn't required" (C-E09-064). A client that
 *    inspects the header only on 429/503 misses the throttle entirely and keeps hammering.
 *  - **Every rate-limit header is optional.** None of the seven documented ones appear on an
 *    ordinary 200 from the test organization (C-E09-065), so the client is correct with all absent.
 *
 * Redaction (C-E09-066) is local policy, not a documented behavior: no token ever reaches a message.
 */

import { authorizationHeader } from '../oracle.js';
import { credentialAuthorizationHeader } from '../auth/status.js';
import type { StoredAzureCredential } from '../auth/storage.js';

/**
 * The single api-version table (docs/05 §2). One entry per endpoint family, each citing the page it
 * was verified against; nothing in E09-S03 hardcodes a version string of its own.
 */
export const API_VERSIONS = {
  /** Git Refs / Items — C-E09-030/033, page `git_commit_id` cb0d0b30…. */
  git: '7.1',
  /** Profile `me` — C-E09-009. */
  profile: '7.1',
  /** Pipelines runs / artifacts — E09-S03-T02 pins its own page. */
  pipelines: '7.1',
  /** Build definitions / artifacts — E09-S03-T03. */
  build: '7.1',
  /** Distributed task: variable groups, tasks, yamlschema — E09-S03-T04/T05/T07, C-E01-029. */
  distributedtask: '7.1',
} as const;

export type ApiArea = keyof typeof API_VERSIONS;

/** C-E09-063: the ceiling the test organization reported on 2026-09-02, for diagnostics only. */
export const OBSERVED_SERVER_MAX_API_VERSION = '7.2';

/** C-E09-065: documented, all optional, and none present on an unthrottled response. */
export interface RateLimitSignals {
  /** Seconds the service asked us to wait before the *next* request. Present even on a 200. */
  readonly retryAfterSeconds?: number;
  readonly resource?: string;
  readonly delaySeconds?: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetEpochSeconds?: number;
  readonly cost?: number;
}

export interface RestResponse<T> {
  readonly status: number;
  readonly body: T;
  /** C-E09-062: the version the server actually served, parsed out of `Content-Type`. */
  readonly negotiatedApiVersion?: string;
  readonly rateLimit: RateLimitSignals;
}

export class RestError extends Error {
  readonly status: number | undefined;
  readonly url: string;
  readonly serviceMessage: string | undefined;
  readonly typeKey: string | undefined;

  constructor(
    message: string,
    details: {
      status?: number;
      url: string;
      serviceMessage?: string;
      typeKey?: string;
      cause?: unknown;
    },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'RestError';
    this.status = details.status;
    this.url = details.url;
    this.serviceMessage = details.serviceMessage;
    this.typeKey = details.typeKey;
  }
}

export type RestFetch = (url: string, init: RequestInit) => Promise<Response>;
export type Sleeper = (milliseconds: number) => Promise<void>;

export interface RestClientOptions {
  readonly orgUrl: string;
  readonly credential: StoredAzureCredential;
  readonly project?: string;
  readonly fetchImpl?: RestFetch;
  readonly sleep?: Sleeper;
  /** Attempts *after* the first; 0 disables retrying. */
  readonly maxRetries?: number;
  /** First backoff step in milliseconds; doubles per attempt. */
  readonly baseDelayMs?: number;
  /** Caps both backoff and an honored `Retry-After`, so a hostile value cannot hang a convert. */
  readonly maxDelayMs?: number;
}

export interface RestRequest {
  /** Route below `_apis`, e.g. `git/repositories`. */
  readonly path: string;
  readonly area: ApiArea;
  readonly method?: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  /** Overrides the client's project for this call; `null` builds an organization-scoped URL. */
  readonly project?: string | null;
  readonly body?: unknown;
  readonly accept?: string;
}

const DEFAULTS = { maxRetries: 3, baseDelayMs: 250, maxDelayMs: 30_000 } as const;

/** Statuses worth a second attempt: throttling and transient server faults. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** C-E09-066: strip anything credential-bearing before a URL can reach a message or a log. */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    parsed.username = '';
    parsed.password = '';
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (/token|secret|password|signature|sig|pat|key/i.test(key)) {
      parsed.searchParams.set(key, 'REDACTED');
    }
  }
  return parsed.toString();
}

function numberHeader(response: Response, name: string): number | undefined {
  const raw = response.headers.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** C-E09-064/065: read on every response, and correct when every header is missing. */
export function rateLimitOf(response: Response): RateLimitSignals {
  const signals: {
    -readonly [K in keyof RateLimitSignals]: RateLimitSignals[K];
  } = {};
  const resource = response.headers.get('x-ratelimit-resource');
  if (resource !== null) signals.resource = resource;

  const numeric = [
    ['retry-after', 'retryAfterSeconds'],
    ['x-ratelimit-delay', 'delaySeconds'],
    ['x-ratelimit-limit', 'limit'],
    ['x-ratelimit-remaining', 'remaining'],
    ['x-ratelimit-reset', 'resetEpochSeconds'],
    ['x-ratelimit-cost', 'cost'],
  ] as const;
  for (const [header, field] of numeric) {
    const value = numberHeader(response, header);
    if (value !== undefined) signals[field] = value;
  }
  return signals;
}

/** C-E09-062: `application/json; charset=utf-8; api-version=7.1` → `7.1`. */
export function negotiatedApiVersion(response: Response): string | undefined {
  const contentType = response.headers.get('content-type');
  if (contentType === null) return undefined;
  const match = /;\s*api-version=([^;\s]+)/i.exec(contentType);
  return match?.[1];
}

/** The service's error envelope: `{ message, typeKey, typeName, … }`. */
function serviceError(body: unknown): { message?: string; typeKey?: string } {
  if (body === null || typeof body !== 'object') return {};
  const envelope = body as Record<string, unknown>;
  return {
    ...(typeof envelope.message === 'string' ? { message: envelope.message } : {}),
    ...(typeof envelope.typeKey === 'string' ? { typeKey: envelope.typeKey } : {}),
  };
}

const defaultSleep: Sleeper = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AzureDevOpsClient {
  private readonly options: RestClientOptions;
  /** Set from a `Retry-After` on any response, and paid before the next request (C-E09-064). */
  private pendingDelayMs = 0;

  constructor(options: RestClientOptions) {
    this.options = options;
  }

  /** The delay the next request will wait out; exposed so callers can report a throttle. */
  get owedDelayMs(): number {
    return this.pendingDelayMs;
  }

  url(request: RestRequest): string {
    const org = this.options.orgUrl.replace(/\/+$/, '');
    const project = request.project === undefined ? this.options.project : request.project;
    const scope =
      project === null || project === undefined || project.length === 0
        ? ''
        : `/${encodeURIComponent(project)}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    // C-E09-060/061: never omitted, because omitting it succeeds against a floating version.
    params.set('api-version', API_VERSIONS[request.area]);
    return `${org}${scope}/_apis/${request.path.replace(/^\/+/, '')}?${params.toString()}`;
  }

  private cap(milliseconds: number): number {
    return Math.min(Math.max(milliseconds, 0), this.options.maxDelayMs ?? DEFAULTS.maxDelayMs);
  }

  /** Perform one request, honoring an owed throttle delay and retrying transient failures. */
  async request<T = unknown>(request: RestRequest): Promise<RestResponse<T>> {
    const url = this.url(request);
    const sleep = this.options.sleep ?? defaultSleep;
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const maxRetries = this.options.maxRetries ?? DEFAULTS.maxRetries;
    const baseDelay = this.options.baseDelayMs ?? DEFAULTS.baseDelayMs;

    let lastError: RestError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (this.pendingDelayMs > 0) {
        const owed = this.pendingDelayMs;
        this.pendingDelayMs = 0;
        await sleep(owed);
      }

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: request.method ?? 'GET',
          redirect: 'manual',
          headers: {
            Accept: request.accept ?? 'application/json',
            Authorization: this.authorization(),
            ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
      } catch (error) {
        lastError = new RestError(`request to ${redactUrl(url)} failed`, {
          url: redactUrl(url),
          cause: error,
        });
        if (attempt < maxRetries) {
          await sleep(this.cap(baseDelay * 2 ** attempt));
          continue;
        }
        throw lastError;
      }

      const rateLimit = rateLimitOf(response);
      // C-E09-064: this is set even on a success — the whole point of the claim.
      if (rateLimit.retryAfterSeconds !== undefined) {
        this.pendingDelayMs = this.cap(rateLimit.retryAfterSeconds * 1000);
      }

      const text = await response.text();
      let body: unknown;
      try {
        body = text.length === 0 ? undefined : (JSON.parse(text) as unknown);
      } catch {
        body = undefined;
      }

      if (response.ok) {
        const version = negotiatedApiVersion(response);
        return {
          status: response.status,
          body: body as T,
          ...(version === undefined ? {} : { negotiatedApiVersion: version }),
          rateLimit,
        };
      }

      const { message, typeKey } = serviceError(body);
      lastError = new RestError(
        `${request.method ?? 'GET'} ${redactUrl(url)} returned HTTP ${response.status}` +
          (message === undefined ? '' : `: ${message}`),
        {
          status: response.status,
          url: redactUrl(url),
          ...(message === undefined ? {} : { serviceMessage: message }),
          ...(typeKey === undefined ? {} : { typeKey }),
        },
      );

      if (!RETRYABLE.has(response.status) || attempt === maxRetries) throw lastError;
      // A `Retry-After` already scheduled above takes precedence over blind backoff.
      if (this.pendingDelayMs === 0) this.pendingDelayMs = this.cap(baseDelay * 2 ** attempt);
    }

    /* c8 ignore next */
    throw (
      lastError ?? new RestError(`request to ${redactUrl(url)} failed`, { url: redactUrl(url) })
    );
  }

  /** PAT is Basic with an empty username; Entra/`az` tokens are Bearer (C-E09-010). */
  private authorization(): string {
    return this.options.credential.mode === 'pat'
      ? authorizationHeader(this.options.credential.token)
      : credentialAuthorizationHeader(this.options.credential);
  }
}
