// E09-S03-T02 — the signed-URL describer, which is a redaction function and therefore a gate.
//
// A signed content URL is a bearer credential in a query string (C-E09-071), and its *path* is the
// half that is easy to miss: one segment is base64 and decodes to a string containing the
// organization name (C-E09-094). This is the assertion that keeps both halves redacted.
import { describe, expect, it } from 'vitest';

import { describeSignedUrl } from '../scripts/e09-runs-artifacts-live.ts';

// The real shape, from run 553, with the signature values replaced by obvious fakes. The base64
// segment is genuine in structure: it decodes to
// `pipelineartifact://EXAMPLEORG/projectId/<guid>/buildId/553/artifactName/drop`.
const BASE64_SEGMENT = Buffer.from(
  'pipelineartifact://EXAMPLEORG/projectId/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/buildId/553/artifactName/drop',
).toString('base64url');
const SIGNED = `https://artprodsu6weu.artifacts.visualstudio.com/A63a76048-7a18-4d58-ba8e-2f5593480a14/_apis/public/artifact/${BASE64_SEGMENT}/signedContent?format=zip&urlExpires=2026-09-22T13%3A22%3A22Z&urlSignature=SECRETSIGNATUREVALUE&urlSigningMethod=HMACV2`;

describe('describeSignedUrl', () => {
  const described = describeSignedUrl(SIGNED);

  it('drops every query parameter value, keeping only the names', () => {
    expect(described).toContain('urlSignature={redacted}');
    expect(described).not.toContain('SECRETSIGNATUREVALUE');
    expect(described).not.toContain('HMACV2');
  });

  it('drops the base64 path segment — the half a query-only redaction misses', () => {
    // The first version of this function printed the path verbatim. `redact()` came back clean and
    // so did a grep for the organization name, because the name was base64-encoded.
    expect(described).not.toContain(BASE64_SEGMENT);
    expect(Buffer.from(described).toString()).not.toContain('EXAMPLEORG');
    // And nothing in the output decodes to it either.
    for (const candidate of described.match(/[A-Za-z0-9_-]{24,}/g) ?? []) {
      let decoded: string;
      try {
        decoded = Buffer.from(candidate, 'base64url').toString('utf8');
      } catch {
        continue;
      }
      expect(decoded).not.toContain('EXAMPLEORG');
    }
  });

  it('drops the account GUID segment too', () => {
    expect(described).not.toContain('A63a76048-7a18-4d58-ba8e-2f5593480a14');
  });

  it('keeps enough structure to recognise the route', () => {
    // A redaction that erased everything would be safe and useless — the transcript exists so a
    // reader can recognise which API answered.
    expect(described).toContain('https://artprodsu6weu.artifacts.visualstudio.com');
    expect(described).toContain('/_apis/public/artifact/');
    expect(described).toContain('/signedContent');
    expect(described).toContain('format={redacted}');
  });

  it('does not throw on a url it cannot parse', () => {
    expect(describeSignedUrl('not a url')).toBe('(unparseable url)');
  });
});
