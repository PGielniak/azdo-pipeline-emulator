import { describe, expect, it } from 'vitest';
import { compileBash, parseExpression, BashCompileError } from '../../src/index.js';

const parse = (text: string) => {
  const result = parseExpression(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.node;
};

describe('Bash expression compiler (C-E02-128..131)', () => {
  it('compiles a quoted variable comparison with lazy and', () => {
    expect(
      compileBash(
        parse("and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))"),
        {
          statusFunctions: { succeeded: 'azdo_status_succeeded' },
        },
      ),
    ).toBe(
      "[ azdo_status_succeeded = True ] && [ \"$(azdo_var 'Build.SourceBranch')\" = 'refs/heads/main' ]",
    );
  });

  it('escapes single quotes in shell literals', () => {
    expect(compileBash(parse("eq('a''b', 'x')"))).toContain("'a'\\''b'");
  });

  it('rejects unsupported dynamic access and functions', () => {
    expect(() => compileBash(parse('variables[foo]'))).toThrow(BashCompileError);
    expect(() => compileBash(parse("counter('x')"))).toThrow(/unsupported shell function/);
  });
});
