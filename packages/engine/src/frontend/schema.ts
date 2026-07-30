// E01-S02-T01 — loader for the vendored Azure Pipelines JSON schema (E00-S02-T01) plus
// the small set of corrections the official docs prove the vendored file needs.
//
// The vendored `service-schema.json` is generated for the VS Code extension; it is the best
// machine-readable source we have, but the doc/schema cross-check (research/E01-yaml-frontend.md,
// C-E01-010..C-E01-014) found places where it rejects YAML that learn.microsoft.com documents as
// valid. Those — and only those — are patched here, each with the claim that proves it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** A JSON-schema document/subschema. Deliberately loose: the vendored file mixes draft-07 with
 *  the VS Code extension's own keywords (`firstProperty`, `ignoreCase`, `aliases`, … C-E00-008). */
export type JsonSchema = Record<string, unknown>;

export interface SchemaCorrection {
  /** Where in the schema document the correction lands. */
  pointer: string;
  /** Claim ID (research/E01-yaml-frontend.md) proving the vendored schema is wrong here. */
  claim: string;
  reason: string;
  apply: (schema: JsonSchema) => void;
}

/** Corrections applied to the vendored schema on load. Add only doc-proven entries. */
export const DOCUMENTED_CORRECTIONS: readonly SchemaCorrection[] = [
  {
    pointer: '#/definitions/task/properties/target',
    claim: 'C-E01-011',
    reason:
      'steps.task documents `target` (“Environment in which to run this task”, plus a shorthand ' +
      'example) but the vendored `task` definition omits it while setting additionalProperties:false, ' +
      'so documented-valid task steps would be rejected.',
    apply(schema) {
      const task = definitionOf(schema, 'task');
      const properties = task?.['properties'];
      if (!isRecord(properties) || 'target' in properties) return;
      properties['target'] = {
        description: 'Environment in which to run this task',
        $ref: '#/definitions/stepTarget',
      };
    },
  },
];

let cached: JsonSchema | undefined;

/** Absolute path of the vendored schema (walks up from this module to the package root). */
export function vendoredSchemaPath(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'vendor', 'schema', 'service-schema.json');
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(
    'vendored service-schema.json not found (expected under packages/engine/vendor/schema)',
  );
}

export interface LoadSchemaOptions {
  /** Apply DOCUMENTED_CORRECTIONS (default true). `false` yields the file as vendored. */
  corrections?: boolean;
}

/** The pipeline schema, corrected by default. The corrected document is cached and shared. */
export function loadPipelineSchema(options: LoadSchemaOptions = {}): JsonSchema {
  const withCorrections = options.corrections !== false;
  if (!withCorrections) {
    return JSON.parse(readFileSync(vendoredSchemaPath(), 'utf8')) as JsonSchema;
  }
  if (!cached) {
    const schema = JSON.parse(readFileSync(vendoredSchemaPath(), 'utf8')) as JsonSchema;
    for (const correction of DOCUMENTED_CORRECTIONS) correction.apply(schema);
    cached = schema;
  }
  return cached;
}

function definitionOf(schema: JsonSchema, name: string): Record<string, unknown> | undefined {
  const definitions = schema['definitions'];
  if (!isRecord(definitions)) return undefined;
  const definition = definitions[name];
  return isRecord(definition) ? definition : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
