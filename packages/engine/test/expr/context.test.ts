import { describe, expect, it } from 'vitest';
import {
  EXPR_CONTEXT_NAMES,
  ExprContextUnavailableError,
  ExprKeyNotFoundError,
  NULL,
  SLOT_AVAILABILITY,
  accessIndex,
  accessProperty,
  contextsForSlot,
  decodeExprValue,
  encodeExprValue,
  isContextAvailable,
  parametersContext,
  parseExpression,
  registryForSlot,
  resolveContext,
  statusScopeForSlot,
  stringValue,
  variablesContext,
  type ExprContextName,
  type ExprSlot,
} from '../../src/index.js';

/**
 * The availability grid exactly as `research/experiments/E02-context/survey.md` measured it, one
 * row per context. Each cell names the probe id that established it, so a failing row points at
 * the live call that has to be re-run (`pnpm expr-context-survey`) rather than at an opinion.
 *
 * `step-condition` is deliberately absent: its negative controls proved the slot resolves no names
 * at all, so there is nothing to assert against the service there (C-E02-085).
 */
const MATRIX: ReadonlyArray<{
  readonly context: ExprContextName;
  readonly template: boolean;
  readonly runtimeVar: boolean;
  readonly condition: boolean;
}> = [
  // parameters-compile-var / parameters-runtime-var / parameters-job-condition
  { context: 'parameters', template: true, runtimeVar: false, condition: false },
  // variables-compile-var / variables-runtime-var / variables-job-condition
  { context: 'variables', template: true, runtimeVar: true, condition: true },
  // dependencies-compile-var / dependencies-runtime-var / dependencies-job-condition
  { context: 'dependencies', template: false, runtimeVar: false, condition: true },
  // stagedependencies-compile-var / -runtime-var / -job-condition
  { context: 'stageDependencies', template: false, runtimeVar: false, condition: true },
  // resources-compile-var / resources-runtime-var / resources-job-condition
  { context: 'resources', template: false, runtimeVar: true, condition: false },
  // pipeline-compile-var / pipeline-runtime-var / pipeline-job-condition
  { context: 'pipeline', template: false, runtimeVar: true, condition: true },
  // environment-compile-var / environment-runtime-var / environment-job-condition
  { context: 'environment', template: false, runtimeVar: false, condition: false },
];

describe('context availability matrix (C-E02-080..084)', () => {
  for (const row of MATRIX) {
    it(`places ${row.context} exactly where the service does`, () => {
      expect(isContextAvailable('template-expression', row.context)).toBe(row.template);
      expect(isContextAvailable('runtime-variable', row.context)).toBe(row.runtimeVar);
      expect(isContextAvailable('job-condition', row.context)).toBe(row.condition);
    });
  }

  it('gives job and stage conditions one table (pipeline-stage-condition, resources-stage-condition)', () => {
    expect(contextsForSlot('stage-condition')).toEqual(contextsForSlot('job-condition'));
  });

  it('keeps the two runtime slots distinct — a double dissociation, not a compile/run split (C-E02-082)', () => {
    // Each slot has exactly one context the other lacks, so neither table is a subset of the other
    // and "runtime" cannot be one set.
    expect(isContextAvailable('runtime-variable', 'resources')).toBe(true);
    expect(isContextAvailable('job-condition', 'resources')).toBe(false);
    expect(isContextAvailable('job-condition', 'dependencies')).toBe(true);
    expect(isContextAvailable('runtime-variable', 'dependencies')).toBe(false);
  });

  it('folds case when matching context names (C-E02-011/012)', () => {
    expect(isContextAvailable('template-expression', 'PARAMETERS')).toBe(true);
    expect(isContextAvailable('job-condition', 'stagedependencies')).toBe(true);
  });

  it('marks only the step slot ungrounded, and says why (C-E02-085)', () => {
    const ungrounded = (Object.keys(SLOT_AVAILABILITY) as ExprSlot[]).filter(
      (slot) => !SLOT_AVAILABILITY[slot].grounded,
    );
    expect(ungrounded).toEqual(['step-condition']);
    expect(SLOT_AVAILABILITY['step-condition'].note).toMatch(/resolves no names/);
  });
});

describe('phase gating through the parser (C-E02-081)', () => {
  const parse = (slot: ExprSlot, text: string) =>
    parseExpression(text, { registry: registryForSlot(slot) });

  it('rejects dependencies at compile time with the service sentence', () => {
    const result = parse('template-expression', 'dependencies.A.result');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Byte-for-byte the message from probe `dependencies-compile-var`.
    expect(result.error.message).toBe("Unrecognized value: 'dependencies'");
    expect(result.error.code).toBe('unrecognized-value');
    // …and the service located it at position 1, i.e. span start 0.
    expect(result.error.span.start).toBe(0);
  });

  it('rejects a wrong-slot context identically to an unknown one (the reason there is no new error kind)', () => {
    const wrongSlot = parse('template-expression', 'dependencies.A.result');
    const unknown = parse('template-expression', 'nosuchcontext.probe');
    expect(wrongSlot.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (wrongSlot.ok || unknown.ok) return;
    expect(wrongSlot.error.code).toBe(unknown.error.code);
    // Same reported position (the service said "position 1" for both); the spans end at different
    // offsets only because the two names are different lengths.
    expect(wrongSlot.error.span.start).toBe(unknown.error.span.start);
    expect(wrongSlot.error.span.end).toBe('dependencies'.length);
    expect(unknown.error.span.end).toBe('nosuchcontext'.length);
    expect(wrongSlot.error.message.replace('dependencies', 'X')).toBe(
      unknown.error.message.replace('nosuchcontext', 'X'),
    );
  });

  it('rejects parameters in a runtime variable and a condition, accepts it at compile time', () => {
    expect(parse('template-expression', 'parameters.myParam').ok).toBe(true);
    expect(parse('runtime-variable', 'parameters.myParam').ok).toBe(false);
    expect(parse('job-condition', 'parameters.myParam').ok).toBe(false);
  });

  it('rejects resources in a condition while accepting it in a runtime variable', () => {
    expect(parse('runtime-variable', 'resources.pipeline.probe.runID').ok).toBe(true);
    expect(parse('job-condition', 'resources.pipeline.probe.runID').ok).toBe(false);
    expect(parse('stage-condition', 'resources.pipeline.probe.runID').ok).toBe(false);
  });

  it('accepts variables everywhere it was measured', () => {
    for (const slot of ['template-expression', 'runtime-variable', 'job-condition'] as const) {
      expect(parse(slot, 'variables.myVar').ok).toBe(true);
    }
  });
});

describe('the slot also gates the function table (C-E02-065)', () => {
  it('maps each condition slot to its status scope and the value slots to none', () => {
    expect(statusScopeForSlot('step-condition')).toBe('step');
    expect(statusScopeForSlot('job-condition')).toBe('job');
    expect(statusScopeForSlot('stage-condition')).toBe('stage');
    expect(statusScopeForSlot('template-expression')).toBeUndefined();
    expect(statusScopeForSlot('runtime-variable')).toBeUndefined();
  });

  it('makes status functions legal in conditions and rejected in variable definitions', () => {
    const registry = (slot: ExprSlot) => ({ registry: registryForSlot(slot) });
    expect(parseExpression('always()', registry('job-condition')).ok).toBe(true);
    expect(parseExpression('always()', registry('template-expression')).ok).toBe(false);
    expect(parseExpression('always()', registry('runtime-variable')).ok).toBe(false);
  });

  it('restricts counter to the runtime variable slot, the only one that accepts it (C-E02-096)', () => {
    const ok = (slot: ExprSlot) =>
      parseExpression("counter('probe', 1)", { registry: registryForSlot(slot) }).ok;
    expect(ok('runtime-variable')).toBe(true);
    // Rejected in both conditions AND in a compile-time variable — narrower than the doc sentence
    // "only in an expression that defines a variable".
    expect(ok('job-condition')).toBe(false);
    expect(ok('stage-condition')).toBe(false);
    expect(ok('template-expression')).toBe(false);
  });

  it('rejects counter with the service sentence, not a special one (probe counter-job-condition)', () => {
    const result = parseExpression("counter('probe', 1)", {
      registry: registryForSlot('job-condition'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("Unrecognized value: 'counter'");
  });

  it('leaves the unrestricted functions in every slot', () => {
    for (const slot of ['template-expression', 'runtime-variable', 'job-condition'] as const) {
      expect(parseExpression("format('{0}', 1)", { registry: registryForSlot(slot) }).ok).toBe(
        true,
      );
    }
  });

  it('carries the scope-dependent status arity through the slot (C-E02-064)', () => {
    // `succeeded('A')` is legal on a job, rejected on a step — the same spelling, two engines.
    expect(
      parseExpression("succeeded('A')", { registry: registryForSlot('job-condition') }).ok,
    ).toBe(true);
    expect(
      parseExpression("succeeded('A')", { registry: registryForSlot('step-condition') }).ok,
    ).toBe(false);
  });
});

describe('resolveContext', () => {
  const context = {
    slot: 'template-expression' as const,
    values: { parameters: parametersContext({ myParam: stringValue('paramValue') }) },
  };

  it('resolves an available context, folding the name case', () => {
    expect(resolveContext(context, 'PARAMETERS')).toBe(context.values.parameters);
  });

  it('throws the service sentence for a context this slot does not have', () => {
    expect(() => resolveContext(context, 'dependencies')).toThrow(ExprContextUnavailableError);
    expect(() => resolveContext(context, 'dependencies')).toThrow(
      "Unrecognized value: 'dependencies'",
    );
  });

  it('treats a legal-but-unsupplied context as empty rather than an error (C-E02-086)', () => {
    const resolved = resolveContext({ slot: 'template-expression', values: {} }, 'variables');
    expect(resolved.kind).toBe('object');
    expect(accessProperty(resolved, 'anything')).toEqual(NULL);
  });

  it('names every context the service knows', () => {
    expect([...EXPR_CONTEXT_NAMES].sort()).toEqual(MATRIX.map((row) => row.context).sort());
  });
});

describe('the parameters context (C-E02-087)', () => {
  const parameters = parametersContext({ myParam: stringValue('paramValue') });

  it('folds key case at the top level, unlike a nested parameter object (probe parameters-property-case)', () => {
    expect(accessProperty(parameters, 'MYPARAM')).toEqual(stringValue('paramValue'));
    expect(accessIndex(parameters, stringValue('myparam'))).toEqual(stringValue('paramValue'));
  });

  it('raises Key not found on a miss instead of null-propagating (probe parameters-missing)', () => {
    expect(() => accessProperty(parameters, 'noSuchParameter')).toThrow(ExprKeyNotFoundError);
    // The service's sentence, which carries no position and no help link.
    expect(() => accessProperty(parameters, 'noSuchParameter')).toThrow(
      "Key not found 'noSuchParameter'",
    );
  });

  it('raises the same miss when the pipeline declares no parameters at all (probe parameters-undeclared-block)', () => {
    expect(() => accessProperty(parametersContext({}), 'myParam')).toThrow(ExprKeyNotFoundError);
  });

  it('leaves objects nested inside a parameter value null-propagating and ordinal (C-E02-024/027)', () => {
    // The miss policy is a property of the context object, not of everything reachable from it.
    const nested = accessProperty(parametersContext({ obj: parametersContext({}) }), 'obj');
    expect(nested.kind).toBe('object');
  });
});

describe('the variables context (C-E02-086/089)', () => {
  const variables = variablesContext({ myVar: 'varValue', 'My.Var': 'dottedValue' });

  it('is flat: a dotted name is one key, reachable only by index syntax (probe variables-index-dotted)', () => {
    expect(accessIndex(variables, stringValue('My.Var'))).toEqual(stringValue('dottedValue'));
  });

  it('null-propagates the property chain that looks like nesting (probe variables-property-dotted)', () => {
    // `variables.My.Var` reads a variable named `My`, misses, then indexes into Null.
    const my = accessProperty(variables, 'My');
    expect(my).toEqual(NULL);
    expect(accessProperty(my, 'Var')).toEqual(NULL);
  });

  it('folds key case (probe variables-property-case)', () => {
    expect(accessProperty(variables, 'MYVAR')).toEqual(stringValue('varValue'));
  });

  it('returns Null on a miss — the opposite of parameters in the same slot (probe variables-missing)', () => {
    expect(accessProperty(variables, 'noSuchVariable')).toEqual(NULL);
  });
});

describe('miss policy survives serialization (C-E02-087/088)', () => {
  it('round-trips a parameters context without downgrading it to null-propagating', () => {
    const restored = decodeExprValue(encodeExprValue(parametersContext({})));
    // Without the policy on the wire this returns Null and the divergence goes silent.
    expect(() => accessProperty(restored, 'myParam')).toThrow(ExprKeyNotFoundError);
  });

  it('keeps a variables context null-propagating across the same round trip', () => {
    const restored = decodeExprValue(encodeExprValue(variablesContext({ myVar: 'varValue' })));
    expect(accessProperty(restored, 'noSuchVariable')).toEqual(NULL);
    expect(accessProperty(restored, 'MYVAR')).toEqual(stringValue('varValue'));
  });
});
