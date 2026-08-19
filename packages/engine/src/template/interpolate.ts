/**
 * Scalar interpolation, E03-S01-T05 — the last of the five template passes.
 *
 * Recognition and traversal stay in `walk.ts`; this module plugs into its `scalar` seam, as
 * `conditionals.ts`, `each.ts` and `insert.ts` plug into the directive seam. It owns one decision,
 * made per scalar: is this text **exactly one expression**, or is it text with holes in it?
 *
 *  - **Exactly one** → the expression's result replaces the scalar. An Object or Array is inserted
 *    **structurally**, keeping its shape at every depth (C-E03-177/178/179); every other kind
 *    becomes its String form (C-E03-183).
 *  - **Anything else** → each hole is stringified and concatenated with the literal text around it
 *    (C-E03-186). That is not a second stringification rule: the service compiles the whole scalar
 *    into a synthetic `format('<literal with {0} holes>', …)` and parses *that* (C-E02-109), so the
 *    conversion used here is the same `convertValue(v, 'string')` that `format` uses.
 *
 * Grounding: the expressions doc's conversion table (C-E03-175 — which gives `Null → ''` and
 * `True`/`False` outright, and gets Number wrong), the template-expressions doc's one structural
 * sentence (C-E03-176), and 34 live preview probes under `research/experiments/E03-interpolation/`
 * (C-E03-177..194). Four findings shape the code more than the rest:
 *
 *  - **The lone/mixed boundary is not whitespace-tolerant** (C-E03-180). `'  ${{ obj }}  '` is
 *    mixed content and the service rejects it; the unpadded double-quoted spelling inserts
 *    structurally. `loneExpression` was trimming and had to stop.
 *  - **Null renders `''` even in lone position** (C-E03-183). That is what proves a lone expression
 *    does not simply hand its typed result to the emitter — every scalar kind is converted, and
 *    only collections stay structural.
 *  - **Keys run through the same split, with their own structural rejection** (C-E03-191). A lone
 *    Object key is `Expected a scalar value`; the *same* object in mixed key content gives the
 *    conversion sentence instead. One rule could not produce two sentences.
 *  - **A lone directive keyword in value position is never evaluated** (C-E03-194/173). Evaluating
 *    `${{ insert }}` there would emit `Unrecognized value: 'insert'` — the one sentence T04's probe
 *    proves the service does not emit.
 */
import { convertValue, ExprConversionError } from '../expr/coercion.js';
import { objectEntries, type ExprValue } from '../expr/value.js';
import type { Diagnostic } from '../frontend/diagnostics.js';
import type { MappingEntry, PipelineNode, Provenance, ScalarNode } from '../frontend/parse.js';
import {
  loneExpression,
  parseDirectiveKey,
  type TemplateFrame,
  type TemplateScalarContext,
  type TemplateVisitor,
} from './walk.js';

export type InterpolationEvaluator = (expression: string, frame: TemplateFrame) => ExprValue;

export const INTERPOLATION_CONVERSION = 'template-interpolation-conversion';
export const INTERPOLATION_NON_SCALAR_KEY = 'template-interpolation-non-scalar-key';

/**
 * The service's sentence for a collection reaching a string position, byte for byte — including the
 * ` Value: <Kind>` suffix, which names the *kind* a second time rather than rendering the value
 * (C-E03-187). E02's `ExprConversionError` composes the same leading sentence without that suffix,
 * so it is appended here rather than reusing the message: E02's is an expression-level error, this
 * one is what the templating layer reports around it.
 */
export const conversionMessage = (kind: 'Object' | 'Array'): string =>
  `Unable to convert from ${kind} to String. Value: ${kind}`;

/** The sentence for a *lone* collection in key position — one sentence, no help link. */
export const NON_SCALAR_KEY_MESSAGE = 'Expected a scalar value';

/**
 * Create the interpolation half of a template visitor. Compose it with the directive visitors
 * through `composeVisitors`; it defines only the `scalar` hook, so order against them is free.
 */
export function interpolationVisitor(evaluate: InterpolationEvaluator): TemplateVisitor {
  return {
    scalar: (node, frame, context) => {
      const text = node.value;
      if (typeof text !== 'string') return undefined;
      // Cheap reject first: most scalars in a real pipeline carry no expression at all, and the
      // ones that do must not be reformatted just because the walk visited them.
      if (!text.includes('${{')) return undefined;
      return context.position === 'key'
        ? interpolateKey(text, node, frame, context, evaluate)
        : interpolateValue(text, node, frame, context, evaluate);
    },
  };
}

function interpolateValue(
  text: string,
  node: ScalarNode,
  frame: TemplateFrame,
  context: TemplateScalarContext,
  evaluate: InterpolationEvaluator,
): PipelineNode | undefined {
  const lone = loneExpression(text);
  if (lone === undefined) {
    return { ...node, value: mixed(text, node, frame, context, evaluate) };
  }
  // C-E03-194/173: the keyword is recognized here but has nothing to act on, and its delimited text
  // survives verbatim into schema validation. Returning `undefined` leaves the node exactly as
  // parsed, which is what "never evaluate a lone `${{ insert }}`" means in code.
  if (parseDirectiveKey(text).kind !== 'not-a-directive') return undefined;
  return structural(evaluate(lone.inner, frame), node.pos);
}

function interpolateKey(
  text: string,
  node: ScalarNode,
  frame: TemplateFrame,
  context: TemplateScalarContext,
  evaluate: InterpolationEvaluator,
): PipelineNode | undefined {
  const lone = loneExpression(text);
  if (lone === undefined) {
    return { ...node, value: mixed(text, node, frame, context, evaluate) };
  }
  const value = evaluate(lone.inner, frame);
  if (value.kind === 'object' || value.kind === 'array') {
    // Reported, not thrown, and the raw key is kept: the document is rejected either way, and
    // substituting something here would invent a key the user never wrote and could collide with a
    // real one under the mapping's duplicate rule (C-E03-169).
    context.report(diagnostic(INTERPOLATION_NON_SCALAR_KEY, NON_SCALAR_KEY_MESSAGE, node, frame));
    return undefined;
  }
  // Always the String form — `True`, `1`, `0.5`, `''` (C-E03-190). A key has no structural option,
  // so unlike a value it is never re-typed.
  return { ...node, value: stringForm(value) };
}

/**
 * The String form of a scalar result. Deliberately `convertValue(v, 'string')` rather than a local
 * renderer: the doc's conversion table and `format`'s stringification are the same operation
 * (C-E02-109), and every measured rendering — `True`/`False`, `''` for Null, `0.5`/`1`/`1000000`/
 * `-1.25` for Number, dotted for Version — is what it already produces (C-E03-181/182/183/184).
 */
function stringForm(value: ExprValue): string {
  const converted = convertValue(value, 'string');
  if (converted.kind !== 'string') throw new ExprConversionError(value.kind, 'string', value);
  return converted.value;
}

/**
 * One expression's contribution to mixed content, or `undefined` if it cannot have one.
 *
 * A collection here is the measured rejection (C-E03-187); the hole then becomes the **empty
 * string** and interpolation continues, which is why the padded-object probe came back carrying
 * this sentence *and* the schema's follow-on `Unexpected value ''` in one response.
 */
function hole(
  value: ExprValue,
  node: ScalarNode,
  frame: TemplateFrame,
  context: TemplateScalarContext,
): string {
  if (value.kind === 'object' || value.kind === 'array') {
    const kind = value.kind === 'object' ? 'Object' : 'Array';
    context.report(diagnostic(INTERPOLATION_CONVERSION, conversionMessage(kind), node, frame));
    return '';
  }
  return stringForm(value);
}

/**
 * Stringify-and-concatenate over a scalar with holes in it.
 *
 * The scan is the same quote-aware one `loneExpression` uses, for the same reason: the documented
 * escape for a literal `${{` puts it inside an expression string (C-E03-117/188), and a `}}` inside
 * quotes does not close anything. Literal text between and around the holes is copied verbatim —
 * `${{ 'a' }}${{ 'b' }}` is `ab` with an empty literal between two holes, not a lone expression
 * (C-E03-186) — and an unterminated `${{` is left as the literal text it is, because the walk has
 * no sentence of its own for it and the expression layer never sees it.
 */
function mixed(
  text: string,
  node: ScalarNode,
  frame: TemplateFrame,
  context: TemplateScalarContext,
  evaluate: InterpolationEvaluator,
): string {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('${{', index);
    if (open === -1) break;
    const end = closingDelimiter(text, open + 3);
    if (end === undefined) break;
    result += text.slice(index, open);
    result += hole(evaluate(text.slice(open + 3, end).trim(), frame), node, frame, context);
    index = end + 2;
  }
  return result + text.slice(index);
}

/**
 * Index of the `}}` closing an expression opened at `from`, skipping single-quoted strings (`''`
 * being the escape for a quote inside one, C-E02-006). A private copy of `walk.ts`'s scan: exporting
 * it would make a lexical detail of that module part of its interface, and the two are one rule
 * measured once (C-E03-117), so they are kept in step by `interpolate.test.ts` asserting the
 * doc's own escape spellings against *this* path.
 */
function closingDelimiter(text: string, from: number): number | undefined {
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === "'") {
      index += 1;
      while (index < text.length) {
        if (text[index] === "'") {
          if (text[index + 1] !== "'") break;
          index += 1;
        }
        index += 1;
      }
      index += 1;
      continue;
    }
    if (char === '}' && text[index + 1] === '}') return index;
    index += 1;
  }
  return undefined;
}

/**
 * An evaluated result as a DOM node, for a **lone** expression in value position.
 *
 * Collections stay structural at every depth (C-E03-177/178/179). Every scalar kind goes through
 * `stringForm` first — that is C-E03-183's finding, not a convenience — and the resulting text is
 * then carried as the typed node a parse of that text would have produced: `True` as a Boolean,
 * `1`/`0.5` as Numbers, `''` as the empty String. The parity contract is the service's `finalYaml`
 * *read back*, and reading `True` gives a Boolean, so this is the shape that compares equal.
 *
 * A **String** result is the one kind not re-typed: `${{ '0123' }}` stays the four characters
 * `0123`, because the result is never re-parsed as YAML (C-E03-185). The service's own output is
 * lossy about exactly that case, which is C-E03-193 and E03-S05-T03's to fix.
 */
function structural(value: ExprValue, pos: Provenance): PipelineNode {
  switch (value.kind) {
    case 'string':
      return { kind: 'scalar', value: value.value, style: 'plain', pos };
    case 'null':
    case 'boolean':
    case 'number':
    case 'version':
      return { kind: 'scalar', value: retyped(stringForm(value)), style: 'plain', pos };
    case 'array':
      return { kind: 'sequence', items: value.value.map((child) => structural(child, pos)), pos };
    case 'object':
      return {
        kind: 'mapping',
        entries: objectEntries(value).map(([key, child]): MappingEntry => ({
          key: { kind: 'scalar', value: key, style: 'plain', pos },
          value: structural(child, pos),
        })),
        pos,
      };
  }
}

/** The String form as the front end would have typed that text — see `structural`. */
function retyped(text: string): ScalarNode['value'] {
  if (text === 'True') return true;
  if (text === 'False') return false;
  // Only the renderings `stringForm` can actually produce for a Number: no exponent, no grouping,
  // no leading `+` (C-E03-182). A Version's dotted text deliberately fails this and stays a String.
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function diagnostic(
  code: string,
  message: string,
  node: ScalarNode,
  frame: TemplateFrame,
): Diagnostic {
  return {
    severity: 'error',
    code,
    // No help link: both sentences come back from the service bare, where every *expression* error
    // in the same corpus ends with "For more help, refer to <link>" (C-E03-187/191).
    message,
    file: frame.file,
    // The host scalar's own range. The service locates both sentences at the scalar rather than
    // inside the expression, and carries no "Located at position N" part for either.
    range: node.pos.range,
  };
}
