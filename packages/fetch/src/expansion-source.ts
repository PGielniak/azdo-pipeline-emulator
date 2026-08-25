/**
 * Which expander produced the pipeline's `finalYaml` — the service, or the retained local engine
 * (E12-S01-T01).
 *
 * PLAN D3 makes the Pipelines `preview` endpoint *the* expansion step: parity by construction.
 * The in-repo template engine and compile-time `${{ }}` evaluator (E03, the runtime half of E02)
 * are retained as an explicitly-requested, **degraded** fallback for a user with no preview access
 * (docs/07 §6) — never as the default and never silently. This module is the single seam that
 * decides between the two, so "did the default path touch the local engine?" is one assertion
 * rather than a property of however `convert` happens to be wired.
 *
 * Grounding: PLAN D3 (server-expanded), D4 (the engine is a fallback, not deleted), D6 (only the
 * *runtime* expression half stays local), docs/07 §6 (the demotion table). No Azure DevOps
 * behavior is implemented here, so BACKLOG §3.4 applies: the service is the authority by
 * construction and there is nothing to re-ground.
 *
 * The local engine is reached through the {@link OfflineExpander} port rather than an import: the
 * direction `fetch → engine` would be wrong, and the port keeps the default binding a decision of
 * whoever wires `convert` (E10-S02-T01). There is no default implementation: an unbound port
 * refuses. Since E03-S04-T02 the engine side exists — `expandDocument` in
 * `packages/engine/src/template/expand.ts` — so what is left is the wiring, not the expander.
 */

import {
  expandCached,
  finalYamlHash,
  type ExpandCachedOptions,
  type ExpansionLockEntry,
} from './expansion-cache.js';
import { expansionRequestHash, type ExpansionRequest } from './expand.js';
import type { OracleConfig } from './oracle.js';

/** Where a `finalYaml` came from. `offline` is always the degraded arm (PLAN D3). */
export type ExpansionMode = 'service' | 'offline';

/** What the retained local engine returns. Its own diagnostics ride along as warnings. */
export interface OfflineExpansion {
  readonly finalYaml: string;
  readonly warnings?: readonly string[];
}

/** The port the retained compile-time engine is reached through (E03). */
export type OfflineExpander = (
  request: ExpansionRequest,
) => OfflineExpansion | Promise<OfflineExpansion>;

/**
 * The warning every fallback conversion carries. `convert` surfaces it on stderr and the emitted
 * README's warnings list (E12-S02-T01), so a project expanded this way is never mistaken for one
 * the service expanded.
 */
export const OFFLINE_EXPANSION_WARNING =
  'expanded offline by the retained local template engine (--offline-expand): this is a degraded ' +
  'fallback — the Azure DevOps service is the authority on template and ${{ }} expansion, and the ' +
  'local engine may differ. Re-convert without --offline-expand when you have preview access.';

/** Thrown when `--offline-expand` is used with no local expander bound. */
export class OfflineExpansionUnavailableError extends Error {
  constructor() {
    super(
      'offline expansion is not available: no local expander is bound. ' +
        "The engine's `expandDocument` provides one (E03-S04-T02); binding it to this port is " +
        'the convert wiring (E10-S02-T01). Until then, drop --offline-expand and use the service.',
    );
    this.name = 'OfflineExpansionUnavailableError';
  }
}

/** Thrown when the service arm is selected without the organization/pipeline context it needs. */
export class ExpansionConfigMissingError extends Error {
  constructor() {
    super(
      'service expansion needs an organization, project and pipeline id: sign in and set the ' +
        'pipeline context, or pass --offline-expand to use the degraded local engine.',
    );
    this.name = 'ExpansionConfigMissingError';
  }
}

/**
 * What the manifest records about this conversion's expansion (docs/04 manifest, written by the
 * emitter in E05). Discriminated rather than optional-per-field so the offline arm cannot claim an
 * api-version or a pipeline id it never had.
 */
export type ExpansionManifestEntry =
  | {
      readonly mode: 'service';
      readonly degraded: false;
      readonly requestHash: string;
      readonly finalYamlHash: string;
      readonly apiVersion: string;
      readonly pipelineId: number;
      readonly fromCache: boolean;
    }
  | {
      readonly mode: 'offline';
      readonly degraded: true;
      readonly requestHash: string;
      readonly finalYamlHash: string;
    };

export interface ResolveExpansionOptions extends ExpandCachedOptions {
  /** `--offline-expand`. Absent or false = the service path (PLAN D3). */
  readonly offlineExpand?: boolean;
  /** The retained local engine. Only ever consulted on the offline arm. */
  readonly offlineExpander?: OfflineExpander;
  /** Organization/pipeline context for the service arm; unused offline. */
  readonly config?: OracleConfig;
}

export interface ResolvedExpansion {
  readonly mode: ExpansionMode;
  readonly finalYaml: string;
  /** Empty on the service path; always non-empty on the fallback. */
  readonly warnings: readonly string[];
  readonly manifest: ExpansionManifestEntry;
}

/**
 * Obtain the pipeline's expanded form from whichever expander the user selected.
 *
 * The service arm goes through {@link expandCached}, so `--frozen` still resolves from cache and
 * the lockfile is still pinned. The offline arm deliberately writes **neither**: its output is not
 * the service's, and an `expansion` lock entry pinning an api-version/pipeline id it never touched
 * would misrepresent where the YAML came from. Its hashes are still reported so the manifest can
 * record what was expanded.
 */
export async function resolveExpansion(
  request: ExpansionRequest,
  options: ResolveExpansionOptions,
): Promise<ResolvedExpansion> {
  if (options.offlineExpand === true) {
    return offlineArm(request, options.offlineExpander);
  }

  if (options.config === undefined) throw new ExpansionConfigMissingError();
  const cached = await expandCached(options.config, request, serviceOptions(options));
  return {
    mode: 'service',
    finalYaml: cached.finalYaml,
    warnings: [],
    manifest: serviceManifest(cached.entry, cached.fromCache),
  };
}

async function offlineArm(
  request: ExpansionRequest,
  expander: OfflineExpander | undefined,
): Promise<ResolvedExpansion> {
  if (expander === undefined) throw new OfflineExpansionUnavailableError();
  const expansion = await expander(request);
  return {
    mode: 'offline',
    finalYaml: expansion.finalYaml,
    warnings: [OFFLINE_EXPANSION_WARNING, ...(expansion.warnings ?? [])],
    manifest: {
      mode: 'offline',
      degraded: true,
      requestHash: expansionRequestHash(request),
      finalYamlHash: finalYamlHash(expansion.finalYaml),
    },
  };
}

function serviceManifest(entry: ExpansionLockEntry, fromCache: boolean): ExpansionManifestEntry {
  return {
    mode: 'service',
    degraded: false,
    requestHash: entry.requestHash,
    finalYamlHash: entry.finalYamlHash,
    apiVersion: entry.apiVersion,
    pipelineId: entry.pipelineId,
    fromCache,
  };
}

/** Narrow to the cache client's own options. Built key-by-key: `exactOptionalPropertyTypes` makes
 *  an explicit `undefined` a type error, so an absent option must stay absent. */
function serviceOptions(options: ResolveExpansionOptions): ExpandCachedOptions {
  return {
    cacheDir: options.cacheDir,
    ...(options.lockfilePath === undefined ? {} : { lockfilePath: options.lockfilePath }),
    ...(options.frozen === undefined ? {} : { frozen: options.frozen }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  };
}
