// E03-S01-T01 grounding — **directive recognition**, not directive semantics.
//
// The walker's entire job in T01 is to answer, for every mapping key and every sequence item,
// "is this a directive, and if so which one and with what body?" The semantics of each directive
// belong to T02 (`if`/`elseif`/`else`), T03 (`each`) and T04 (`insert`), each of which is required
// to commit oracle fixture pairs of its own. So these probes deliberately stop at *recognition*:
// every one of them uses a body whose meaning is uncontroversial, and the datum read off each is
// "accepted / rejected", plus the error sentence where rejected.
//
// The unknowns, none of which either doc answers:
//
//  1. **Keyword case.** Context and function names fold case (C-E02-011/012) and booleans do too
//     (C-E02-002), so `${{ IF … }}` folding would be the consistent guess — but a directive keyword
//     is not a name in the expression grammar, it is consumed before parsing, and the docs only
//     ever spell them lower-case.
//  2. **Whitespace.** The service trims the delimited text before parsing (C-E02-104), which says
//     nothing about the space *between* the keyword and its argument. `${{if eq(1,1)}}` is the
//     shape a real pipeline hits by accident.
//  3. **How `each x in <coll>` splits.** `in` is an ordinary *function* in this dialect
//     (C-E02-028..032), so ` in ` can legally appear inside the collection expression and inside a
//     string literal within it. A splitter that scans for the wrong occurrence silently iterates
//     the wrong collection — the worst possible failure mode, because it is not an error.
//  4. **Where directives are recognized at all.** The template-expressions doc claims "Expressions
//     are only expanded for `stages`, `jobs`, `steps`, and `containers` (inside `resources`). You
//     can't, for example, use an expression inside `trigger` or a resource like `repositories`."
//     If true, the walk is *position-sensitive* and T01 owes a gate; if false, it is uniform. This
//     is the single most structural question here and it is stated only in a Note.
//  5. **An unrecognized keyword.** `${{ foreach … }}` decides whether directive detection is a
//     closed keyword set checked before expression parsing, or a fallthrough to "ordinary
//     expression key" — which produces a completely different error and a different code path.
//
// Run: node scripts/template-walk-survey.ts [probe-name]
// Output: research/experiments/E03-walk/<probe-name>.md (redacted)
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E03-walk');

const ITEMS = `parameters:
- name: items
  type: object
  default: [alpha, beta]
`;

const EXTRA = `parameters:
- name: extra
  type: object
  default:
    EXTRA_A: '1'
`;

/** A directive in **sequence** position: the `steps:` list, the doc's own example shape. */
const inSequence = (directiveLines: string, parameters = ''): string => `${parameters}steps:
- script: echo base
${directiveLines}`;

/** A directive in **mapping** position: a step's `env:`, again the doc's own example shape. */
const inMapping = (directiveLines: string, parameters = ''): string => `${parameters}steps:
- script: echo base
  env:
    BASE: '1'
${directiveLines}`;

const probe = (name: string, asserts: string, yaml: string): Probe => ({ name, asserts, yaml });

const PROBES: readonly Probe[] = [
  // ---- controls: the exact spellings both docs use, so a rejection below means the *variation*
  // was rejected rather than the harness being wrong.
  probe(
    'ctl-if-sequence',
    'Control. Documented lower-case `if` in sequence position expands.',
    inSequence('- ${{ if eq(1, 1) }}:\n  - script: echo inserted\n'),
  ),
  probe(
    'ctl-if-mapping',
    'Control. Documented lower-case `if` in mapping position expands.',
    inMapping("    ${{ if eq(1, 1) }}:\n      EXTRA: '1'\n"),
  ),
  probe(
    'ctl-each-sequence',
    'Control. Documented lower-case `each` over an object parameter expands.',
    inSequence('- ${{ each item in parameters.items }}:\n  - script: echo ${{ item }}\n', ITEMS),
  ),
  probe(
    'ctl-insert-mapping',
    'Control. Documented lower-case `${{ insert }}` merges into a mapping.',
    inMapping('    ${{ insert }}: ${{ parameters.extra }}\n', EXTRA),
  ),

  // ---- 1. keyword case
  probe(
    'case-if-upper',
    'Does the `if` keyword fold case like every *name* in the grammar does (C-E02-011/012)?',
    inSequence('- ${{ IF eq(1, 1) }}:\n  - script: echo inserted\n'),
  ),
  probe(
    'case-if-title',
    'Mixed-case `If` — separates "folds case" from "accepts upper-case only".',
    inSequence('- ${{ If eq(1, 1) }}:\n  - script: echo inserted\n'),
  ),
  probe(
    'case-each-upper',
    'Same question for `each`, which also has to fold its `in` separator if it folds at all.',
    inSequence('- ${{ EACH item IN parameters.items }}:\n  - script: echo ${{ item }}\n', ITEMS),
  ),
  probe(
    'case-insert-upper',
    'Same question for `insert`, the one directive the actions/runner fork also has.',
    inMapping('    ${{ INSERT }}: ${{ parameters.extra }}\n', EXTRA),
  ),
  probe(
    'case-elseif-else-upper',
    'Same question for the `elseif`/`else` chain keywords.',
    inSequence(
      '- ${{ if eq(1, 2) }}:\n  - script: echo no\n' +
        '- ${{ ELSEIF eq(1, 1) }}:\n  - script: echo elseif\n' +
        '- ${{ ELSE }}:\n  - script: echo else\n',
    ),
  ),

  // ---- 2. whitespace
  probe(
    'ws-if-none',
    'No space anywhere: `${{if eq(1,1)}}`. Is the keyword/argument boundary whitespace-delimited?',
    inSequence('- ${{if eq(1, 1)}}:\n  - script: echo inserted\n'),
  ),
  probe(
    'ws-if-wide',
    'Wide runs of internal whitespace between delimiters, keyword and argument.',
    inSequence('- ${{    if     eq(1, 1)    }}:\n  - script: echo inserted\n'),
  ),
  probe(
    'ws-each-none',
    'No space around the `in` separator: `${{each item in parameters.items}}` is still spaced ' +
      'around `in` because there is no other spelling; this probe removes the delimiter padding.',
    inSequence('- ${{each item in parameters.items}}:\n  - script: echo ${{item}}\n', ITEMS),
  ),
  probe(
    'ws-each-newline',
    'A directive key written across lines — the delimited text carries a real newline, which ' +
      'C-E02-104 showed is trimmed at the ends but says nothing about the middle.',
    inSequence(
      '- ${{ each item\n     in parameters.items }}:\n  - script: echo ${{ item }}\n',
      ITEMS,
    ),
  ),

  // ---- 3. how `each x in <coll>` splits
  probe(
    'each-in-string-literal',
    'The collection expression contains ` in ` **inside a string literal**: ' +
      "`each item in split('a in b', ' in ')`. Iterating ['a','b'] proves the split took the " +
      'first separator; anything else proves it did not.',
    inSequence("- ${{ each item in split('a in b', ' in ') }}:\n  - script: echo ${{ item }}\n"),
  ),
  probe(
    'each-in-function-name',
    'The collection expression *calls* the `in` function: `each item in split(...)` is replaced ' +
      "by one whose argument list contains `in('b','b')`, so the text ` in(` appears after the " +
      'real separator. Guards a splitter that scans for the last occurrence.',
    inSequence(
      "- ${{ each item in split(format('{0}', in('b', 'b')), ',') }}:\n" +
        '  - script: echo ${{ item }}\n',
    ),
  ),
  probe(
    'each-var-named-in',
    'The loop variable itself is named `in`: `${{ each in in parameters.items }}`. Settles ' +
      'whether the separator is found by position (2nd word) or by searching for the token.',
    inSequence('- ${{ each in in parameters.items }}:\n  - script: echo ${{ in }}\n', ITEMS),
  ),

  // ---- 4. where directives/expressions are recognized at all
  probe(
    'pos-expr-in-trigger',
    'The template-expressions doc Note says expressions are expanded only for stages/jobs/steps/' +
      "containers and *not* inside `trigger`. Submits `trigger:\\n- ${{ 'main' }}` — expansion to " +
      '`main` refutes the Note; a literal or a rejection confirms it.',
    "trigger:\n- ${{ 'main' }}\nsteps:\n- script: echo base\n",
  ),
  probe(
    'pos-if-in-trigger',
    'The same question for a *directive* rather than a value expression: an `if` inside `trigger`.',
    'trigger:\n- ${{ if eq(1, 1) }}:\n  - main\nsteps:\n- script: echo base\n',
  ),
  probe(
    'pos-expr-in-pool-demands',
    'A position that is neither a documented-expandable one nor one the Note names — a job ' +
      "`pool.demands` entry. Narrows whether the Note's list is exhaustive.",
    "jobs:\n- job: A\n  pool:\n    vmImage: ubuntu-latest\n    demands:\n    - ${{ 'agent.os -equals Linux' }}\n  steps:\n  - script: echo base\n",
  ),
  probe(
    'pos-if-in-resources-repositories',
    'A directive inside `resources.repositories`, the second position the Note names.',
    'resources:\n  repositories:\n  - ${{ if eq(1, 1) }}:\n    - repository: templates\n      type: git\n      name: does/not-matter\nsteps:\n- script: echo base\n',
  ),

  // ---- 5. unrecognized keyword, and one structural interaction
  probe(
    'unknown-keyword',
    'An unrecognized directive-shaped key `${{ foreach item in parameters.items }}`. The error ' +
      'sentence says whether directive detection is a closed keyword set consumed *before* the ' +
      'expression parse, or a fallthrough into ordinary expression-key parsing.',
    inSequence('- ${{ foreach item in parameters.items }}:\n  - script: echo x\n', ITEMS),
  ),
  probe(
    'unknown-keyword-mapping',
    'The same unrecognized key in mapping position, where an ordinary expression key is legal ' +
      '(`${{ pair.key }}: …`) — so this one separates "not a directive" from "not a valid key".',
    inMapping('    ${{ foreach item in parameters.items }}: x\n', ITEMS),
  ),
  probe(
    'dup-identical-if-keys',
    'Two **byte-identical** `${{ if }}` keys in one mapping. C-E01-023 has the service rejecting ' +
      'duplicate keys case-insensitively at every nesting level; if that check runs before ' +
      'expansion it fires here, and E01 quirks would reject documents the service accepts.',
    inMapping("    ${{ if eq(1, 1) }}:\n      A: '1'\n    ${{ if eq(1, 1) }}:\n      B: '1'\n"),
  ),
  probe(
    'if-alongside-ordinary-keys',
    'Control for the mapping walk: a directive key as a *sibling* of ordinary keys, which the ' +
      'corpus already exercises (06-extends-each-joblist) but never in isolation.',
    inMapping("    ${{ if eq(1, 1) }}:\n      EXTRA: '1'\n    TAIL: '1'\n"),
  ),

  // ---- batch 2, added after reading batch 1. Three of its answers were ambiguous enough that
  // building on them would have encoded a guess.
  probe(
    'each-var-named-eq',
    "Batch 1: a loop variable named `in` failed with \"Expected '(' to follow a function: 'in'\" " +
      "over the expression text `'in'` — which reads as the *variable name itself* being handed " +
      'to the expression parser. `eq` is a function too but is not the `in` separator, so it ' +
      'separates that reading from "the splitter mis-split on the second `in`".',
    inSequence('- ${{ each eq in parameters.items }}:\n  - script: echo ${{ eq }}\n', ITEMS),
  ),
  probe(
    'each-var-named-variables',
    'Same question with a *context* name rather than a function name: does `variables` as a loop ' +
      'variable shadow the context, or collide with it?',
    inSequence(
      '- ${{ each variables in parameters.items }}:\n  - script: echo ${{ variables }}\n',
      ITEMS,
    ),
  ),
  probe(
    'each-var-named-parameters-shadow',
    'A loop variable named `parameters`, shadowing the context the collection expression itself ' +
      'reads. Decides whether the frame is layered over the contexts or merged into them.',
    inSequence(
      '- ${{ each parameters in parameters.items }}:\n  - script: echo ${{ parameters }}\n',
      ITEMS,
    ),
  ),
  probe(
    'pos-if-in-pool-demands',
    "Batch 1 found a value expression expands in `pool.demands` (outside the doc Note's list) " +
      'while a *directive* in `resources.repositories` is rejected "A template expression is not ' +
      'allowed in this context". Asks whether that gate is specific to `resources` or applies ' +
      'wherever the position is not a documented-expandable one.',
    'jobs:\n- job: A\n  pool:\n    vmImage: ubuntu-latest\n    demands:\n    - ${{ if eq(1, 1) }}:\n      - agent.os -equals Linux\n  steps:\n  - script: echo base\n',
  ),
  probe(
    'pos-if-in-variables',
    'Control for the position question: the docs show `${{ if }}` inside `variables:`, which is ' +
      "not in the Note's stages/jobs/steps/containers list either. If this expands, the Note " +
      'describes nothing the engine actually enforces.',
    "variables:\n- name: base\n  value: '1'\n- ${{ if eq(1, 1) }}:\n  - name: extra\n    value: '1'\nsteps:\n- script: echo base\n",
  ),
  probe(
    'if-as-scalar-value',
    'A directive keyword in **value** position rather than key position: `script: ${{ if eq(1,1) }}`. ' +
      'Directive detection must not fire here — the walker keys off the key/item, not the text.',
    'steps:\n- script: ${{ if eq(1, 1) }}\n',
  ),
  probe(
    'elseif-spelled-else-if',
    'Is `elseif` one token? `${{ else if … }}` is the spelling a developer reaches for first.',
    inSequence(
      '- ${{ if eq(1, 2) }}:\n  - script: echo no\n' +
        '- ${{ else if eq(1, 1) }}:\n  - script: echo elseif\n',
    ),
  ),

  // ---- batch 3. `else if` was rejected with a sentence no other probe produced — "Exactly 0
  // parameter(s) were expected following the directive 'else'. Actual parameter count: 2" — which
  // says the delimited text is read as `<keyword> <parameter>*` with a per-directive expected
  // count, and that the parameters are *expression units* rather than whitespace-split words
  // (`if eq(1, 1)` is one parameter, not two). These three pin the counts and prove the unit.
  probe(
    'arity-if-two-parameters',
    'Two expressions after `if`. Expect "Exactly 1 parameter(s) … Actual parameter count: 2", ' +
      "which simultaneously pins `if`'s count and proves a parenthesised call is ONE parameter.",
    inSequence('- ${{ if eq(1, 1) eq(2, 2) }}:\n  - script: echo x\n'),
  ),
  probe(
    'arity-each-four-parameters',
    "Four parameters after `each`. Pins `each`'s expected count (`<var> in <collection>` = 3).",
    inSequence('- ${{ each a in parameters.items extra }}:\n  - script: echo x\n', ITEMS),
  ),
  probe(
    'each-separator-not-in',
    'The separator word replaced: `${{ each item on parameters.items }}`. Says whether the middle ' +
      'parameter is checked against the literal `in` and with what message.',
    inSequence('- ${{ each item on parameters.items }}:\n  - script: echo x\n', ITEMS),
  ),
  // ---- batch 4. Batch 3 split in a way that needs one more cut: `else`+2 and `each`+4 produced
  // the directive-arity sentence, but `if`+2 produced an ordinary expression parse error over the
  // *whole* delimited text instead. These ask whether `if` ever produces the arity sentence.
  probe(
    'arity-if-zero-parameters',
    'A bare `${{ if }}`. If this gives "Exactly 1 parameter(s) … Actual parameter count: 0" then ' +
      '`if` does have an arity check and the two-parameter case is the special one; if it gives an ' +
      'expression error, `if` never reports arity.',
    inSequence('- ${{ if }}:\n  - script: echo x\n'),
  ),
  probe(
    'arity-insert-one-parameter',
    'A parameter after `insert`, which takes none. Third data point for the arity sentence.',
    inMapping('    ${{ insert extra }}: ${{ parameters.extra }}\n', EXTRA),
  ),
  probe(
    'each-var-case-fold',
    'The loop variable is declared `ITEM` and read as `${{ item }}`. Names in the expression ' +
      'grammar fold case (C-E02-011/012); this asks whether a *loop variable* does too, which ' +
      'decides both the lookup and the collision check against context names.',
    inSequence('- ${{ each ITEM in parameters.items }}:\n  - script: echo ${{ item }}\n', ITEMS),
  ),
  probe(
    'each-separator-upper',
    'Separator spelled `IN` with a lower-case `each` keyword. `case-each-upper` could not answer ' +
      'this — its `EACH` was already not a directive, so the whole text fell through to the ' +
      'expression parser and the `IN` was never reached.',
    inSequence('- ${{ each item IN parameters.items }}:\n  - script: echo ${{ item }}\n', ITEMS),
  ),
  probe(
    'bare-function-name-value',
    'A bare known-function name in an ordinary value position: `${{ eq }}`. The `each eq in …` ' +
      "probe was rejected \"Expected '(' to follow a function: 'eq'\", an error kind E02 does " +
      'not implement (`ExprErrorCode` has no such member). This asks whether that kind belongs to ' +
      'the general expression grammar — an E02 gap — or only to the `each` variable slot.',
    'variables:\n  probe: ${{ eq }}\nsteps:\n- script: echo base\n',
  ),
];

await runProbes(PROBES, OUT_DIR);
