// E03-S07-T01 — write the bundle's provenance into the generated project.
//
// The question this answers is the one a user asks when an expansion surprises them: *what exactly
// did you send, and where did each piece come from?* On the default path nothing local expands, so
// there is no `expansion-map.json` to consult (docs/04 §1 marks that fallback-only) — the whole
// local contribution is the bundler's, and this is its record.
//
// Two files, because they answer two different questions and one of them is for a human:
//
//   pipeline.bundled.yml   the exact bytes sent as `yamlOverride`, redacted — readable, diffable,
//                          and re-submittable by hand when reproducing a service rejection.
//   bundle.json            the machine-readable map: which local file was inlined where, its
//                          content hash, and every reference that was **not** inlined with the
//                          reason. The skipped list matters as much as the inlined one; it is the
//                          difference between "this expanded from your working tree" and "this
//                          expanded from what is committed" (C-E03-413, C-E03-419).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { BundleResult } from './inline.js';

/** Bumped only when a consumer would misread an older document; nothing reads it yet. */
export const BUNDLE_PROVENANCE_VERSION = 1;

export const BUNDLED_OVERRIDE_FILE = 'pipeline.bundled.yml';
export const BUNDLE_MAP_FILE = 'bundle.json';

/**
 * Strips secrets from text on its way to disk.
 *
 * **Injected rather than imported.** Redaction lives in `packages/fetch` with the org/PAT config it
 * needs, and `engine → fetch` is the wrong dependency direction — the same reasoning decision 42(a)
 * applied to the offline-expander port. The default is identity so a caller that genuinely has no
 * credentials in scope is not forced to invent a config; whoever wires `convert` (E10-S02-T01)
 * passes `redact(text, config)` from the fetch package.
 */
export type Redactor = (text: string) => string;

export interface BundleProvenanceOptions {
  /** Repository path the override stands at; matches `InlineOptions.rootPath`. */
  readonly rootPath?: string;
  readonly redact?: Redactor;
}

export interface InlinedRecord {
  readonly path: string;
  readonly from: string;
  readonly sha256: string;
}

export interface SkippedRecord {
  readonly reason: string;
  readonly site: string;
  readonly reference: string;
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

export interface BundleProvenance {
  readonly version: number;
  readonly root: string;
  /**
   * SHA-256 of the **redacted** override — the same bytes `pipeline.bundled.yml` holds, so the two
   * files can be checked against each other. Deliberately *not* the hash the expansion cache keys
   * on (`expansionRequestHash`, which covers the raw override plus `templateParameters`): those
   * answer different questions, and conflating them would let a reader treat this as a cache key.
   */
  readonly overrideSha256: string;
  /** Local files whose bytes were spliced in, in the order they were inlined. */
  readonly inlined: readonly InlinedRecord[];
  /** References left in the override, with the reason each one was not inlined. */
  readonly skipped: readonly SkippedRecord[];
}

/** Build the provenance record without touching the filesystem. */
export function bundleProvenance(
  result: BundleResult,
  options: BundleProvenanceOptions = {},
): { readonly override: string; readonly provenance: BundleProvenance } {
  const redact = options.redact ?? ((text: string) => text);
  const override = redact(result.yaml);
  return {
    override,
    provenance: {
      version: BUNDLE_PROVENANCE_VERSION,
      root: options.rootPath ?? '/azure-pipelines.yml',
      overrideSha256: createHash('sha256').update(override, 'utf8').digest('hex'),
      inlined: result.inlined.map((entry) => ({
        path: entry.path,
        from: entry.from,
        sha256: entry.sha256,
      })),
      skipped: result.skipped.map((entry) => ({
        reason: entry.reason,
        site: entry.site,
        // Redacted like the override: a reference is user-authored text and can name a host.
        reference: redact(entry.text),
        file: entry.file,
        line: entry.range.line,
        col: entry.range.col,
      })),
    },
  };
}

/**
 * Write `pipeline.bundled.yml` and `bundle.json` into `outputDir`, creating it if needed.
 *
 * Returns the two paths so a caller can report them. The emitter (E05) calls this with the
 * generated project's root; it is a plain function rather than part of an emitter interface so the
 * bundler's record does not wait on E05 to exist.
 */
export function writeBundleProvenance(
  outputDir: string,
  result: BundleResult,
  options: BundleProvenanceOptions = {},
): { readonly overrideFile: string; readonly mapFile: string } {
  const { override, provenance } = bundleProvenance(result, options);
  mkdirSync(outputDir, { recursive: true });

  const overrideFile = path.join(outputDir, BUNDLED_OVERRIDE_FILE);
  const mapFile = path.join(outputDir, BUNDLE_MAP_FILE);
  writeFileSync(overrideFile, override, 'utf8');
  writeFileSync(mapFile, JSON.stringify(provenance, undefined, 2) + '\n', 'utf8');
  return { overrideFile, mapFile };
}
