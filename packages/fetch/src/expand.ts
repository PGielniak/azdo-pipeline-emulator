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

/** SHA-256 of the override, hex-encoded — stable across processes and platforms. */
export function expansionRequestHash(yamlOverride: string): string {
  return createHash('sha256').update(yamlOverride, 'utf8').digest('hex');
}

/** Provenance for a request against a config; callers persist it beside the redacted response. */
export function provenanceFor(
  config: OracleConfig,
  request: ExpansionRequest,
): ExpansionProvenance {
  return {
    apiVersion: config.apiVersion,
    pipelineId: config.pipelineId,
    requestHash: expansionRequestHash(request.yamlOverride),
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
