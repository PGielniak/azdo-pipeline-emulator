import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_VERSION,
  OracleUsageError,
  authorizationHeader,
  configFromEnv,
  organizationName,
  preview,
  previewUrl,
  redact,
  type OracleConfig,
} from '../src/oracle.js';

const CONFIG: OracleConfig = {
  orgUrl: 'https://dev.azure.com/example-org',
  project: 'oracle',
  pipelineId: 19,
  pat: 'x'.repeat(75) + 'AZDO' + 'abcd',
  apiVersion: DEFAULT_API_VERSION,
};

/** Build a fake fetch returning one canned response; records the request it was given. */
function fakeFetch(response: Response): {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(response);
    },
  };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('oracle request construction', () => {
  it('[C-E00-017] addresses the preview endpoint per pipeline with the api-version moniker', () => {
    expect(previewUrl(CONFIG)).toBe(
      'https://dev.azure.com/example-org/oracle/_apis/pipelines/19/preview?api-version=7.1',
    );
  });

  it('[C-E00-017] tolerates a trailing slash on the org URL', () => {
    expect(previewUrl({ ...CONFIG, orgUrl: 'https://dev.azure.com/example-org/' })).toContain(
      '/example-org/oracle/_apis/',
    );
  });

  it('[C-E00-020] authenticates as HTTP Basic with an empty username', () => {
    const header = authorizationHeader('secret');
    expect(header).toBe(`Basic ${Buffer.from(':secret').toString('base64')}`);
    // decoding must yield ":secret" — the leading colon is the empty username
    expect(Buffer.from(header.slice('Basic '.length), 'base64').toString()).toBe(':secret');
  });

  it('[C-E00-018] sends previewRun:true so no run is ever queued', async () => {
    const { fetch, calls } = fakeFetch(json(200, { finalYaml: 'stages: []\n' }));
    await preview(CONFIG, { yamlOverride: 'steps: []\n' }, fetch);

    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(body.previewRun).toBe(true);
    expect(body.yamlOverride).toBe('steps: []\n');
  });

  it('[C-E00-025] never follows redirects', async () => {
    const { fetch, calls } = fakeFetch(json(200, { finalYaml: '' }));
    await preview(CONFIG, { yamlOverride: 'steps: []\n' }, fetch);
    expect(calls[0]!.init.redirect).toBe('manual');
  });
});

describe('oracle outcome classification', () => {
  it('[C-E00-022] reads finalYaml from a 200 response', async () => {
    const { fetch } = fakeFetch(json(200, { finalYaml: 'stages:\n- stage: __default\n' }));
    const outcome = await preview(CONFIG, { yamlOverride: 'steps: []\n' }, fetch);

    expect(outcome).toEqual({
      kind: 'expanded',
      status: 200,
      finalYaml: 'stages:\n- stage: __default\n',
    });
  });

  it('[C-E00-023] classifies a 400 validation error, keeping typeKey and message', async () => {
    // Verbatim envelope from research/experiments/oracle-spike/unknown-root-key.md
    const { fetch } = fakeFetch(
      json(400, {
        $id: '1',
        innerException: null,
        message: "/azure-pipelines.yml (Line: 1, Col: 1): Unexpected value 'stepz'",
        typeName:
          'Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi',
        typeKey: 'PipelineValidationException',
        errorCode: 0,
        eventId: 3000,
      }),
    );
    const outcome = await preview(CONFIG, { yamlOverride: 'stepz: []\n' }, fetch);

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.status).toBe(400);
    expect(outcome.typeKey).toBe('PipelineValidationException');
    expect(outcome.message).toMatch(/^\/azure-pipelines\.yml \(Line: 1, Col: 1\): /);
  });

  it('[C-E00-025] treats a 302 to the sign-in page as unauthenticated, not success', async () => {
    const { fetch } = fakeFetch(
      new Response('<html>Object moved</html>', {
        status: 302,
        headers: {
          location: 'https://spsprodweu2.vssps.visualstudio.com/_signin?realm=dev.azure.com',
          'content-type': 'text/html',
        },
      }),
    );
    const outcome = await preview(CONFIG, { yamlOverride: 'steps: []\n' }, fetch);

    expect(outcome.kind).toBe('unauthenticated');
    if (outcome.kind !== 'unauthenticated') return;
    expect(outcome.signinUrl).toContain('_signin');
  });

  it('[C-E00-026] a nonexistent pipelineId is a 500 PipelineNotFoundException, not a 404', async () => {
    const { fetch } = fakeFetch(
      json(500, {
        message: "The pipeline '999999' does not exist",
        typeKey: 'PipelineNotFoundException',
      }),
    );
    const outcome = await preview(CONFIG, { yamlOverride: 'steps: []\n' }, fetch);

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.status).toBe(500);
    expect(outcome.typeKey).toBe('PipelineNotFoundException');
  });

  it('falls back to a transport outcome when the body is not JSON', async () => {
    const { fetch } = fakeFetch(new Response('<html>gateway</html>', { status: 502 }));
    const outcome = await preview(CONFIG, { yamlOverride: 'steps: []\n' }, fetch);
    expect(outcome.kind).toBe('transport');
  });

  it('[C-E00-024] refuses an empty yamlOverride rather than expanding the wrong pipeline', async () => {
    const { fetch, calls } = fakeFetch(json(200, { finalYaml: 'anchor' }));
    await expect(preview(CONFIG, { yamlOverride: '' }, fetch)).rejects.toThrow(OracleUsageError);
    expect(calls).toHaveLength(0); // never reaches the wire
  });
});

describe('redaction (CLAUDE.md rule 4)', () => {
  it('[C-E00-021] removes a PAT by its fixed AZDO signature even if the value is unknown', () => {
    const foreign = 'z'.repeat(75) + 'AZDO' + 'wxyz';
    expect(redact(`token=${foreign}`, CONFIG)).toBe('token={pat}');
  });

  it('[C-E00-021] removes the configured PAT value', () => {
    expect(redact(`Authorization uses ${CONFIG.pat}`, CONFIG)).toBe('Authorization uses {pat}');
  });

  it('[C-E00-027] removes the organization from a service message that embeds the clone URL', () => {
    const message =
      'File /x.yml not found in repository https://dev.azure.com/example-org/oracle/_git/oracle branch refs/heads/main';
    const out = redact(message, CONFIG);
    expect(out).not.toContain('example-org');
    expect(out).toContain('https://dev.azure.com/{org}/oracle/_git/oracle');
  });

  it('extracts the organization name from the org URL', () => {
    expect(organizationName('https://dev.azure.com/example-org/')).toBe('example-org');
    expect(organizationName('')).toBeUndefined();
  });
});

describe('configFromEnv', () => {
  const complete = {
    AZDO_ORG_URL: 'https://dev.azure.com/example-org',
    AZDO_PROJECT: 'oracle',
    AZDO_ORACLE_PIPELINE_ID: '19',
    AZDO_PAT: 'token',
  };

  it('reads the four documented variables and defaults the api-version', () => {
    expect(configFromEnv(complete)).toEqual({ ...CONFIG, pat: 'token' });
  });

  it('names every missing variable at once, pointing at the runbook', () => {
    expect(() => configFromEnv({ AZDO_PROJECT: 'oracle' })).toThrow(
      /AZDO_ORG_URL, AZDO_ORACLE_PIPELINE_ID, AZDO_PAT/,
    );
    expect(() => configFromEnv({})).toThrow(/oracle-setup\.md/);
  });

  it('rejects a non-integer pipeline id', () => {
    expect(() => configFromEnv({ ...complete, AZDO_ORACLE_PIPELINE_ID: 'one' })).toThrow(
      OracleUsageError,
    );
  });
});
