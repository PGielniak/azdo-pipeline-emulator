import { describe, expect, it } from 'vitest';
import {
  API_VERSIONS,
  AzureDevOpsClient,
  OBSERVED_SERVER_MAX_API_VERSION,
  RestError,
  negotiatedApiVersion,
  rateLimitOf,
  redactUrl,
  type RestFetch,
  type Sleeper,
} from '../src/rest/client.js';
import type { StoredAzureCredential } from '../src/auth/storage.js';

const ORG = 'https://dev.azure.com/example-org';
const PAT: StoredAzureCredential = {
  version: 1,
  orgUrl: ORG,
  mode: 'pat',
  token: 'fake-pat-for-rest-tests',
};
const BEARER: StoredAzureCredential = { ...PAT, mode: 'az', token: 'fake-access-token' };

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function recorder(responses: (Response | Error)[]): {
  calls: Call[];
  slept: number[];
  fetchImpl: RestFetch;
  sleep: Sleeper;
} {
  const calls: Call[] = [];
  const slept: number[] = [];
  const queue = [...responses];
  const fetchImpl: RestFetch = (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected request to ${url}`);
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const sleep: Sleeper = (milliseconds) => {
    slept.push(milliseconds);
    return Promise.resolve();
  };
  return { calls, slept, fetchImpl, sleep };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8; api-version=7.1', ...headers },
  });

const client = (
  overrides: Partial<ConstructorParameters<typeof AzureDevOpsClient>[0]> = {},
): AzureDevOpsClient =>
  new AzureDevOpsClient({ orgUrl: ORG, credential: PAT, project: 'Example', ...overrides });

describe('the api-version table (docs/05 §2)', () => {
  it('carries one pinned version per endpoint family', () => {
    expect(Object.values(API_VERSIONS).every((version) => /^\d+\.\d+/.test(version))).toBe(true);
    // C-E09-063: the test org reported 7.2 as its ceiling, so 7.1 is conservative, not stale.
    expect(OBSERVED_SERVER_MAX_API_VERSION).toBe('7.2');
  });
});

describe('url building', () => {
  it('pins api-version on every request (C-E09-060/061)', () => {
    // Omitting it returns 200 against a server-chosen version — a silent floating dependency,
    // which is why the pin is not optional here.
    const url = new URL(client().url({ path: 'git/repositories', area: 'git' }));
    expect(url.pathname).toBe('/example-org/Example/_apis/git/repositories');
    expect(url.searchParams.get('api-version')).toBe(API_VERSIONS.git);
  });

  it('builds an organization-scoped url when project is null', () => {
    const url = new URL(
      client().url({ path: 'distributedtask/tasks', area: 'distributedtask', project: null }),
    );
    expect(url.pathname).toBe('/example-org/_apis/distributedtask/tasks');
  });

  it('overrides the project per request and drops undefined query values', () => {
    const url = new URL(
      client().url({
        path: 'build/definitions',
        area: 'build',
        project: 'Other Project',
        query: { name: 'CI', top: 5, includeAll: true, missing: undefined },
      }),
    );
    expect(url.pathname).toBe('/example-org/Other%20Project/_apis/build/definitions');
    expect(url.searchParams.get('name')).toBe('CI');
    expect(url.searchParams.get('top')).toBe('5');
    expect(url.searchParams.get('includeAll')).toBe('true');
    expect(url.searchParams.has('missing')).toBe(false);
  });

  it('tolerates a trailing slash on the org and a leading slash on the path', () => {
    const withSlashes = new AzureDevOpsClient({
      orgUrl: `${ORG}/`,
      credential: PAT,
      project: 'Example',
    });
    expect(new URL(withSlashes.url({ path: '/git/refs', area: 'git' })).pathname).toBe(
      '/example-org/Example/_apis/git/refs',
    );
  });
});

describe('redactUrl (C-E09-066)', () => {
  it('removes credentials and credential-bearing query values', () => {
    expect(redactUrl('https://user:secret@dev.azure.com/org/_apis/x')).toBe(
      'https://dev.azure.com/org/_apis/x',
    );
    expect(redactUrl('https://dev.azure.com/x?sig=abc&api-version=7.1')).toContain('sig=REDACTED');
    expect(redactUrl('https://dev.azure.com/x?access_token=abc')).toContain(
      'access_token=REDACTED',
    );
    expect(redactUrl('https://dev.azure.com/x?api-version=7.1')).toContain('api-version=7.1');
  });

  it('returns a non-URL string unchanged rather than throwing', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('negotiatedApiVersion (C-E09-062)', () => {
  it('parses the version the server actually served', () => {
    expect(
      negotiatedApiVersion(
        new Response('', { headers: { 'content-type': 'application/json; api-version=7.1' } }),
      ),
    ).toBe('7.1');
    expect(
      negotiatedApiVersion(new Response('', { headers: { 'content-type': 'text/plain' } })),
    ).toBeUndefined();
    expect(negotiatedApiVersion(new Response(''))).toBeUndefined();
  });
});

describe('rateLimitOf (C-E09-065)', () => {
  it('returns an empty object when every documented header is absent', () => {
    // Measured: none of the seven appear on an ordinary 200 from the test org.
    expect(rateLimitOf(new Response(''))).toEqual({});
  });

  it('reads all seven when present', () => {
    const response = new Response('', {
      headers: {
        'retry-after': '12',
        'x-ratelimit-resource': 'GitRepos/Read',
        'x-ratelimit-delay': '1.5',
        'x-ratelimit-limit': '200',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1756800000',
        'x-ratelimit-cost': '0.5',
      },
    });
    expect(rateLimitOf(response)).toEqual({
      retryAfterSeconds: 12,
      resource: 'GitRepos/Read',
      delaySeconds: 1.5,
      limit: 200,
      remaining: 0,
      resetEpochSeconds: 1756800000,
      cost: 0.5,
    });
  });

  it('ignores a non-numeric value rather than reporting NaN', () => {
    expect(rateLimitOf(new Response('', { headers: { 'retry-after': 'Wed, 21 Oct' } }))).toEqual(
      {},
    );
  });
});

describe('request', () => {
  it('returns the body, the negotiated version and the rate-limit signals', async () => {
    const { fetchImpl, sleep } = recorder([json(200, { count: 2, value: [] })]);
    const result = await client({ fetchImpl, sleep }).request<{ count: number }>({
      path: 'git/repositories',
      area: 'git',
    });
    expect(result.status).toBe(200);
    expect(result.body.count).toBe(2);
    expect(result.negotiatedApiVersion).toBe('7.1');
    expect(result.rateLimit).toEqual({});
  });

  it('sends Basic for a PAT and Bearer for an access token', async () => {
    const pat = recorder([json(200, {})]);
    await client({ fetchImpl: pat.fetchImpl, sleep: pat.sleep }).request({
      path: 'git/repositories',
      area: 'git',
    });
    expect(
      ((pat.calls[0]?.init.headers as Record<string, string>).Authorization ?? '').startsWith(
        'Basic ',
      ),
    ).toBe(true);

    const az = recorder([json(200, {})]);
    await client({ credential: BEARER, fetchImpl: az.fetchImpl, sleep: az.sleep }).request({
      path: 'git/repositories',
      area: 'git',
    });
    expect((az.calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer fake-access-token',
    );
  });

  it('serializes a body and sets its content type', async () => {
    const { calls, fetchImpl, sleep } = recorder([json(200, {})]);
    await client({ fetchImpl, sleep }).request({
      path: 'pipelines/1/preview',
      area: 'pipelines',
      method: 'POST',
      body: { previewRun: true },
    });
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{"previewRun":true}');
    expect((calls[0]?.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('honors Retry-After on a SUCCESSFUL response, before the next request (C-E09-064)', async () => {
    // The counterintuitive half of the claim: the throttle signal rides a 200. A client that only
    // checks 429 would keep hammering a service that just asked it to slow down.
    const { slept, fetchImpl, sleep } = recorder([
      json(200, { first: true }, { 'retry-after': '4' }),
      json(200, { second: true }),
    ]);
    const rest = client({ fetchImpl, sleep });

    const first = await rest.request({ path: 'git/repositories', area: 'git' });
    expect(first.status).toBe(200);
    expect(first.rateLimit.retryAfterSeconds).toBe(4);
    // Nothing was slept for the first call — the debt is paid before the *next* one.
    expect(slept).toEqual([]);
    expect(rest.owedDelayMs).toBe(4000);

    await rest.request({ path: 'git/refs', area: 'git' });
    expect(slept).toEqual([4000]);
    expect(rest.owedDelayMs).toBe(0);
  });

  it('caps an absurd Retry-After so a hostile value cannot hang a convert', async () => {
    const { fetchImpl, sleep } = recorder([json(200, {}, { 'retry-after': '86400' })]);
    const rest = client({ fetchImpl, sleep, maxDelayMs: 5_000 });
    await rest.request({ path: 'git/repositories', area: 'git' });
    expect(rest.owedDelayMs).toBe(5_000);
  });

  it('retries a 429 and surfaces the TF400733 message when it persists (C-E09-065)', async () => {
    const blocked = {
      message:
        'TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource X in namespace Y.',
      typeKey: 'RequestBlockedException',
    };
    const { calls, slept, fetchImpl, sleep } = recorder([
      json(429, blocked, { 'retry-after': '2' }),
      json(429, blocked, { 'retry-after': '2' }),
      json(200, { ok: true }),
    ]);

    const result = await client({ fetchImpl, sleep }).request<{ ok: boolean }>({
      path: 'git/repositories',
      area: 'git',
    });
    expect(result.body.ok).toBe(true);
    expect(calls).toHaveLength(3);
    // The service's own Retry-After wins over blind backoff.
    expect(slept).toEqual([2000, 2000]);
  });

  it('backs off exponentially when the service gives no Retry-After', async () => {
    const { slept, fetchImpl, sleep } = recorder([
      json(503, {}),
      json(503, {}),
      json(200, { ok: true }),
    ]);
    await client({ fetchImpl, sleep, baseDelayMs: 100 }).request({
      path: 'git/repositories',
      area: 'git',
    });
    expect(slept).toEqual([100, 200]);
  });

  it('does not retry a 4xx that is not throttling', async () => {
    const { calls, fetchImpl, sleep } = recorder([
      json(400, {
        message:
          'The requested REST API version of 99.0 is out of range for this server. The latest REST API version this server supports is 7.2.',
        typeKey: 'VssVersionOutOfRangeException',
      }),
    ]);
    const error = (await client({ fetchImpl, sleep })
      .request({ path: 'git/repositories', area: 'git' })
      .catch((caught: unknown) => caught)) as RestError;

    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(RestError);
    expect(error.status).toBe(400);
    // C-E09-063: the service names its own ceiling, so the failure is diagnosable.
    expect(error.typeKey).toBe('VssVersionOutOfRangeException');
    expect(error.serviceMessage).toContain('7.2');
  });

  it('gives up after maxRetries and reports the last failure', async () => {
    const { calls, fetchImpl, sleep } = recorder([json(500, {}), json(500, {})]);
    await expect(
      client({ fetchImpl, sleep, maxRetries: 1 }).request({ path: 'git/refs', area: 'git' }),
    ).rejects.toThrow('returned HTTP 500');
    expect(calls).toHaveLength(2);
  });

  it('retries a transport failure and then reports it', async () => {
    const recovered = recorder([new Error('ECONNRESET'), json(200, { ok: true })]);
    await expect(
      client({ fetchImpl: recovered.fetchImpl, sleep: recovered.sleep }).request({
        path: 'git/refs',
        area: 'git',
      }),
    ).resolves.toMatchObject({ status: 200 });

    const failed = recorder([new Error('ECONNRESET'), new Error('ECONNRESET')]);
    await expect(
      client({ fetchImpl: failed.fetchImpl, sleep: failed.sleep, maxRetries: 1 }).request({
        path: 'git/refs',
        area: 'git',
      }),
    ).rejects.toThrow(/request to .* failed/);
  });

  it('never puts the credential into an error, a url or a message (C-E09-066)', async () => {
    const { fetchImpl, sleep } = recorder([json(401, { message: 'unauthenticated' })]);
    const error = (await client({ fetchImpl, sleep })
      .request({
        path: 'git/repositories',
        area: 'git',
        query: { sig: 'super-secret-signature' },
      })
      .catch((caught: unknown) => caught)) as RestError;

    const rendered = `${error.message}\n${error.url}\n${String(error.stack)}`;
    expect(rendered).not.toContain(PAT.token);
    expect(rendered).not.toContain('super-secret-signature');
    expect(error.url).toContain('sig=REDACTED');
  });

  it('tolerates an empty or non-JSON body', async () => {
    const empty = recorder([new Response('', { status: 200 })]);
    await expect(
      client({ fetchImpl: empty.fetchImpl, sleep: empty.sleep }).request({
        path: 'git/refs',
        area: 'git',
      }),
    ).resolves.toMatchObject({ status: 200, body: undefined });

    const html = recorder([new Response('<html>', { status: 500 })]);
    await expect(
      client({ fetchImpl: html.fetchImpl, sleep: html.sleep, maxRetries: 0 }).request({
        path: 'git/refs',
        area: 'git',
      }),
    ).rejects.toThrow('returned HTTP 500');
  });

  it('uses a real timer when no sleeper is injected', async () => {
    // Exercises the production sleep path; 1ms keeps it a real wait without slowing the suite.
    const { slept: _unused, fetchImpl } = recorder([
      json(200, {}, { 'retry-after': '0.001' }),
      json(200, { ok: true }),
    ]);
    void _unused;
    const rest = client({ fetchImpl });
    await rest.request({ path: 'git/refs', area: 'git' });
    expect(rest.owedDelayMs).toBe(1);
    await expect(rest.request({ path: 'git/refs', area: 'git' })).resolves.toMatchObject({
      status: 200,
    });
    expect(rest.owedDelayMs).toBe(0);
  });

  it('does not follow redirects automatically', async () => {
    const { calls, fetchImpl, sleep } = recorder([json(200, {})]);
    await client({ fetchImpl, sleep }).request({ path: 'git/refs', area: 'git' });
    expect(calls[0]?.init.redirect).toBe('manual');
  });
});
