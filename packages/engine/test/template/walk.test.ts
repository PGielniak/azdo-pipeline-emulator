// E03-S01-T01 — DOM walker with context stack.
//
// Every case names the claim it encodes; the claims live in `research/E03-template-engine.md`
// (block C-E03-100..115) and their transcripts under `research/experiments/E03-walk/`.
import { describe, expect, it } from 'vitest';
import {
  parsePipelineYaml,
  type MappingNode,
  type PipelineNode,
} from '../../src/frontend/parse.js';
import {
  bindLoopVariable,
  childFrame,
  expressionUnits,
  loneExpression,
  parseDirectiveKey,
  rootFrame,
  walkTemplate,
  type DirectiveSite,
} from '../../src/template/walk.js';

const parse = (source: string): PipelineNode | undefined =>
  parsePipelineYaml(source, 'azure-pipelines.yml').root;

const keywordsOf = (sites: readonly DirectiveSite[]): string[] =>
  sites.map((site) => site.directive.keyword);

describe('loneExpression', () => {
  it('accepts exactly one ${{ }} and reports where the trimmed text starts', () => {
    expect(loneExpression('${{ if eq(1, 1) }}')).toEqual({ inner: 'if eq(1, 1)', offset: 4 });
  });

  it('C-E02-104 — internal padding is trimmed and the offset follows it', () => {
    expect(loneExpression('${{    if     eq(1, 1)    }}')).toEqual({
      inner: 'if     eq(1, 1)',
      offset: 7,
    });
  });

  it('C-E03-108 — delimiter padding is optional', () => {
    expect(loneExpression('${{if eq(1, 1)}}')?.inner).toBe('if eq(1, 1)');
  });

  it.each([
    ['name-${{ parameters.suffix }}', 'mixed content is interpolation (T05), never a directive'],
    ['${{ a }}${{ b }}', 'two expressions are not one'],
    ['plain', 'no delimiters at all'],
    ['$[ eq(1, 1) ]', 'a runtime expression is a different delimiter'],
  ])('rejects %j — %s', (text) => {
    expect(loneExpression(text)).toBeUndefined();
  });
});

describe('expressionUnits — C-E03-101', () => {
  // The counts the service itself reported, read off the "Actual parameter count: N" sentences.
  it.each([
    ['if eq(1, 1)', ['if', 'eq(1, 1)']],
    ['if eq(1, 1) eq(2, 2)', ['if', 'eq(1, 1)', 'eq(2, 2)']],
    ['else if eq(1, 1)', ['else', 'if', 'eq(1, 1)']],
    ['each a in parameters.items extra', ['each', 'a', 'in', 'parameters.items', 'extra']],
    ['insert extra', ['insert', 'extra']],
    ['insert', ['insert']],
  ])('%j splits into its top-level units', (text, expected) => {
    expect(expressionUnits(text).map((unit) => unit.text)).toEqual(expected);
  });

  it('C-E03-104 — ` in ` inside a string literal is not a unit boundary', () => {
    expect(expressionUnits("each item in split('a in b', ' in ')").map((u) => u.text)).toEqual([
      'each',
      'item',
      'in',
      "split('a in b', ' in ')",
    ]);
  });

  it('C-E03-104 — an `in(` call after the separator does not become one either', () => {
    expect(
      expressionUnits("each item in split(format('{0}', in('b', 'b')), ',')").map((u) => u.text),
    ).toEqual(['each', 'item', 'in', "split(format('{0}', in('b', 'b')), ',')"]);
  });

  it('index and property chains stay in one unit', () => {
    expect(expressionUnits("each x in parameters['a'].b[0].c").map((u) => u.text)).toEqual([
      'each',
      'x',
      'in',
      "parameters['a'].b[0].c",
    ]);
  });

  it('spans slice their own text back out', () => {
    const text = "each item in split('a in b', ' in ')";
    for (const unit of expressionUnits(text)) {
      expect(text.slice(unit.span.start, unit.span.end)).toBe(unit.text);
    }
  });
});

describe('parseDirectiveKey', () => {
  it.each(['if eq(1, 1)', 'elseif eq(1, 1)', 'else', 'insert', 'each item in parameters.items'])(
    'recognizes ${{ %s }}',
    (inner) => {
      expect(parseDirectiveKey(`\${{ ${inner} }}`).kind).toBe('directive');
    },
  );

  // C-E03-100 — the one case-sensitive corner of the language. Each of these was rejected live
  // with an *expression* error over the whole text, i.e. it is not a directive at all.
  it.each(['IF eq(1, 1)', 'If eq(1, 1)', 'EACH item IN parameters.items', 'INSERT', 'ELSE'])(
    'C-E03-100 — %j is not a directive: the keyword is case-sensitive',
    (inner) => {
      expect(parseDirectiveKey(`\${{ ${inner} }}`).kind).toBe('not-a-directive');
    },
  );

  it('C-E03-107 — the loop *variable* still folds case, unlike the keyword', () => {
    const match = parseDirectiveKey('${{ each ITEM in parameters.items }}');
    expect(match.kind).toBe('directive');
    const bound = bindLoopVariable(rootFrame('a.yml'), 'ITEM');
    expect(bound.ok && bound.frame.names.has('item')).toBe(true);
  });

  it('C-E03-112 — a directive keyword needs no special casing in value position', () => {
    // The walker only ever classifies keys, but the classifier itself must not claim a directive
    // for a scalar the service rejects as `Unexpected value` with no expression error at all.
    expect(parseDirectiveKey('script: ${{ if eq(1, 1) }}').kind).toBe('not-a-directive');
  });

  it.each([
    ['${{ each a in parameters.items extra }}', 'each', 3, 4],
    ['${{ else if eq(1, 1) }}', 'else', 0, 2],
    ['${{ insert extra }}', 'insert', 0, 1],
  ])(
    'C-E03-101 — %s reports the service parameter-count sentence',
    (text, keyword, expected, actual) => {
      const match = parseDirectiveKey(text);
      expect(match.kind).toBe('malformed');
      expect(match.kind === 'malformed' && match.message).toBe(
        `Exactly ${expected} parameter(s) were expected following the directive '${keyword}'. ` +
          `Actual parameter count: ${actual}`,
      );
    },
  );

  it.each(['${{ each item on parameters.items }}', '${{ each item IN parameters.items }}'])(
    'C-E03-103 — %s reports the each-format sentence, separator compared case-sensitively',
    (text) => {
      const match = parseDirectiveKey(text);
      expect(match.kind).toBe('malformed');
      expect(match.kind === 'malformed' && match.message).toMatch(
        /^The value '(on|IN)' is unexpected\. The expected format of an 'each' expression is: \$\{ each <identifier> in <value> \}$/,
      );
    },
  );

  // C-E03-102 — `if`/`elseif` never produce the parameter-count sentence: the service parses the
  // whole delimited text as an ordinary expression instead, so the classifier must hand the text
  // back rather than invent an arity error the service never emits.
  it.each(['${{ if }}', '${{ if eq(1, 1) eq(2, 2) }}', '${{ elseif }}'])(
    'C-E03-102 — %s falls through rather than reporting an arity error',
    (text) => {
      expect(parseDirectiveKey(text).kind).toBe('not-a-directive');
    },
  );

  it('C-E03-104 — the each collection keeps the whole expression, separator text and all', () => {
    const match = parseDirectiveKey("${{ each item in split('a in b', ' in ') }}");
    expect(
      match.kind === 'directive' && match.directive.keyword === 'each' && match.directive,
    ).toMatchObject({
      variable: { text: 'item' },
      collection: { text: "split('a in b', ' in ')" },
    });
  });
});

describe('context stack — C-E03-106', () => {
  it('adds a loop variable to a flat namespace', () => {
    const bound = bindLoopVariable(rootFrame('a.yml'), 'item');
    expect(bound.ok && [...bound.frame.names]).toEqual(['item']);
  });

  it.each(['variables', 'parameters', 'resources'])(
    'refuses to shadow the %s context, with the service sentence (typo included)',
    (name) => {
      const bound = bindLoopVariable(rootFrame('a.yml'), name);
      expect(bound).toEqual({
        ok: false,
        message: `The idenfifier '${name}' has already been defined within the current scope`,
      });
    },
  );

  it('refuses to redefine an outer loop variable, folding case', () => {
    const outer = bindLoopVariable(rootFrame('a.yml'), 'item');
    expect(outer.ok).toBe(true);
    if (!outer.ok) return;
    expect(bindLoopVariable(outer.frame, 'ITEM').ok).toBe(false);
  });

  it('a child file starts with its own names and one more level of depth (docs/02 §5)', () => {
    const outer = bindLoopVariable(rootFrame('a.yml'), 'item');
    expect(outer.ok).toBe(true);
    if (!outer.ok) return;
    const child = childFrame(outer.frame, 'templates/b.yml');
    expect(child).toMatchObject({ file: 'templates/b.yml', depth: 1 });
    expect([...child.names]).toEqual([]);
  });
});

describe('walkTemplate', () => {
  it('finds directives in sequence position, in document order', () => {
    const result = walkTemplate(
      parse(
        [
          'steps:',
          '- script: base',
          '- ${{ if eq(1, 2) }}:',
          '  - script: a',
          '- ${{ elseif eq(1, 1) }}:',
          '  - script: b',
          '- ${{ else }}:',
          '  - script: c',
          '',
        ].join('\n'),
      ),
      rootFrame('azure-pipelines.yml'),
    );
    expect(keywordsOf(result.directives)).toEqual(['if', 'elseif', 'else']);
    // Chain *grouping* is E03-S01-T02's; T01 only guarantees document order and the index needed
    // to do the grouping.
    expect(result.directives.map((site) => site.index)).toEqual([1, 2, 3]);
  });

  it('finds directives in mapping position alongside ordinary keys', () => {
    const result = walkTemplate(
      parse(
        [
          'steps:',
          '- script: base',
          '  env:',
          "    BASE: '1'",
          '    ${{ if eq(1, 1) }}:',
          "      EXTRA: '1'",
          "    TAIL: '1'",
          '',
        ].join('\n'),
      ),
      rootFrame('azure-pipelines.yml'),
    );
    expect(keywordsOf(result.directives)).toEqual(['if']);
    const site = result.directives[0];
    expect(site?.container).toBe('mapping');
    expect(site?.index).toBe(1);
  });

  it('C-E03-111 — two byte-identical directive keys are both seen', () => {
    // The service accepts this and merges both bodies. (Our E01 duplicate-key quirk still rejects
    // the document earlier, at parse time — recorded on E01-S01-T02, not fixed here.)
    const result = walkTemplate(
      parse(
        [
          'steps:',
          '- script: base',
          '  env:',
          '    ${{ if eq(1, 1) }}:',
          "      A: '1'",
          '    ${{ if eq(1, 1) }}:',
          "      B: '1'",
          '',
        ].join('\n'),
      ),
      rootFrame('azure-pipelines.yml'),
    );
    expect(keywordsOf(result.directives)).toEqual(['if', 'if']);
  });

  it('a sequence item with sibling keys is a mapping, not a sequence directive', () => {
    // The corpus idiom `${{ each pair in job }}` → `${{ if ne(pair.key, 'steps') }}` relies on
    // this: the inner directive is reached through the mapping walk.
    const result = walkTemplate(
      parse(
        ['jobs:', '- job: A', '  ${{ if eq(1, 1) }}:', '    condition: succeeded()', ''].join('\n'),
      ),
      rootFrame('azure-pipelines.yml'),
    );
    expect(result.directives.map((site) => site.container)).toEqual(['mapping']);
  });

  it('descends into directive bodies so nested directives are found', () => {
    const result = walkTemplate(
      parse(
        [
          'steps:',
          '- ${{ each item in parameters.items }}:',
          '  - ${{ if eq(1, 1) }}:',
          '    - script: ${{ item }}',
          '',
        ].join('\n'),
      ),
      rootFrame('azure-pipelines.yml'),
    );
    expect(keywordsOf(result.directives)).toEqual(['each', 'if']);
  });

  it('C-E02-110 — malformed directives accumulate rather than aborting the walk', () => {
    const result = walkTemplate(
      parse(
        [
          'steps:',
          '- ${{ each a in parameters.items extra }}:',
          '  - script: a',
          '- ${{ insert extra }}:',
          '  - script: b',
          '- ${{ if eq(1, 1) }}:',
          '  - script: c',
          '',
        ].join('\n'),
      ),
      rootFrame('azure-pipelines.yml'),
    );
    expect(result.diagnostics).toHaveLength(2);
    // No help link on either: both sentences come back from the service bare (C-E03-101/103).
    expect(result.diagnostics.every((d) => !d.message.includes('go.microsoft.com'))).toBe(true);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      file: 'azure-pipelines.yml',
      range: { line: 2, col: 3 },
    });
    // The walk continued and still found the well-formed directive after both failures.
    expect(keywordsOf(result.directives)).toEqual(['if']);
  });

  it('the default walk preserves the tree, provenance included', () => {
    const source = [
      'steps:',
      '- script: base',
      '- ${{ if eq(1, 1) }}:',
      '  - script: inserted',
      '',
    ].join('\n');
    const root = parse(source);
    const result = walkTemplate(root, rootFrame('azure-pipelines.yml'));
    // Deep-equal rather than identity: the walk rebuilds containers, and E03-S04-T02's provenance
    // map plus every expression diagnostic depend on `pos` surviving that rebuild unchanged.
    expect(result.node).toEqual(root);
  });

  it('visitors splice replacements in both container kinds', () => {
    const source = ['steps:', '- ${{ if eq(1, 1) }}:', '  - script: a', '  - script: b', ''].join(
      '\n',
    );
    const result = walkTemplate(parse(source), rootFrame('azure-pipelines.yml'), {
      sequenceDirective: (site) => (site.body.kind === 'sequence' ? [...site.body.items] : []),
    });
    const steps = (result.node as MappingNode).entries[0]?.value;
    expect(steps?.kind).toBe('sequence');
    expect(steps?.kind === 'sequence' && steps.items).toHaveLength(2);
  });

  it('the scalar hook sees every scalar, keys included', () => {
    const seen: string[] = [];
    walkTemplate(parse('steps:\n- script: hello\n'), rootFrame('azure-pipelines.yml'), {
      scalar: (node) => {
        seen.push(String(node.value));
        return undefined;
      },
    });
    expect(seen).toEqual(['steps', 'script', 'hello']);
  });

  it('an empty document walks to nothing without throwing', () => {
    expect(walkTemplate(undefined, rootFrame('a.yml'))).toEqual({
      node: undefined,
      directives: [],
      diagnostics: [],
    });
  });
});
