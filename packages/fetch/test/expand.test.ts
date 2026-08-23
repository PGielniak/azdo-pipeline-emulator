import { describe, expect, it } from 'vitest';
import {
  expand,
  expansionRequestHash,
  provenanceFor,
  type ExpansionRequest,
} from '../src/expand.js';
import { DEFAULT_API_VERSION, type OracleConfig } from '../src/oracle.js';

const CONFIG: OracleConfig = {
  orgUrl: 'https://dev.azure.com/example-org',
  project: 'oracle',
  pipelineId: 19,
  pat: 'x'.repeat(75) + 'AZDO' + 'abcd',
  apiVersion: DEFAULT_API_VERSION,
};

const REQUEST: ExpansionRequest = { yamlOverride: 'steps:\n- script: echo probe\n' };

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

describe('expansion provenance', () => {
  it('is a deterministic content hash of the override', () => {
    expect(expansionRequestHash({ yamlOverride: 'steps: []\n' })).toMatch(/^[0-9a-f]{64}$/);
    expect(expansionRequestHash({ yamlOverride: 'steps: []\n' })).toBe(
      expansionRequestHash({ yamlOverride: 'steps: []\n' }),
    );
    expect(expansionRequestHash({ yamlOverride: 'steps: []\n' })).not.toBe(
      expansionRequestHash({ yamlOverride: 'steps: []\n ' }),
    );
  });

  it('records api-version, pipelineId, request hash and the redaction invariant', () => {
    const provenance = provenanceFor(CONFIG, REQUEST);
    expect(provenance.apiVersion).toBe('7.1');
    expect(provenance.pipelineId).toBe(19);
    expect(provenance.requestHash).toBe(expansionRequestHash(REQUEST));
    expect(provenance.redacted).toBe(true); // persisted transcripts are always redacted (D7)
  });
});

describe('expand() outcome mapping', () => {
  it('[C-E00-022] returns the finalYaml with provenance on a 200', async () => {
    const { fetch } = fakeFetch(json(200, { finalYaml: 'stages:\n- stage: __default\n' }));

    const outcome = await expand(CONFIG, REQUEST, fetch);

    expect(outcome.kind).toBe('expanded');
    if (outcome.kind !== 'expanded') return;
    expect(outcome.finalYaml).toBe('stages:\n- stage: __default\n');
    expect(outcome.provenance).toEqual(provenanceFor(CONFIG, REQUEST));
  });

  it('[C-E00-018] forwards templateParameters to the preview body', async () => {
    const { fetch, calls } = fakeFetch(json(200, { finalYaml: 'stages: []\n' }));
    await expand(
      CONFIG,
      { yamlOverride: 'steps: []\n', templateParameters: { name: 'probe' } },
      fetch,
    );

    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(body.previewRun).toBe(true);
    expect(body.templateParameters).toEqual({ name: 'probe' });
  });

  it('[C-E00-023] classifies a validation rejection, carrying message + typeKey + provenance', async () => {
    const { fetch } = fakeFetch(
      json(400, {
        message: "/azure-pipelines.yml (Line: 1, Col: 1): Unexpected value 'stepz'",
        typeKey: 'PipelineValidationException',
      }),
    );

    const outcome = await expand(CONFIG, { yamlOverride: 'stepz: []\n' }, fetch);

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.message).toContain('Unexpected value');
    expect(outcome.typeKey).toBe('PipelineValidationException');
    expect(outcome.provenance.requestHash).toBe(
      expansionRequestHash({ yamlOverride: 'stepz: []\n' }),
    );
  });

  it('[C-E00-025] classifies a 302 as unauthenticated', async () => {
    const { fetch } = fakeFetch(
      new Response('<html>Object moved</html>', {
        status: 302,
        headers: { location: 'https://spsprodweu2.vssps.visualstudio.com/_signin' },
      }),
    );

    const outcome = await expand(CONFIG, REQUEST, fetch);
    expect(outcome.kind).toBe('unauthenticated');
    expect(outcome.provenance).toEqual(provenanceFor(CONFIG, REQUEST));
  });

  it('classifies a non-JSON body as transport', async () => {
    const { fetch } = fakeFetch(new Response('<html>gateway</html>', { status: 502 }));
    const outcome = await expand(CONFIG, REQUEST, fetch);
    expect(outcome.kind).toBe('transport');
  });

  it('[C-E00-024] propagates the empty-override guard without reaching the wire', async () => {
    const { fetch, calls } = fakeFetch(json(200, { finalYaml: 'anchor' }));
    await expect(expand(CONFIG, { yamlOverride: '' }, fetch)).rejects.toThrow(
      /yamlOverride is empty/,
    );
    expect(calls).toHaveLength(0);
  });
});
