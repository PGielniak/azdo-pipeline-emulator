/**
 * **Typed parameter binding**: turning a `parameters:` declaration list and a caller's argument
 * mapping into the `parameters` context a template's expressions read.
 *
 * Grounded in 88 live preview probes (`pnpm parameter-binding-survey`,
 * `research/experiments/E03-parameters/`, claims `C-E03-300..333`). The three documented sources
 * disagreed with each other before the service was asked — two process pages list 13 type names,
 * the yaml-schema page 12, the vendored service schema 16 in one position and 20 in the other —
 * and the measured vocabularies are the **vendored schema's two lists, exactly** (C-E03-304/305).
 * Four documented statements are false as written and are not implemented: `stringList` *is*
 * available in templates (C-E03-306), `type:` is *not* required (C-E03-308), `values:` does *not*
 * supply a missing default (C-E03-309), and Boolean→String binding produces `true`, not the
 * expression language's `True` (C-E03-321).
 *
 * Four measured rules shape the code more than the rest:
 *
 *  - **A scalar binds as its source text, and the per-type parse runs on that string**
 *    (C-E03-321/332). There is no Number→String or Boolean→String conversion here: `True` binds to
 *    a `string` parameter as `"True"`, `007` as `"007"`, `1.0` as `"1.0"`. Our YAML front end types
 *    those as `true`, `7` and `1`, so a binder reading `ScalarNode.value` cannot produce any of the
 *    three — which is why every entry point here takes the document `source` and reads back through
 *    `pos.offset`. The null probes are what proved the rule is one step and not a special case per
 *    type: `p:` bound to `number` is rejected quoting the *empty string*, so Null became `''` first
 *    and then failed `number`, exactly as an explicit `''` does.
 *  - **The type vocabulary depends on the position** (C-E03-305). `legacyObject` is a template-only
 *    type; `environment`, `filePath`, `pool`, `secureFile` and `serviceConnection` are root-only.
 *    A single `PARAMETER_TYPES` set would accept five names the service refuses in templates and
 *    refuse one it accepts.
 *  - **`legacyObject` is `object` with every scalar leaf stringified** (C-E03-325) — undocumented
 *    anywhere, and the only place in the system where the reader's types are deliberately discarded.
 *  - **A `default:` is not an expression slot** (C-E03-315). It admits exactly one expression form,
 *    a lone single-quoted string literal; `${{ 42 }}`, `${{ true }}`, `${{ format(…) }}` and mixed
 *    content are all rejected with one sentence. That is the template-parameters page's "You can
 *    only use literals for parameter default values", enforced far more narrowly than it reads.
 *
 * Two things this module deliberately does **not** do. It does not schema-validate the structural
 * types (`step`, `jobList`, …) beyond mapping-vs-sequence: the service does validate them at
 * binding time (C-E03-327), but the schema is E01-S02's and wiring it here would fork it. And it
 * does not canonicalize a bound `stepList` — the service has already run the shortcut→task
 * normalization by the time a template reads the parameter (C-E03-328), and that table belongs to
 * E04-S01-T01; implementing it here would put one normalization in two places.
 */
import type { Diagnostic } from '../frontend/diagnostics.js';
import type { MappingNode, PipelineNode, ScalarNode, SourceRange } from '../frontend/parse.js';
import { parametersContext } from '../expr/context.js';
import { parseExpression } from '../expr/parser.js';
import {
  NULL,
  arrayValue,
  booleanValue,
  numberValue,
  orderedObjectValue,
  stringValue,
  type ExprObject,
  type ExprValue,
} from '../expr/value.js';
import { loneExpression } from './walk.js';

/**
 * The 16 type names accepted inside a template — `definitions.templateParameterType` in the
 * vendored schema, confirmed name by name against the service (C-E03-302/305).
 */
export const TEMPLATE_PARAMETER_TYPES = [
  'boolean',
  'container',
  'containerList',
  'deployment',
  'deploymentList',
  'job',
  'jobList',
  'legacyObject',
  'number',
  'object',
  'stage',
  'stageList',
  'step',
  'stepList',
  'string',
  'stringList',
] as const;

/**
 * The 20 type names accepted at the pipeline root — `definitions.pipelineTemplateParameterType`.
 * It is not a superset: `legacyObject` is template-only (C-E03-305).
 */
export const ROOT_PARAMETER_TYPES = [
  'boolean',
  'container',
  'containerList',
  'deployment',
  'deploymentList',
  'environment',
  'filePath',
  'job',
  'jobList',
  'number',
  'object',
  'pool',
  'secureFile',
  'serviceConnection',
  'stage',
  'stageList',
  'step',
  'stepList',
  'string',
  'stringList',
] as const;

export type ParameterType =
  (typeof TEMPLATE_PARAMETER_TYPES)[number] | (typeof ROOT_PARAMETER_TYPES)[number];

/** Which vocabulary applies. The service's two positions are genuinely different (C-E03-305). */
export type ParameterPosition = 'root' | 'template';

export function parameterTypesFor(position: ParameterPosition): readonly ParameterType[] {
  return position === 'root' ? ROOT_PARAMETER_TYPES : TEMPLATE_PARAMETER_TYPES;
}

/**
 * `type:` is optional and defaults to `string` — measured, and the opposite of what both the
 * process pages ("Parameters must contain a name and data type") and the yaml-schema page ("The
 * `type` and `name` fields are required") say (C-E03-308).
 */
export const DEFAULT_PARAMETER_TYPE: ParameterType = 'string';

/** The name the service prints in `… is not a valid <Type>.` — capitalized, list types camel. */
const TYPE_LABEL: Readonly<Record<string, string>> = {
  boolean: 'Boolean',
  container: 'Container',
  containerList: 'ContainerList',
  deployment: 'Deployment',
  deploymentList: 'DeploymentList',
  environment: 'Environment',
  filePath: 'FilePath',
  job: 'Job',
  jobList: 'JobList',
  legacyObject: 'LegacyObject',
  number: 'Number',
  object: 'Object',
  pool: 'Pool',
  secureFile: 'SecureFile',
  serviceConnection: 'ServiceConnection',
  stage: 'Stage',
  stageList: 'StageList',
  step: 'Step',
  stepList: 'StepList',
  string: 'String',
  stringList: 'StringList',
};

export const PARAMETER_UNKNOWN_TYPE = 'template-parameter-unknown-type';
export const PARAMETER_DUPLICATE = 'template-parameter-duplicate';
export const PARAMETER_REQUIRED = 'template-parameter-required';
export const PARAMETER_INVALID_VALUE = 'template-parameter-invalid-value';
export const PARAMETER_NOT_IN_VALUES = 'template-parameter-not-in-values';
export const PARAMETER_UNEXPECTED = 'template-parameter-unexpected';
export const PARAMETER_EXPRESSION = 'template-parameter-expression-not-allowed';

/** `Unexpected value 'notAType'` — the schema's sentence, at the `type:` node (C-E03-307). */
export const unknownTypeMessage = (spelling: string): string => `Unexpected value '${spelling}'`;

/** `The 'p' parameter value 'abc' is not a valid Number.` (C-E03-312/322/323/326) */
export const invalidValueMessage = (name: string, text: string, type: ParameterType): string =>
  `The '${name}' parameter value '${text}' is not a valid ${TYPE_LABEL[type] ?? type}.`;

/**
 * `The 'p' parameter is not a valid String.` — the *value-less* form. A non-scalar bound to a
 * scalar type and a malformed structural value both use it, because there is no single token to
 * quote (C-E03-321/327).
 */
export const invalidShapeMessage = (name: string, type: ParameterType): string =>
  `The '${name}' parameter is not a valid ${TYPE_LABEL[type] ?? type}.`;

/** `The 'p' parameter value 'gamma' is not a valid value.` (C-E03-311/314) */
export const notInValuesMessage = (name: string, text: string): string =>
  `The '${name}' parameter value '${text}' is not a valid value.`;

/** `A value for the 'p' parameter must be provided.` (C-E03-309) */
export const requiredMessage = (name: string): string =>
  `A value for the '${name}' parameter must be provided.`;

/** `Unexpected parameter 'extra'` (C-E03-318/330) */
export const unexpectedParameterMessage = (name: string): string =>
  `Unexpected parameter '${name}'`;

/** `The 'p' parameter is declared more than once in the parameter list.` (C-E03-313) */
export const duplicateMessage = (name: string): string =>
  `The '${name}' parameter is declared more than once in the parameter list.`;

/** `A template expression is not allowed in this context` (C-E03-315) */
export const EXPRESSION_NOT_ALLOWED = 'A template expression is not allowed in this context';

export interface ParameterDeclaration {
  readonly name: string;
  readonly type: ParameterType;
  readonly displayName: string | undefined;
  /** Absent when the declaration has no `default:` at all — the parameter is then required. */
  readonly defaultValue: ExprValue | undefined;
  /** `values:` as bound *source text*, which is what the membership test compares (C-E03-314). */
  readonly values: readonly string[] | undefined;
  readonly range: SourceRange;
}

/** Everything a diagnostic needs to point at a node in a specific file. */
export interface ParameterSource {
  readonly file: string;
  /** Raw text of `file`. Scalars bind as source text, so this is not optional (C-E03-321). */
  readonly source: string;
}

export interface DeclarationResult {
  readonly declarations: readonly ParameterDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface ParameterArguments {
  /**
   * The caller's `parameters:` mapping, with its `${{ }}` already expanded **in the caller's
   * frame** — argument values are ordinary expression slots and the callee's own parameters are
   * not in scope while they are evaluated (C-E03-320). `undefined` means the caller wrote no
   * `parameters:` block at all.
   */
  readonly node?: MappingNode | undefined;
  /** The caller's file, for attributing argument-site diagnostics. */
  readonly from?: ParameterSource | undefined;
  /**
   * Queue-time values — the preview body's `templateParameters`, i.e. what `--param`/config
   * supplies locally. String-valued by REST contract and run through the same per-type conversion,
   * with the one addition that a JSON string binds to an `object` parameter as parsed JSON
   * (C-E03-329). Root position only; a template is never queued.
   */
  readonly queue?: Readonly<Record<string, string>> | undefined;
}

export interface ParameterBinding {
  /** Bound values by declared name, in declaration order. */
  readonly values: Readonly<Record<string, ExprValue>>;
  /** The `parameters` context object: case-folding, and raising on a miss (C-E02-087/C-E03-317). */
  readonly context: ExprObject;
  readonly declarations: readonly ParameterDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
}

const diagnostic = (
  code: string,
  message: string,
  file: string,
  range: SourceRange,
): Diagnostic => ({ severity: 'error', code, message, file, range });

/**
 * A scalar's **source text** — the string every scalar binding starts from (C-E03-321/332).
 *
 * Quoted scalars are their own value already; only a *plain* scalar can have been retyped by the
 * YAML reader, and only there does slicing the source matter. Null is the empty string, which is
 * why `p:` bound to `number` is rejected quoting `''` rather than `null` (C-E03-332).
 */
export function scalarText(node: ScalarNode, source: string): string {
  if (typeof node.value === 'string') return node.value;
  if (node.value === null) return '';
  if (node.style === 'plain') {
    const [start, end] = node.pos.offset;
    const raw = source.slice(start, end);
    if (raw.length > 0) return raw;
  }
  return String(node.value);
}

/** Recursively convert a node to an expression value, preserving the reader's leaf types. */
function structuralValue(node: PipelineNode, source: string, stringifyLeaves: boolean): ExprValue {
  switch (node.kind) {
    case 'scalar': {
      // A null leaf is the empty string in both object flavours (C-E03-324/325).
      if (stringifyLeaves || node.value === null) return stringValue(scalarText(node, source));
      if (typeof node.value === 'boolean') return booleanValue(node.value);
      if (typeof node.value === 'number') return numberValue(node.value);
      return stringValue(node.value);
    }
    case 'sequence':
      return arrayValue(node.items.map((item) => structuralValue(item, source, stringifyLeaves)));
    case 'mapping':
      // Nested objects keep the ordinary policies — ordinal keys, null on a miss. Only the
      // top-level `parameters` context folds case and raises (C-E02-087).
      return orderedObjectValue(
        node.entries.map(
          (entry) =>
            [
              scalarText(entry.key, source),
              structuralValue(entry.value, source, stringifyLeaves),
            ] as const,
        ),
      );
  }
}

type Coercion =
  | { readonly ok: true; readonly value: ExprValue }
  | { readonly ok: false; readonly message: string };

/** Types whose value is a structure the binder passes through (C-E03-324/325/327). */
const STRUCTURAL: Readonly<Record<string, 'mapping' | 'sequence' | 'any'>> = {
  object: 'any',
  legacyObject: 'any',
  container: 'mapping',
  containerList: 'sequence',
  step: 'mapping',
  stepList: 'sequence',
  job: 'mapping',
  jobList: 'sequence',
  deployment: 'mapping',
  deploymentList: 'sequence',
  stage: 'mapping',
  stageList: 'sequence',
  pool: 'any',
  environment: 'any',
  filePath: 'any',
  secureFile: 'any',
  serviceConnection: 'any',
};

/**
 * Bind one value to one declared type.
 *
 * The scalar half is one rule applied per type: take the source text (C-E03-332), then parse. The
 * structural half is a shape check only — see the module header for why the schema is not run here.
 */
export function coerceParameterValue(
  name: string,
  type: ParameterType,
  node: PipelineNode,
  source: string,
): Coercion {
  const structural = STRUCTURAL[type];
  if (structural !== undefined) {
    if (type === 'object' || type === 'legacyObject') {
      return { ok: true, value: structuralValue(node, source, type === 'legacyObject') };
    }
    if (structural === 'mapping' && node.kind !== 'mapping') {
      return { ok: false, message: invalidShapeMessage(name, type) };
    }
    if (structural === 'sequence' && node.kind !== 'sequence') {
      // `pass-steplist-scalar`: the sentence names the type and quotes nothing (C-E03-327).
      return { ok: false, message: invalidShapeMessage(name, type) };
    }
    return { ok: true, value: structuralValue(node, source, false) };
  }

  if (type === 'stringList') {
    if (node.kind !== 'sequence') {
      // Measured with the value quoted, unlike the other list types (C-E03-326).
      const text = node.kind === 'scalar' ? scalarText(node, source) : '';
      return { ok: false, message: invalidValueMessage(name, text, type) };
    }
    const items: ExprValue[] = [];
    for (const item of node.items) {
      if (item.kind !== 'scalar') return { ok: false, message: invalidShapeMessage(name, type) };
      items.push(stringValue(scalarText(item, source)));
    }
    return { ok: true, value: arrayValue(items) };
  }

  // Scalar types. A collection has no token to quote, so it takes the value-less sentence.
  if (node.kind !== 'scalar') return { ok: false, message: invalidShapeMessage(name, type) };
  const text = scalarText(node, source);
  return coerceScalarText(name, type, text);
}

/**
 * The scalar conversions, over the *text* a scalar or a queue-time value contributes. Shared by
 * both entry points because the service shares them: `"8"` from the queue and `'8'` from YAML both
 * bind the Number 8 (C-E03-329).
 */
export function coerceScalarText(name: string, type: ParameterType, text: string): Coercion {
  switch (type) {
    case 'string':
      return { ok: true, value: stringValue(text) };
    case 'number': {
      // `''` and `abc` are both rejected; `1.0` binds as 1 and `0.5` as 0.5 (C-E03-322).
      if (text.trim().length === 0)
        return { ok: false, message: invalidValueMessage(name, text, type) };
      const parsed = Number(text);
      if (!Number.isFinite(parsed))
        return { ok: false, message: invalidValueMessage(name, text, type) };
      return { ok: true, value: numberValue(parsed) };
    }
    case 'boolean': {
      // Exactly the two literals, case-insensitively: `yes` and `1` are rejected (C-E03-323).
      const folded = text.toLowerCase();
      if (folded === 'true') return { ok: true, value: booleanValue(true) };
      if (folded === 'false') return { ok: true, value: booleanValue(false) };
      return { ok: false, message: invalidValueMessage(name, text, type) };
    }
    default:
      return { ok: true, value: stringValue(text) };
  }
}

const entryOf = (mapping: MappingNode, key: string): PipelineNode | undefined =>
  mapping.entries.find((entry) => String(entry.key.value) === key)?.value;

/**
 * Is this scalar a `default:` the service will accept?
 *
 * The slot admits a literal *or* a lone single-quoted string-literal expression, and nothing else —
 * not other literal kinds, not function calls, not named values, not mixed content (C-E03-315).
 * Returns the folded text of an accepted expression, or a diagnostic message.
 */
function foldDefaultExpression(
  text: string,
): { readonly text: string } | { readonly error: string } {
  const lone = loneExpression(text);
  if (lone === undefined) {
    // Mixed content compiles to a `format()` call (C-E02-109), which is not a literal.
    return text.includes('${{') ? { error: EXPRESSION_NOT_ALLOWED } : { text };
  }
  const parsed = parseExpression(lone.inner);
  if (!parsed.ok) return { error: EXPRESSION_NOT_ALLOWED };
  const node = parsed.node;
  if (node.type !== 'literal' || node.literal.kind !== 'string') {
    return { error: EXPRESSION_NOT_ALLOWED };
  }
  return { text: node.literal.value };
}

/**
 * Read a `parameters:` sequence into declarations, reporting the declaration-site rejections.
 *
 * A missing `name:` is **not** checked here: the schema's `firstProperty` rule rejects that
 * document before the binder ever runs (C-E03-333).
 */
export function readParameterDeclarations(
  node: PipelineNode | undefined,
  where: ParameterSource,
  position: ParameterPosition,
): DeclarationResult {
  const declarations: ParameterDeclaration[] = [];
  const diagnostics: Diagnostic[] = [];
  if (node === undefined || node.kind !== 'sequence') return { declarations, diagnostics };

  const allowed = new Set<string>(parameterTypesFor(position));
  const seen = new Set<string>();

  for (const item of node.items) {
    if (item.kind !== 'mapping') continue;
    const nameNode = entryOf(item, 'name');
    if (nameNode === undefined || nameNode.kind !== 'scalar') continue;
    const name = scalarText(nameNode, where.source);

    const typeNode = entryOf(item, 'type');
    let type = DEFAULT_PARAMETER_TYPE;
    if (typeNode !== undefined) {
      const spelling = typeNode.kind === 'scalar' ? scalarText(typeNode, where.source) : '';
      // Case-sensitive: `String` is as unknown as `notAType` (C-E03-307).
      if (!allowed.has(spelling)) {
        diagnostics.push(
          diagnostic(
            PARAMETER_UNKNOWN_TYPE,
            unknownTypeMessage(spelling),
            where.file,
            typeNode.pos.range,
          ),
        );
        continue;
      }
      type = spelling as ParameterType;
    }

    // Case-folding, like every other parameter-name comparison (C-E03-316).
    const folded = name.toLowerCase();
    if (seen.has(folded)) {
      diagnostics.push(
        diagnostic(PARAMETER_DUPLICATE, duplicateMessage(name), where.file, item.pos.range),
      );
      continue;
    }
    seen.add(folded);

    const displayNameNode = entryOf(item, 'displayName');
    const valuesNode = entryOf(item, 'values');
    const values =
      valuesNode?.kind === 'sequence'
        ? valuesNode.items.map((entry) =>
            entry.kind === 'scalar' ? scalarText(entry, where.source) : '',
          )
        : undefined;

    const defaultNode = entryOf(item, 'default');
    let defaultValue: ExprValue | undefined;
    if (defaultNode !== undefined) {
      let bound: PipelineNode = defaultNode;
      if (defaultNode.kind === 'scalar' && typeof defaultNode.value === 'string') {
        const folded = foldDefaultExpression(defaultNode.value);
        if ('error' in folded) {
          diagnostics.push(
            diagnostic(PARAMETER_EXPRESSION, folded.error, where.file, defaultNode.pos.range),
          );
          continue;
        }
        bound = { ...defaultNode, value: folded.text, style: 'single' };
      }
      const coerced = coerceParameterValue(name, type, bound, where.source);
      if (!coerced.ok) {
        diagnostics.push(
          diagnostic(PARAMETER_INVALID_VALUE, coerced.message, where.file, defaultNode.pos.range),
        );
        continue;
      }
      const membership = checkValues(name, values, coerced.value);
      if (membership !== undefined) {
        diagnostics.push(
          diagnostic(PARAMETER_NOT_IN_VALUES, membership, where.file, defaultNode.pos.range),
        );
        continue;
      }
      defaultValue = coerced.value;
    }

    declarations.push({
      name,
      type,
      displayName:
        displayNameNode?.kind === 'scalar' ? scalarText(displayNameNode, where.source) : undefined,
      defaultValue,
      values,
      range: item.pos.range,
    });
  }

  return { declarations, diagnostics };
}

/**
 * The `values:` membership test: case-**sensitive**, and run *after* coercion, so a `number`
 * restricted to `[1, 2]` accepts the string `'2'` (C-E03-314). A `values:` list on a type that
 * cannot carry one is silently ignored, which is also measured, not charitable.
 */
function checkValues(
  name: string,
  values: readonly string[] | undefined,
  value: ExprValue,
): string | undefined {
  if (values === undefined || values.length === 0) return undefined;
  if (value.kind === 'array') {
    // stringList checks each item at the item's own position (C-E03-326).
    for (const item of value.value) {
      if (item.kind !== 'string') continue;
      if (!values.includes(item.value)) return notInValuesMessage(name, item.value);
    }
    return undefined;
  }
  const text = valueText(value);
  if (text === undefined) return undefined; // object/array targets: no membership test
  return values.includes(text) ? undefined : notInValuesMessage(name, text);
}

/** The text a bound scalar contributes to a membership test or an error sentence. */
function valueText(value: ExprValue): string | undefined {
  switch (value.kind) {
    case 'string':
      return value.value;
    case 'number':
      return String(value.value);
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'null':
      return '';
    default:
      return undefined;
  }
}

/**
 * Bind a declaring file's `parameters:` against a caller's argument mapping and any queue-time
 * values, producing the `parameters` context for that file.
 *
 * Order matters and is measured: unexpected arguments are reported (C-E03-318), then each
 * declaration takes its argument, else its queue-time value, else its default, else the
 * requiredness rejection (C-E03-309). Every rejection is *accumulated*, never thrown — the service
 * reports every one in a single response (C-E02-110), and `default-missing-typed` shows four
 * requiredness sentences at once.
 */
export function bindParameters(
  declarationsNode: PipelineNode | undefined,
  where: ParameterSource,
  args: ParameterArguments = {},
  position: ParameterPosition = 'template',
): ParameterBinding {
  const read = readParameterDeclarations(declarationsNode, where, position);
  const diagnostics: Diagnostic[] = [...read.diagnostics];
  const declared = new Map<string, ParameterDeclaration>();
  for (const declaration of read.declarations)
    declared.set(declaration.name.toLowerCase(), declaration);

  // An *absent* `parameters:` block accepts any argument; an empty-but-present one does not
  // (C-E03-318) — the asymmetry is measured, not a courtesy.
  const declaresBlock = declarationsNode !== undefined;
  const supplied = new Map<string, { node: PipelineNode; range: SourceRange }>();
  if (args.node !== undefined) {
    for (const entry of args.node.entries) {
      const key = String(entry.key.value);
      const folded = key.toLowerCase();
      if (declaresBlock && !declared.has(folded)) {
        diagnostics.push(
          diagnostic(
            PARAMETER_UNEXPECTED,
            unexpectedParameterMessage(key),
            args.from?.file ?? where.file,
            entry.key.pos.range,
          ),
        );
        continue;
      }
      supplied.set(folded, { node: entry.value, range: entry.value.pos.range });
    }
  }

  const queue = new Map<string, string>();
  for (const [key, value] of Object.entries(args.queue ?? {})) {
    const folded = key.toLowerCase();
    if (!declared.has(folded)) {
      // No file position: a queue-time value has no source location (C-E03-330).
      diagnostics.push(
        diagnostic(
          PARAMETER_UNEXPECTED,
          unexpectedParameterMessage(key),
          where.file,
          declarationRange(read.declarations, where),
        ),
      );
      continue;
    }
    queue.set(folded, value);
  }

  const values: Record<string, ExprValue> = {};
  for (const declaration of read.declarations) {
    const folded = declaration.name.toLowerCase();
    const argument = supplied.get(folded);
    const queued = queue.get(folded);

    let bound: ExprValue | undefined;
    if (argument !== undefined) {
      const source = args.from?.source ?? where.source;
      const coerced = coerceParameterValue(
        declaration.name,
        declaration.type,
        argument.node,
        source,
      );
      if (!coerced.ok) {
        diagnostics.push(
          diagnostic(
            PARAMETER_INVALID_VALUE,
            coerced.message,
            args.from?.file ?? where.file,
            argument.range,
          ),
        );
        continue;
      }
      bound = coerced.value;
    } else if (queued !== undefined) {
      const coerced = coerceQueueValue(declaration, queued);
      if (!coerced.ok) {
        diagnostics.push(
          diagnostic(PARAMETER_INVALID_VALUE, coerced.message, where.file, declaration.range),
        );
        continue;
      }
      bound = coerced.value;
    } else if (declaration.defaultValue !== undefined) {
      bound = declaration.defaultValue;
    } else {
      // `values:` does **not** stand in for a default (C-E03-309) — the documented "first
      // available value is used" is false, and this branch is where that would have gone.
      diagnostics.push(
        diagnostic(
          PARAMETER_REQUIRED,
          requiredMessage(declaration.name),
          where.file,
          declaration.range,
        ),
      );
      continue;
    }

    const membership = checkValues(declaration.name, declaration.values, bound);
    if (membership !== undefined) {
      diagnostics.push(
        diagnostic(
          PARAMETER_NOT_IN_VALUES,
          membership,
          argument !== undefined ? (args.from?.file ?? where.file) : where.file,
          argument?.range ?? declaration.range,
        ),
      );
      continue;
    }
    values[declaration.name] = bound;
  }

  return {
    values,
    context: parametersContext(values),
    declarations: read.declarations,
    diagnostics,
  };
}

/**
 * A queue-time value is a string, converted per the declared type exactly as a YAML value is —
 * with one addition that has no YAML-side counterpart: a JSON string bound to an `object`
 * parameter is **parsed** (C-E03-329).
 */
function coerceQueueValue(declaration: ParameterDeclaration, text: string): Coercion {
  if (declaration.type === 'object' || declaration.type === 'legacyObject') {
    try {
      return {
        ok: true,
        value: jsonValue(JSON.parse(text), declaration.type === 'legacyObject'),
      };
    } catch {
      return { ok: true, value: stringValue(text) };
    }
  }
  return coerceScalarText(declaration.name, declaration.type, text);
}

/** JSON → expression value, with `legacyObject`'s leaf stringification (C-E03-325/329). */
function jsonValue(json: unknown, stringifyLeaves: boolean): ExprValue {
  if (json === null) return stringifyLeaves ? stringValue('') : NULL;
  if (Array.isArray(json)) return arrayValue(json.map((item) => jsonValue(item, stringifyLeaves)));
  if (typeof json === 'object') {
    return orderedObjectValue(
      Object.entries(json as Record<string, unknown>).map(
        ([key, value]) => [key, jsonValue(value, stringifyLeaves)] as const,
      ),
    );
  }
  if (stringifyLeaves) return stringValue(String(json));
  if (typeof json === 'boolean') return booleanValue(json);
  if (typeof json === 'number') return numberValue(json);
  return stringValue(String(json));
}

/** Where to attribute an error that the service reports without a position (C-E03-309/330). */
function declarationRange(
  declarations: readonly ParameterDeclaration[],
  where: ParameterSource,
): SourceRange {
  const first = declarations[0];
  if (first !== undefined) return first.range;
  void where;
  return { line: 1, col: 1, endLine: 1, endCol: 1 };
}
