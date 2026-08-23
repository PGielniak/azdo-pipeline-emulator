/**
 * Expansion service — the product's convert-time expansion step (E00-S04-T01).
 *
 * Wraps the preview oracle client (E00-S03-T02) into the API `convert` will call: hand the
 * service the local pipeline YAML, get back the fully expanded `finalYaml` plus provenance for
 * the cache/lockfile (E00-S04-T02). Expansion parity is the service's, not ours (PLAN D3;
 * docs/07 §4) — this module grounds only its own mechanics (the request hash and the
 * provenance shape), not template/`${{ }}` behavior.
 *
 * Grounding: C-E00-017 (route), C-E00-018 (body + `finalYaml` field), C-E00-020 (auth),
 * C-E00-024..027 (failure modes) — all established live in `research/experiments/oracle-spike/`.
 */

import { createHash } from 'node:crypto';
import { preview, type OracleConfig } from './oracle.js';

/** Narrow fetch shape, matching `preview()`'s own injectable-fetch contract (oracle.ts). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** What `convert` supplies: the local pipeline and (optionally) its runtime parameters. */
export interface ExpansionRequest {
  readonly yamlOverride: string;
  readonly templateParameters?: Readonly<Record<string, string>>;
}

/**
 * Content-addressed identity of an expansion request, recorded so the cache/lockfile can pin a
 * `finalYaml` to the exact request that produced it (E00-S04-T02). `redacted` is a constant
 * invariant: every persisted expansion transcript is redacted before it is stored (D7 / rule 4).
 */
export interface ExpansionProvenance {
  readonly apiVersion: string;
  readonly pipelineId: number;
  readonly requestHash: string;
  readonly redacted: boolean;
}

export type ExpansionOutcome =
  | {
      readonly kind: 'expanded';
      readonly finalYaml: string;
      readonly provenance: ExpansionProvenance;
    }
  | {
      readonly kind: 'rejected';
      readonly message: string;
      readonly typeKey: string | undefined;
      readonly provenance: ExpansionProvenance;
    }
  | { readonly kind: 'unauthenticated'; readonly provenance: ExpansionProvenance }
  | { readonly kind: 'transport'; readonly provenance: ExpansionProvenance };

/**
 * SHA-256 of the request, hex-encoded — stable across processes and platforms.
 *
 * **Covers `templateParameters`, not just the override (E03-S06-T03).** Two conversions of the same
 * pipeline with different parameter values produce genuinely different expansions — the service
 * substitutes them (C-E03-414) — so hashing the override alone would have let the second read the
 * first's cached `finalYaml`. Nothing exercised that before this task, because nothing set the
 * field; it is fixed here rather than left for whoever first sets it.
 *
 * A request with no parameters hashes to the **override alone**, exactly as before, so existing
 * cache entries and `azdo-emu.lock.json` pins stay valid. Only the parameterized case is new
 * ground, and the composite is canonical — keys sorted — so key order cannot change the hash.
 */
export function expansionRequestHash(request: ExpansionRequest): string {
  const parameters = request.templateParameters ?? {};
  const names = Object.keys(parameters).sort();
  const payload =
    names.length === 0
      ? request.yamlOverride
      : JSON.stringify({
          yamlOverride: request.yamlOverride,
          templateParameters: names.map((name) => [name, parameters[name]]),
        });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Render `--parameter` values into the `Record<string, string>` the request field carries.
 *
 * Measured rules (C-E03-416/417). The service coerces a string to the parameter's declared type, so
 * `'42'` binds to a `type: number` parameter as the number 42. A **structured** value must be sent
 * as serialized JSON: a raw JSON object in the field is refused with a server-side
 * `ArgumentNullException` ("Value cannot be null. Parameter name: runParameters"), while the same
 * object as a JSON *string* binds and is parsed back into a real object. So everything that is not
 * already a string goes through `JSON.stringify`, which renders numbers and booleans as their bare
 * text and objects/arrays as the JSON the service expects.
 *
 * `undefined` values are dropped rather than rendered: the field cannot express "declared but
 * unset", and the service rejects a name the pipeline does not declare (C-E03-415).
 */
export function serializeTemplateParameters(
  values: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    out[name] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

/** Provenance for a request against a config; callers persist it beside the redacted response. */
export function provenanceFor(
  config: OracleConfig,
  request: ExpansionRequest,
): ExpansionProvenance {
  return {
    apiVersion: config.apiVersion,
    pipelineId: config.pipelineId,
    requestHash: expansionRequestHash(request),
    redacted: true,
  };
}

/**
 * Expand a pipeline by delegating to the service (PLAN D3). On success the returned `finalYaml`
 * is the service's own fully-expanded document; it is returned **raw** (redaction happens only
 * when a transcript is persisted, in E00-S04-T02).
 */
export async function expand(
  config: OracleConfig,
  request: ExpansionRequest,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<ExpansionOutcome> {
  const provenance = provenanceFor(config, request);
  const outcome = await preview(config, request, fetchImpl);

  switch (outcome.kind) {
    case 'expanded':
      return { kind: 'expanded', finalYaml: outcome.finalYaml, provenance };
    case 'rejected':
      return { kind: 'rejected', message: outcome.message, typeKey: outcome.typeKey, provenance };
    case 'unauthenticated':
      return { kind: 'unauthenticated', provenance };
    case 'transport':
      return { kind: 'transport', provenance };
  }
}
