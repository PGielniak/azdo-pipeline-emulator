// E01-S02-T03 — injection point for the *organization's* YAML schema.
//
// `GET {org}/_apis/distributedtask/yamlschema` (org-scoped, no project segment — C-E01-029) returns
// the same document kind as the vendored `service-schema.json`: draft-07, same generator `$id`, same
// four VS Code-extension keywords, same 119 definitions (C-E01-030). That is what makes injection a
// **wholesale swap** rather than a merge — nothing the vendored file teaches our walk is lost by
// using the org document instead.
//
// What is gained: the org document is a strict superset of the vendored task list (269 vs 254 names,
// none missing), including marketplace tasks with fully described inputs — in the test org,
// `replacetokens@3..@7` from `qetza.replacetokens` (C-E01-031). Marketplace task *inputs* can only
// be validated this way; offline we fall back to the vendored snapshot and downgrade unknown tasks
// and their inputs to warnings (C-E01-020).
//
// Fetching and caching the document belongs to E08-S03-T07; this module owns the part that must not
// be duplicated there — deciding whether a document is safe to validate against, and correcting it.
import { applyDocumentedCorrections, loadPipelineSchema, type JsonSchema } from './schema.js';
import { unsupportedKeywords } from './validate.js';

/** `$id` every document from this generator carries — the vendored file and the org response alike
 *  (C-E01-030). Checked as a hint, never as a hard gate: it is a generator marker, not a version. */
export const SCHEMA_GENERATOR_ID =
  'https://github.com/Microsoft/azure-pipelines-vscode/blob/main/service-schema.json';

/** The only JSON-schema dialect this front end implements (C-E01-030). */
export const SUPPORTED_DIALECT = 'http://json-schema.org/draft-07/schema#';

/** Which document a validation ran against. */
export type SchemaSource = 'vendored' | 'org';

export interface SchemaResolution {
  /** The document to validate against — corrected, and safe for the walk in `validate.ts`. */
  readonly schema: JsonSchema;
  /** `'org'` only when the supplied document passed {@link checkOrgSchema}. */
  readonly schemaSource: SchemaSource;
  /** Why the org document was refused. Empty when it was accepted, or when none was supplied. */
  readonly problems: readonly string[];
}

/**
 * Is `document` a per-org pipeline schema this front end can validate against?
 *
 * Returns the reasons it is not; empty means yes. The keyword check is the load-bearing one: our
 * walk implements a fixed keyword set (`SUPPORTED_KEYWORDS`), and a keyword it does not implement is
 * silently *ignored* rather than failing loudly — which would quietly accept invalid pipelines.
 * Falling back to the vendored schema is always the safer answer.
 */
export function checkOrgSchema(document: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(document)) {
    return [`expected a JSON object, got ${document === null ? 'null' : typeof document}`];
  }

  const dialect = document['$schema'];
  if (dialect !== SUPPORTED_DIALECT) {
    problems.push(
      `unsupported JSON-schema dialect ${JSON.stringify(dialect ?? '(absent)')} ` +
        `(this front end implements ${SUPPORTED_DIALECT})`,
    );
  }

  const definitions = document['definitions'];
  if (!isRecord(definitions)) {
    problems.push('no `definitions` object — not a pipeline schema');
  } else if (!isRecord(definitions['task'])) {
    problems.push('no `definitions.task` — not a pipeline schema');
  }
  if (!Array.isArray(document['oneOf'])) {
    problems.push('root is not the documented `oneOf` of pipeline forms');
  }

  const unsupported = unsupportedKeywords(document);
  if (unsupported.length > 0) {
    problems.push(
      `uses schema keywords this validator does not implement: ${unsupported.join(', ')}`,
    );
  }
  return problems;
}

export interface ResolveSchemaOptions {
  /** A parsed org-schema document (E08-S03-T07 fetches/caches it). Absent ⇒ offline/vendored. */
  readonly orgSchema?: unknown;
}

/**
 * Pick the schema to validate against: the org document when it is usable, the vendored snapshot
 * otherwise. Never throws — an unusable org document degrades to the vendored schema with the
 * reasons in `problems`, because a stale or surprising server response must not block conversion.
 *
 * The accepted org document is copied and then corrected: `DOCUMENTED_CORRECTIONS` fix generator
 * bugs, not snapshot bugs — the org response omits `target` on task steps exactly as the vendored
 * file does (C-E01-037), so without this, authenticating would start rejecting documented-valid YAML.
 */
export function resolvePipelineSchema(options: ResolveSchemaOptions = {}): SchemaResolution {
  const { orgSchema } = options;
  if (orgSchema === undefined) {
    return { schema: loadPipelineSchema(), schemaSource: 'vendored', problems: [] };
  }
  const problems = checkOrgSchema(orgSchema);
  if (problems.length > 0) {
    return { schema: loadPipelineSchema(), schemaSource: 'vendored', problems };
  }
  const schema = applyDocumentedCorrections(structuredClone(orgSchema) as JsonSchema);
  return { schema, schemaSource: 'org', problems: [] };
}

/** Parse a fetched/cached org schema, turning a JSON error into a `checkOrgSchema`-style problem. */
export function parseOrgSchema(text: string): { document?: unknown; problems: string[] } {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    return { problems: [`not valid JSON: ${(error as Error).message}`] };
  }
  const problems = checkOrgSchema(document);
  return problems.length > 0 ? { problems } : { document, problems: [] };
}

/**
 * Task names a schema document knows, in document order.
 *
 * Ordering is *not* stable across calls to the service (C-E01-034), so compare these as sets. Two
 * callers need this: the swap test, and the coverage report (E07), which reports how many task
 * references were resolvable against the catalog actually in use.
 */
export function taskNames(schema: JsonSchema): string[] {
  const definitions = schema['definitions'];
  if (!isRecord(definitions)) return [];
  const task = definitions['task'];
  if (!isRecord(task)) return [];
  const properties = task['properties'];
  if (!isRecord(properties)) return [];
  const taskProperty = properties['task'];
  if (!isRecord(taskProperty)) return [];
  const alternatives = taskProperty['anyOf'];
  if (!Array.isArray(alternatives)) return [];
  return alternatives.flatMap((alternative) => {
    if (!isRecord(alternative)) return [];
    const values = alternative['enum'];
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is string => typeof value === 'string');
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
