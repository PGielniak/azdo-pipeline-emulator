// E03-S06-T03 — `templateParameters` pass-through.
//
// Two things are asserted here and they are different in kind. The serializer and the request hash
// are ours, and are unit-tested. What the *service* does with the field is not ours to assert from
// a model of it — those cases replay the captured transcripts in
// `research/experiments/E03-parameters-request/`, so the test fails if the recorded measurement and
// the code's assumption ever drift apart.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  expansionRequestHash,
  serializeTemplateParameters,
  type ExpansionRequest,
} from '../src/expand.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const transcript = (probe: string, file: string): string =>
  readFileSync(join(repoRoot, 'research/experiments/E03-parameters-request', probe, file), 'utf8');
const rejection = (probe: string): { message: string; typeKey: string } =>
  JSON.parse(transcript(probe, 'response.json')) as { message: string; typeKey: string };
/** The single `echo [...]` payload a probe's expansion produced. */
const echoed = (probe: string): string => {
  const yaml = transcript(probe, 'final.yml');
  return /echo \[([\s\S]*?)\]/.exec(yaml)?.[1] ?? '';
};

describe('serializeTemplateParameters (C-E03-416/417)', () => {
  it('passes a string through unchanged', () => {
    expect(serializeTemplateParameters({ greeting: 'hello world' })).toStrictEqual({
      greeting: 'hello world',
    });
  });

  it('renders numbers and booleans as their bare text', () => {
    expect(serializeTemplateParameters({ count: 42, flag: true, ratio: 0.5 })).toStrictEqual({
      count: '42',
      flag: 'true',
      ratio: '0.5',
    });
  });

  it('serializes a structured value as JSON, which is the only form the service accepts', () => {
    // C-E03-417: a raw JSON object in the field is refused; the same object as a JSON *string*
    // binds and is parsed back into a real object.
    expect(serializeTemplateParameters({ config: { key: 'value' } })).toStrictEqual({
      config: '{"key":"value"}',
    });
    expect(serializeTemplateParameters({ list: ['a', 'b'] })).toStrictEqual({
      list: '["a","b"]',
    });
  });

  it('drops an undefined value rather than rendering it', () => {
    expect(serializeTemplateParameters({ set: 'x', unset: undefined })).toStrictEqual({ set: 'x' });
  });

  it('preserves a string that already looks like JSON', () => {
    expect(serializeTemplateParameters({ config: '{"key":"value"}' })).toStrictEqual({
      config: '{"key":"value"}',
    });
  });
});

describe('expansionRequestHash covers the parameters (E03-S06-T03)', () => {
  const yamlOverride = 'steps:\n- script: echo probe\n';

  it('separates two requests that differ only in a parameter value', () => {
    const a: ExpansionRequest = { yamlOverride, templateParameters: { greeting: 'one' } };
    const b: ExpansionRequest = { yamlOverride, templateParameters: { greeting: 'two' } };
    expect(expansionRequestHash(a)).not.toBe(expansionRequestHash(b));
  });

  it('is insensitive to key order, so the cache does not miss on a reordering', () => {
    expect(expansionRequestHash({ yamlOverride, templateParameters: { a: '1', b: '2' } })).toBe(
      expansionRequestHash({ yamlOverride, templateParameters: { b: '2', a: '1' } }),
    );
  });

  it('leaves the no-parameter hash exactly as it was, so warm caches stay valid', () => {
    // The pre-existing definition was sha256 of the override text alone, recomputed here rather
    // than compared against the function — otherwise the assertion is circular and a change to
    // the empty case would still pass.
    const before = createHash('sha256').update(yamlOverride, 'utf8').digest('hex');
    expect(expansionRequestHash({ yamlOverride })).toBe(before);
    expect(expansionRequestHash({ yamlOverride, templateParameters: {} })).toBe(before);
  });

  it('distinguishes a parameter from the same text appended to the override', () => {
    expect(expansionRequestHash({ yamlOverride, templateParameters: { a: '1' } })).not.toBe(
      expansionRequestHash({ yamlOverride: yamlOverride + 'a: 1\n' }),
    );
  });
});

describe('what the service does with the field — replayed transcripts', () => {
  it('a supplied value overrides the declared default (C-E03-414)', () => {
    expect(echoed('declared-overridden')).toBe('from-request');
    expect(echoed('declared-not-supplied')).toBe('from-default');
  });

  it('an undeclared name is rejected, so we must not invent names (C-E03-415)', () => {
    expect(rejection('undeclared-name').message).toBe("Unexpected parameter 'nosuchparameter'");
    expect(rejection('undeclared-name').typeKey).toBe('PipelineValidationException');
  });

  it('a string binds to a number-typed parameter (C-E03-416)', () => {
    expect(echoed('number-typed')).toBe('42');
    expect(echoed('number-typed-raw')).toBe('42');
  });

  it('a raw JSON object is refused and the JSON string binds (C-E03-417)', () => {
    const refused = rejection('object-typed-raw');
    expect(refused.typeKey).toBe('ArgumentNullException');
    expect(refused.message).toContain('runParameters');
    // Sent as a string, the same object arrives as a real object — `convertToJson` renders it.
    expect(transcript('object-typed-string', 'final.yml')).toContain('"key": "value"');
  });

  it('the field cannot reach a template’s parameters (C-E03-418)', () => {
    // This is what closes E03-S06-T05's option (c): `greeting` is declared by the *included*
    // template, and the service rejects it as unexpected at the root.
    expect(rejection('template-scoped').message).toBe("Unexpected parameter 'greeting'");
  });
});

describe('the Done criterion — reference-level `parameters:` reach the expansion', () => {
  it('a `- template:` with `parameters:` expands to the supplied value', () => {
    // Reference-level parameters travel **in the YAML**, not in the request field (C-E03-418), so
    // this needs no plumbing at all — which is itself the finding that corrects the task's Do.
    // The transcript is E03-S06-T02's `passed-committed`: `parameters: {greeting: passed-value}`
    // on a `- template:` whose leaf declares `greeting` with a different default.
    const finalYaml = readFileSync(
      join(repoRoot, 'research/experiments/E03-bundle/passed-committed/final.yml'),
      'utf8',
    );
    expect(finalYaml).toContain('echo passed-value');
    expect(finalYaml).not.toContain('unused-default');
  });
});
