import { describe, expect, it } from 'vitest';
import {
  compileBash,
  compileBashValue,
  parseExpression,
  BashCompileError,
} from '../../src/index.js';

const parse = (text: string) => {
  const result = parseExpression(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.node;
};

describe('Bash expression compiler (C-E02-128..131, C-E02-145..146)', () => {
  it('compiles the docs/02 §6 canonical condition', () => {
    // T01 shipped `[ azdo_status_succeeded = True ]` here — a bare *word* compared against a
    // string, which never invokes the status function and is False for every run. The doc's own
    // form is the command itself in an AND list, and E02-S05-T02's bats runner is what proved the
    // difference: the old form ran green as a string assertion and could never have executed.
    expect(
      compileBash(
        parse("and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))"),
        { statusFunctions: { succeeded: 'azdo_status_succeeded' } },
      ),
    ).toBe(
      'azdo_status_succeeded && azdo_expr_cmp eq str "$(azdo_var \'Build.SourceBranch\')" str refs/heads/main',
    );
  });

  it('carries the operand kind so the runtime can reproduce the conversion table', () => {
    // `eq(1, true)` is True (Boolean→Number), which a naive `[ "1" = True ]` would get wrong.
    expect(compileBash(parse('eq(1, true)'))).toBe('azdo_expr_cmp eq num 1 bool True');
    expect(compileBash(parse('lt(1.2.0, 1.3)'))).toBe('azdo_expr_cmp lt ver 1.2.0 num 1.3');
  });

  it('braces a nested list before && , || and !', () => {
    expect(compileBash(parse('not(or(eq(1, 1), eq(2, 2)))'))).toBe(
      '! { azdo_expr_cmp eq num 1 num 1 || azdo_expr_cmp eq num 2 num 2; }',
    );
  });

  it('escapes single quotes in shell literals', () => {
    expect(compileBash(parse("eq('a''b', 'x')"))).toContain("'a'\\''b'");
  });

  it('reads dependency outputs through the runtime API', () => {
    expect(compileBash(parse("eq(stageDependencies.S.A.outputs['setSha.short'], 'abc')"))).toBe(
      "azdo_expr_cmp eq str \"$(azdo_output 'S' 'A' 'setSha.short')\" str abc",
    );
  });

  it('reads dependency results through the runtime result store (C-E02-092..094)', () => {
    expect(compileBash(parse("eq(dependencies.Build.result, 'Succeeded')"))).toBe(
      'azdo_expr_cmp eq str "$(azdo_job_result "$AZDO_STAGE_ID" \'Build\')" str Succeeded',
    );
    expect(
      compileBash(parse("eq(dependencies.Build.result, 'Skipped')"), {
        dependencyKind: 'stage',
      }),
    ).toBe('azdo_expr_cmp eq str "$(azdo_stage_result \'Build\')" str Skipped');
    expect(compileBash(parse("eq(stageDependencies.Build.Compile.result, 'Failed')"))).toBe(
      "azdo_expr_cmp eq str \"$(azdo_job_result 'Build' 'Compile')\" str Failed",
    );
  });

  it('compiles a predicate used as a value through azdo_expr_bool', () => {
    expect(compileBashValue(parse('eq(1, 1)'))).toEqual({
      kind: 'bool',
      code: '"$(azdo_expr_cmp eq num 1 num 1; azdo_expr_bool $?)"',
    });
  });

  it('rejects what the shell backend cannot represent (C-E02-139/145)', () => {
    expect(() => compileBash(parse('eq(variables[variables.x], 1)'))).toThrow(BashCompileError);
    expect(() => compileBash(parse("eq(split('a,b', ','), 'x')"))).toThrow(
      /has no shell representation/,
    );
    expect(() => compileBash(parse("eq(join(',', 'x'), 'y')"))).toThrow(BashCompileError);
    expect(() => compileBash(parse("eq(convertToJson('a'), 'b')"))).toThrow(BashCompileError);
    expect(() => compileBash(parse("eq(pipeline.startTime, 'x')"))).toThrow(
      /is not readable by the shell backend/,
    );
  });

  it('rejects a mixed-kind coalesce rather than guessing the result kind', () => {
    expect(() => compileBash(parse("eq(coalesce('', 1), 'x')"))).toThrow(/one kind/);
  });
});
