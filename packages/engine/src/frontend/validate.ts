// E01-S02-T01 — schema validation over the vendored Azure Pipelines schema, producing the
// targeted diagnostics of docs/01 §1 ("the schema is a huge oneOf; we post-process to produce
// readable messages") instead of a raw alternatives explosion.
//
// Why a guided walk instead of handing the document to ajv: the vendored schema is only half
// JSON-Schema. Its acceptance semantics are defined by the four VS Code-extension keywords
// (`firstProperty`, `ignoreCase`, `aliases`, `doNotSuggest`, C-E00-008) plus a set of scalar
// coercions that plain draft-07 does not express — YAML booleans/numbers/nulls validate against
// `type: string` (C-E01-015), `${{ }}`/`$( )`/`$[ ]` values are exempt from type checks
// (C-E01-016), enums compare case-insensitively (C-E01-017). Running ajv over the raw file
// therefore both *rejects valid pipelines* and emits thousands of errors per typo (C-E01-019).
// This walk mirrors the vendor's own validator, microsoft/azure-pipelines-language-server
// `language-service/src/parser/jsonParser.ts` (C-E01-015..C-E01-018), over our DOM so every
// diagnostic keeps file:line:col provenance from E01-S01-T01.
import type { Diagnostic, Severity } from './diagnostics.js';
import type { MappingEntry, MappingNode, ParseResult, PipelineNode, ScalarValue } from './parse.js';
import type { JsonSchema } from './schema.js';
import { loadPipelineSchema } from './schema.js';

export const SCHEMA_TYPE = 'SCHEMA_TYPE';
export const SCHEMA_VALUE = 'SCHEMA_VALUE';
export const SCHEMA_UNKNOWN_KEY = 'SCHEMA_UNKNOWN_KEY';
export const SCHEMA_MISSING_KEY = 'SCHEMA_MISSING_KEY';
export const SCHEMA_NO_MATCHING_FORM = 'SCHEMA_NO_MATCHING_FORM';
export const SCHEMA_FIRST_PROPERTY = 'SCHEMA_FIRST_PROPERTY';
export const SCHEMA_UNKNOWN_TASK = 'SCHEMA_UNKNOWN_TASK';
export const SCHEMA_UNKNOWN_TASK_INPUT = 'SCHEMA_UNKNOWN_TASK_INPUT';
export const SCHEMA_TOO_FEW_PROPERTIES = 'SCHEMA_TOO_FEW_PROPERTIES';

/** draft-07 keywords this walk implements; the vendored schema uses no others (asserted in tests).
 *  An org-fetched schema (E01-S02-T03) must be re-checked against this set before it is trusted. */
export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  // structural
  '$ref',
  'type',
  'properties',
  'additionalProperties',
  'patternProperties',
  'required',
  'items',
  'anyOf',
  'oneOf',
  'enum',
  'pattern',
  'minProperties',
  // annotations (no effect on acceptance)
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'definitions',
  'examples',
  'default',
  // VS Code extension keywords (C-E00-008)
  'firstProperty',
  'ignoreCase',
  'aliases',
  'doNotSuggest',
  'deprecationMessage',
]);

export interface ValidateOptions {
  /** Schema document to validate against; defaults to the corrected vendored schema.
   *  Per-org injection goes through `resolvePipelineSchema()` (org-schema.ts, E01-S02-T03), whose
   *  result spreads straight into these options. */
  schema?: JsonSchema;
  /** Which document `schema` is, so diagnostics can explain *why* something is unknown.
   *  Defaults to `'vendored'`. */
  schemaSource?: 'vendored' | 'org';
}

/** Schema-validate a parsed pipeline document. Returns diagnostics in document order. */
export function validatePipeline(
  parsed: Pick<ParseResult, 'file' | 'root'>,
  options: ValidateOptions = {},
): Diagnostic[] {
  if (!parsed.root) return [];
  const schema = options.schema ?? loadPipelineSchema();
  const ctx: Ctx = {
    file: parsed.file,
    root: schema,
    schemaSource: options.schemaSource ?? 'vendored',
  };
  const diagnostics: Diagnostic[] = [];
  validateNode(parsed.root, schema, '#', '$', ctx, diagnostics);
  return diagnostics;
}

/** Schema keywords used by `schema` (and everything below it) that this walk does not implement. */
export function unsupportedKeywords(schema: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (!SUPPORTED_KEYWORDS.has(key)) found.add(key);
      // `properties`/`patternProperties`/`definitions` hold *names*, not keywords.
      if (key === 'properties' || key === 'patternProperties' || key === 'definitions') {
        if (isRecord(value)) Object.values(value).forEach(visit);
      } else {
        visit(value);
      }
    }
  };
  visit(schema);
  return [...found].sort();
}

interface Ctx {
  file: string;
  root: JsonSchema;
  /** See ValidateOptions.schemaSource — only diagnostics wording depends on it. */
  schemaSource: 'vendored' | 'org';
}

type Kind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

// ---------------------------------------------------------------------------
// walk
// ---------------------------------------------------------------------------

function validateNode(
  node: PipelineNode,
  rawSchema: JsonSchema,
  rawPointer: string,
  path: string,
  ctx: Ctx,
  out: Diagnostic[],
): void {
  const { schema, pointer } = deref(rawSchema, rawPointer, ctx);

  if (!checkType(node, schema, path, ctx, out)) return;

  const alternatives = arrayOf(schema['anyOf']) ?? arrayOf(schema['oneOf']);
  if (alternatives) {
    validateAlternatives(node, alternatives.filter(isRecord), pointer, path, ctx, out);
  }

  if (node.kind === 'scalar') {
    checkEnum(node.value, schema, pointer, path, node, ctx, out);
    checkPattern(node.value, schema, path, node, ctx, out);
    return;
  }
  if (node.kind === 'sequence') {
    const items = schema['items'];
    if (isRecord(items)) {
      node.items.forEach((item, index) => {
        validateNode(item, items, `${pointer}/items`, `${path}[${index}]`, ctx, out);
      });
    }
    return;
  }
  validateMapping(node, schema, pointer, path, ctx, out);
}

// ---------------------------------------------------------------------------
// type / value checks
// ---------------------------------------------------------------------------

/** Returns false when the node's type is wrong (recursion into it would be noise). */
function checkType(
  node: PipelineNode,
  schema: JsonSchema,
  path: string,
  ctx: Ctx,
  out: Diagnostic[],
): boolean {
  const expected = schema['type'];
  if (typeof expected !== 'string') return true;
  const kind = kindOf(node);
  if (kindMatches(kind, expected, node)) return true;
  out.push(
    diagnostic(ctx, node, path, {
      severity: 'error',
      code: SCHEMA_TYPE,
      message: `incorrect type: expected ${describeType(expected)}, found ${describeKind(kind)}`,
    }),
  );
  return false;
}

/** Scalar coercions of the pipeline object model (C-E01-015/016), mirroring jsonParser.ts:
 *  numbers/booleans/nulls satisfy `type: string`, and expression values satisfy any type. */
function kindMatches(kind: Kind, expected: string, node: PipelineNode): boolean {
  if (kind === expected) return true;
  if (expected === 'string') return kind === 'number' || kind === 'boolean' || kind === 'null';
  if (kind === 'string' && node.kind === 'scalar' && isExpression(node.value)) return true;
  if (expected === 'integer' && kind === 'number') {
    return node.kind === 'scalar' && Number.isInteger(node.value);
  }
  return false;
}

/** `${{ … }}`, `$[ … ]` and `$( … )` values are resolved by Azure Pipelines later, so their
 *  type is unknown at validation time (C-E01-016 — jsonParser.ts "Ignore expressions as those
 *  will be replaced by Azure Pipelines"). */
function isExpression(value: ScalarValue): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return (
    (text.startsWith('${{') && text.endsWith('}}')) ||
    (text.startsWith('$[') && text.endsWith(']')) ||
    (text.startsWith('$(') && text.endsWith(')'))
  );
}

function checkEnum(
  value: ScalarValue,
  schema: JsonSchema,
  pointer: string,
  path: string,
  node: PipelineNode,
  ctx: Ctx,
  out: Diagnostic[],
): void {
  const values = enumValues(schema);
  if (!values || isExpression(value)) return;
  if (matchesEnum(value, values, ignoresValueCase(schema))) return;
  out.push(valueNotAccepted(value, values, pointer, path, node, ctx));
}

function checkPattern(
  value: ScalarValue,
  schema: JsonSchema,
  path: string,
  node: PipelineNode,
  ctx: Ctx,
  out: Diagnostic[],
): void {
  const pattern = schema['pattern'];
  if (typeof pattern !== 'string' || isExpression(value)) return;
  // No `u` flag: the schema's patterns are invalid under unicode mode (C-E00-010).
  const regex = new RegExp(pattern, ignoresValueCase(schema) ? 'i' : '');
  if (regex.test(scalarText(value))) return;
  out.push(
    diagnostic(ctx, node, path, {
      severity: 'error',
      code: SCHEMA_VALUE,
      message: `value ${JSON.stringify(scalarText(value))} does not match the required pattern ${pattern}`,
    }),
  );
}

// ---------------------------------------------------------------------------
// mappings
// ---------------------------------------------------------------------------

function validateMapping(
  node: MappingNode,
  schema: JsonSchema,
  pointer: string,
  path: string,
  ctx: Ctx,
  out: Diagnostic[],
): void {
  const properties = isRecord(schema['properties']) ? schema['properties'] : undefined;
  const unmatched = new Set(node.entries.map((entry) => keyText(entry)));

  // required (+ aliases/ignoreCase per jsonParser.ts hasProperty, C-E01-017)
  for (const required of stringsOf(schema['required']) ?? []) {
    if (!findEntry(node, required, properties)) {
      out.push(
        diagnostic(ctx, node, path, {
          severity: 'error',
          code: SCHEMA_MISSING_KEY,
          message: `missing required property "${required}"`,
        }),
      );
    }
  }

  checkFirstProperty(node, schema, path, ctx, out);

  if (properties) {
    for (const [name, rawPropertySchema] of Object.entries(properties)) {
      if (!isRecord(rawPropertySchema)) continue;
      const entry = findEntry(node, name, properties);
      if (!entry) continue;
      unmatched.delete(keyText(entry));
      validateNode(
        entry.value,
        rawPropertySchema,
        `${pointer}/properties/${name}`,
        `${path}${pathStep(name)}`,
        ctx,
        out,
      );
    }
  }

  const patternProperties = isRecord(schema['patternProperties'])
    ? schema['patternProperties']
    : undefined;
  if (patternProperties) {
    for (const [pattern, rawPropertySchema] of Object.entries(patternProperties)) {
      if (!isRecord(rawPropertySchema)) continue;
      const regex = new RegExp(pattern, ignoresKeyCase(rawPropertySchema) ? 'i' : '');
      for (const entry of node.entries) {
        const key = keyText(entry);
        if (!unmatched.has(key) || !regex.test(key)) continue;
        unmatched.delete(key);
        validateNode(
          entry.value,
          rawPropertySchema,
          `${pointer}/patternProperties`,
          `${path}${pathStep(key)}`,
          ctx,
          out,
        );
      }
    }
  }

  const additional = schema['additionalProperties'];
  if (isRecord(additional)) {
    for (const entry of node.entries) {
      if (!unmatched.has(keyText(entry))) continue;
      validateNode(
        entry.value,
        additional,
        `${pointer}/additionalProperties`,
        `${path}${pathStep(keyText(entry))}`,
        ctx,
        out,
      );
    }
  } else if (additional === false) {
    for (const entry of node.entries) {
      const key = keyText(entry);
      if (!unmatched.has(key)) continue;
      const known = properties ? Object.keys(properties) : [];
      const suggestion = nearestName(key, known);
      const unknownInput = isTaskInputsPointer(pointer);
      out.push(
        diagnostic(ctx, entry.key, `${path}${pathStep(key)}`, {
          severity: unknownInput ? 'warning' : 'error',
          code: unknownInput ? SCHEMA_UNKNOWN_TASK_INPUT : SCHEMA_UNKNOWN_KEY,
          message: unknownInput
            ? `unknown input "${key}" for this task`
            : `unexpected property "${key}"`,
          hint: unknownInput
            ? inputHint(suggestion)
            : (suggestion ?? (known.length > 0 ? `allowed here: ${list(known)}` : undefined)),
        }),
      );
    }
  }

  const minProperties = schema['minProperties'];
  if (typeof minProperties === 'number' && node.entries.length < minProperties) {
    out.push(
      diagnostic(ctx, node, path, {
        severity: 'error',
        code: SCHEMA_TOO_FEW_PROPERTIES,
        message: `expected at least ${minProperties} propert${minProperties === 1 ? 'y' : 'ies'}, found ${node.entries.length}`,
      }),
    );
  }
}

/** `firstProperty` marks the discriminating key ("Required as first property" in the docs,
 *  C-E01-012). We enforce *presence* (documented) as an error via the alternatives handling and
 *  *ordering* as a warning: the vendor's editor validator errors on order, but the service's own
 *  tolerance is not yet oracle-verified (research/E01-yaml-frontend.md, open question Q1). */
function checkFirstProperty(
  node: MappingNode,
  schema: JsonSchema,
  path: string,
  ctx: Ctx,
  out: Diagnostic[],
): void {
  const expected = stringsOf(schema['firstProperty']);
  if (!expected || expected.length === 0 || node.entries.length === 0) return;
  const properties = isRecord(schema['properties']) ? schema['properties'] : undefined;
  const first = keyText(node.entries[0]!);
  if (expected.some((name) => sameKey(name, first, properties))) return;
  // Only complain about order when the key is present at all — a missing discriminator is
  // reported once, by the alternatives handling, with the full list of forms.
  const present = expected.find((name) => findEntry(node, name, properties));
  if (!present) return;
  out.push(
    diagnostic(ctx, node.entries[0]!.key, `${path}${pathStep(first)}`, {
      severity: 'warning',
      code: SCHEMA_FIRST_PROPERTY,
      message: `"${present}" should be the first property of this ${expected.length === 1 ? `${present} ` : ''}block, not "${first}"`,
      hint: 'Azure Pipelines documents this key as “required as first property”',
    }),
  );
}

// ---------------------------------------------------------------------------
// anyOf / oneOf — the nearest-branch heuristic
// ---------------------------------------------------------------------------

/** Above this many candidate branches the union is unresolvable from the discriminating *value*
 *  alone (the 259 per-task input branches): the value itself is diagnosed by the enclosing
 *  property check — see `SCHEMA_UNKNOWN_TASK` — so reporting a "closest task" would only mislead. */
const MAX_UNRESOLVED_BRANCHES = 8;

function validateAlternatives(
  node: PipelineNode,
  alternatives: JsonSchema[],
  pointer: string,
  path: string,
  ctx: Ctx,
  out: Diagnostic[],
): void {
  // A union of pure enums (e.g. the 259 known task names) is one value check, not 259 branches.
  if (node.kind === 'scalar' && alternatives.every(isEnumOnly)) {
    const values = alternatives.flatMap((branch) => enumValues(branch) ?? []);
    const ignoreCase = alternatives.some((branch) => ignoresValueCase(branch));
    if (isExpression(node.value) || matchesEnum(node.value, values, ignoreCase)) return;
    out.push(valueNotAccepted(node.value, values, pointer, path, node, ctx));
    return;
  }

  const resolved = alternatives.map((branch) => deref(branch, pointer, ctx).schema);
  const keys = resolved.map(discriminatorKeys);

  // Discriminated forms — steps, jobs, stages, variables, the pipeline's own stages/jobs/steps
  // shapes, per-task inputs: pick the branch the author meant instead of reporting all of them
  // (jsonParser.ts getFirstPropertyMatches, generalized to any key position, C-E01-018).
  if (node.kind === 'mapping' && keys.every((names) => names.length > 0)) {
    const byValue: JsonSchema[] = [];
    const byKey: JsonSchema[] = [];
    resolved.forEach((branch, index) => {
      const match = discriminatorMatch(node, branch, keys[index]!, ctx);
      if (match === 'value') byValue.push(alternatives[index]!);
      else if (match === 'key') byKey.push(alternatives[index]!);
    });
    const candidates = byValue.length > 0 ? byValue : byKey;
    if (candidates.length === 0) {
      out.push(noMatchingForm(node, resolved, path, ctx));
      return;
    }
    if (byValue.length === 0 && candidates.length > MAX_UNRESOLVED_BRANCHES) return;
    reportBestMatch(node, candidates, pointer, path, ctx, out);
    return;
  }

  // Undiscriminated union (pool: string|object, variables: mapping|list, target: string|object…).
  const kind = kindOf(node);
  const compatible = alternatives.filter((_, index) =>
    branchAcceptsKind(resolved[index]!, kind, node),
  );
  if (compatible.length === 0) {
    const expected = [
      ...new Set(
        resolved
          .map((branch) => branch['type'])
          .filter((type): type is string => typeof type === 'string')
          .map(describeType),
      ),
    ];
    out.push(
      diagnostic(ctx, node, path, {
        severity: 'error',
        code: SCHEMA_TYPE,
        message: `incorrect type: expected ${expected.length > 0 ? expected.join(' or ') : 'a different type'}, found ${describeKind(kind)}`,
      }),
    );
    return;
  }
  reportBestMatch(node, compatible, pointer, path, ctx, out);
}

/** Validates against each candidate; a clean one wins, otherwise the closest one's problems are
 *  reported (jsonParser.ts keeps the "best match" for its error messages). */
function reportBestMatch(
  node: PipelineNode,
  candidates: JsonSchema[],
  pointer: string,
  path: string,
  ctx: Ctx,
  out: Diagnostic[],
): void {
  let best: Diagnostic[] | undefined;
  for (const [index, candidate] of candidates.entries()) {
    const sub: Diagnostic[] = [];
    validateNode(node, candidate, `${pointer}/anyOf/${index}`, path, ctx, sub);
    if (sub.length === 0) return;
    if (!best || isCloserMatch(sub, best)) best = sub;
  }
  if (best) out.push(...best);
}

/** Fewer problems wins; ties go to the branch that failed deepest (it matched more structure). */
function isCloserMatch(candidate: Diagnostic[], best: Diagnostic[]): boolean {
  if (candidate.length !== best.length) return candidate.length < best.length;
  return depthOf(candidate) > depthOf(best);
}

function depthOf(diagnostics: Diagnostic[]): number {
  return Math.max(...diagnostics.map((d) => (d.jsonPath ?? '').length));
}

/** The keys that identify a branch: `firstProperty` where the schema declares one, otherwise its
 *  `required` keys (how the pipeline-level stages/jobs/steps shapes are told apart). */
function discriminatorKeys(branch: JsonSchema): string[] {
  return stringsOf(branch['firstProperty']) ?? stringsOf(branch['required']) ?? [];
}

/** `value` — the branch's key is present and any *value* constraint on it matches (this is what
 *  picks `PowerShell@2` out of the 259 task branches); `key` — present but the value disagrees. */
function discriminatorMatch(
  node: MappingNode,
  branch: JsonSchema,
  names: string[],
  ctx: Ctx,
): 'value' | 'key' | 'none' {
  const properties = isRecord(branch['properties']) ? branch['properties'] : undefined;
  let keyMatch = false;
  for (const name of names) {
    const entry = findEntry(node, name, properties);
    if (!entry) continue;
    keyMatch = true;
    const propertySchema = properties?.[name];
    if (!isRecord(propertySchema) || !isValueDiscriminator(propertySchema)) return 'value';
    const probe: Diagnostic[] = [];
    validateNode(entry.value, propertySchema, '#', '$', ctx, probe);
    if (probe.length === 0) return 'value';
  }
  return keyMatch ? 'key' : 'none';
}

/** Only inline value constraints discriminate; a `$ref` to a shared type (e.g. `string`) does not,
 *  and validating it here would just duplicate the branch validation that follows. */
function isValueDiscriminator(propertySchema: JsonSchema): boolean {
  return (
    !('$ref' in propertySchema) &&
    (typeof propertySchema['pattern'] === 'string' || Array.isArray(propertySchema['enum']))
  );
}

function branchAcceptsKind(branch: JsonSchema, kind: Kind, node: PipelineNode): boolean {
  const expected = branch['type'];
  if (typeof expected !== 'string') return true;
  return kindMatches(kind, expected, node);
}

/** The message that replaces the alternatives explosion: which forms exist, and which one the
 *  author probably meant (docs/01 §1 — "readable messages … the allowed alternatives"). */
function noMatchingForm(
  node: MappingNode,
  alternatives: JsonSchema[],
  path: string,
  ctx: Ctx,
): Diagnostic {
  const named = [
    ...new Set(alternatives.flatMap((branch) => stringsOf(branch['firstProperty']) ?? [])),
  ];
  const forms = named.length > 0 ? named : [...new Set(alternatives.flatMap(discriminatorKeys))];
  const first = node.entries[0];
  const key = first ? keyText(first) : '';
  const suggestion = nearestName(key, forms);
  return diagnostic(ctx, first?.key ?? node, first ? `${path}${pathStep(key)}` : path, {
    severity: 'error',
    code: SCHEMA_NO_MATCHING_FORM,
    message:
      key === ''
        ? `this block must declare one of: ${list(forms, 16)}`
        : `unexpected property "${key}": this block must start with one of: ${list(forms, 16)}`,
    hint: suggestion,
  });
}

// ---------------------------------------------------------------------------
// schema helpers
// ---------------------------------------------------------------------------

/** Follows `$ref` chains. draft-07 ignores `$ref` siblings, so the target replaces the node. */
function deref(
  schema: JsonSchema,
  pointer: string,
  ctx: Ctx,
): { schema: JsonSchema; pointer: string } {
  let current = schema;
  let currentPointer = pointer;
  for (let depth = 0; depth < 20; depth++) {
    const ref = current['$ref'];
    if (typeof ref !== 'string') break;
    const target = resolvePointer(ctx.root, ref);
    if (!target) break;
    current = target;
    currentPointer = ref;
  }
  return { schema: current, pointer: currentPointer };
}

function resolvePointer(root: JsonSchema, ref: string): JsonSchema | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isRecord(node)) return undefined;
    node = node[segment];
  }
  return isRecord(node) ? node : undefined;
}

function isEnumOnly(branch: JsonSchema): boolean {
  return (
    Array.isArray(branch['enum']) &&
    !('properties' in branch) &&
    !('items' in branch) &&
    !('$ref' in branch)
  );
}

function enumValues(schema: JsonSchema): ScalarValue[] | undefined {
  const values = schema['enum'];
  if (!Array.isArray(values)) return undefined;
  return values.filter(
    (value): value is ScalarValue =>
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean',
  );
}

function matchesEnum(value: ScalarValue, values: ScalarValue[], ignoreCase: boolean): boolean {
  const text = scalarText(value);
  return values.some((candidate) => {
    const candidateText = scalarText(candidate);
    return ignoreCase ? candidateText.toUpperCase() === text.toUpperCase() : candidateText === text;
  });
}

/** `ignoreCase: "value" | "all"` → case-insensitive values (jsonParser.ts getIgnoreValueCase). */
function ignoresValueCase(schema: JsonSchema): boolean {
  const mode = schema['ignoreCase'];
  return mode === 'value' || mode === 'all';
}

/** `ignoreCase: "key" | "all"` → case-insensitive property names (getIgnoreKeyCase). */
function ignoresKeyCase(schema: JsonSchema): boolean {
  const mode = schema['ignoreCase'];
  return mode === 'key' || mode === 'all';
}

/** Property lookup honoring `ignoreCase` and `aliases` of the *property's own* schema. */
function findEntry(
  node: MappingNode,
  name: string,
  properties: Record<string, unknown> | undefined,
): MappingEntry | undefined {
  const propertySchema = properties?.[name];
  const schema = isRecord(propertySchema) ? propertySchema : undefined;
  const ignoreCase = schema ? ignoresKeyCase(schema) : false;
  const names = [name, ...(schema ? (stringsOf(schema['aliases']) ?? []) : [])];
  for (const entry of node.entries) {
    const key = keyText(entry);
    if (
      names.some((candidate) => (ignoreCase ? equalsIgnoreCase(candidate, key) : candidate === key))
    )
      return entry;
  }
  return undefined;
}

function sameKey(
  name: string,
  key: string,
  properties: Record<string, unknown> | undefined,
): boolean {
  const propertySchema = properties?.[name];
  const ignoreCase = isRecord(propertySchema) ? ignoresKeyCase(propertySchema) : false;
  if (name === key) return true;
  if (ignoreCase && equalsIgnoreCase(name, key)) return true;
  const aliases = isRecord(propertySchema) ? (stringsOf(propertySchema['aliases']) ?? []) : [];
  return aliases.some((alias) => (ignoreCase ? equalsIgnoreCase(alias, key) : alias === key));
}

// ---------------------------------------------------------------------------
// severity policy for the parts of the schema we know are incomplete
// ---------------------------------------------------------------------------

/** The task-name enum is a snapshot of in-box tasks; marketplace/custom tasks are simply not in
 *  it, so an unrecognized name is a warning plus a pointer at the org schema (C-E01-020). */
const TASK_NAME_POINTER = '#/definitions/task/properties/task';
const TASK_INPUTS_POINTER = /^#\/definitions\/task\/anyOf\/\d+\/properties\/inputs/;

function isTaskInputsPointer(pointer: string): boolean {
  return TASK_INPUTS_POINTER.test(pointer);
}

function valueNotAccepted(
  value: ScalarValue,
  values: ScalarValue[],
  pointer: string,
  path: string,
  node: PipelineNode,
  ctx: Ctx,
): Diagnostic {
  const text = scalarText(value);
  if (pointer === TASK_NAME_POINTER) {
    return diagnostic(ctx, node, path, {
      severity: 'warning',
      code: SCHEMA_UNKNOWN_TASK,
      message: `unknown task "${text}"`,
      // Against the org schema the catalogue *is* the organization's, so "not installed" is the
      // accurate reading — that is exactly what the service rejects unless a caller asks for
      // `validateTaskNames=false` (C-E01-033). Against the vendored snapshot it means far less.
      hint:
        ctx.schemaSource === 'org'
          ? 'not installed in this organization — check the task name, its version, or whether ' +
            'the extension providing it is installed'
          : 'not in the vendored in-box task catalog — expected for marketplace or custom tasks; ' +
            'their inputs are validated only against an org schema',
    });
  }
  const suggestion = nearestName(
    text,
    values.map((candidate) => scalarText(candidate)),
  );
  return diagnostic(ctx, node, path, {
    severity: 'error',
    code: SCHEMA_VALUE,
    message: `value ${JSON.stringify(text)} is not accepted; valid values: ${list(values.map((candidate) => scalarText(candidate)))}`,
    hint: suggestion,
  });
}

function inputHint(suggestion: string | undefined): string {
  const base =
    'input names come from the vendored task snapshot; a newer task version may add inputs';
  return suggestion ? `${suggestion} (${base})` : base;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function diagnostic(
  ctx: Ctx,
  node: { pos: PipelineNode['pos'] },
  path: string,
  fields: { severity: Severity; code: string; message: string; hint?: string | undefined },
): Diagnostic {
  return {
    severity: fields.severity,
    code: fields.code,
    message: fields.message,
    file: ctx.file,
    range: node.pos.range,
    jsonPath: path,
    ...(fields.hint === undefined ? {} : { hint: fields.hint }),
  };
}

function kindOf(node: PipelineNode): Kind {
  if (node.kind === 'mapping') return 'object';
  if (node.kind === 'sequence') return 'array';
  if (node.value === null) return 'null';
  return typeof node.value as 'string' | 'number' | 'boolean';
}

function describeKind(kind: Kind): string {
  if (kind === 'object') return 'a mapping';
  if (kind === 'array') return 'a sequence';
  if (kind === 'null') return 'an empty value';
  return `a ${kind}`;
}

function describeType(type: string): string {
  if (type === 'object') return 'a mapping';
  if (type === 'array') return 'a sequence';
  if (type === 'integer') return 'an integer';
  return `a ${type}`;
}

function scalarText(value: ScalarValue): string {
  return value === null ? '' : String(value);
}

function keyText(entry: MappingEntry): string {
  return scalarText(entry.key.value);
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

function pathStep(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function list(values: readonly string[], max = 8): string {
  const shown = values.slice(0, max).join(', ');
  return values.length > max ? `${shown}, … (+${values.length - max} more)` : shown;
}

/** "did you mean" for a mistyped key/value: closest candidate within a small edit distance. */
function nearestName(actual: string, candidates: readonly string[]): string | undefined {
  if (actual === '') return undefined;
  const limit = actual.length <= 4 ? 1 : actual.length <= 8 ? 2 : 3;
  let best: { name: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(actual.toLowerCase(), candidate.toLowerCase());
    if (distance <= limit && (!best || distance < best.distance))
      best = { name: candidate, distance };
  }
  return best ? `did you mean "${best.name}"?` : undefined;
}

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions, so the common
 *  "bahs"/"bash" style of typo counts as one edit. */
function editDistance(a: string, b: string): number {
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, index) => index)];
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const previous = rows[i - 1]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      }
      current[j] = value;
    }
    rows.push(current);
  }
  return rows[a.length]![b.length]!;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayOf(value: unknown): unknown[] | undefined {
  return Array.isArray(value) && value.length > 0 ? value : undefined;
}

function stringsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}
