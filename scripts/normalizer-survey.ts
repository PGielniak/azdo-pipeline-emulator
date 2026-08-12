// E03-S05-T01 grounding — what does the service *do* to a document, and is its output stable?
//
// Two questions, both answered by feeding the corpus pairs back to the preview endpoint:
//
//  1. **Fixpoint.** Is `preview(finalYaml) == finalYaml`? If the service's own output re-expands
//     to itself, then `finalYaml` is a canonical form and the normalizer has a defined target to
//     map our expansion onto. If it does not, the difference is itself a normalizer rule.
//  2. **Injected defaults.** Every key present in the output whose authored input never mentioned
//     it is a server-injected default, and the task requires each one to be catalogued with the
//     sample that motivated it.
//
// Output: research/experiments/E03-normalizer/survey.md (redacted), which is the evidence behind
// the rule list in research/E03-normalizer.md.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configFromEnv, preview, redact } from '../packages/fetch/src/oracle.ts';
// Plain `yaml` rather than the engine's DOM parser: this survey only needs key paths, and the
// engine's internal imports carry `.js` specifiers that node's type stripping cannot resolve from
// outside the package. The normalizer itself consumes the engine DOM (E01-S01-T01).
import { parse } from 'yaml';
import { loadEnvFile } from './oracle-transcript.ts';
import { oraclePairPath, readCorpus } from './corpus.ts';
import { readFile } from 'node:fs/promises';

const OUT_DIR = path.join('research', 'experiments', 'E03-normalizer');

/** Every key path in a document, as `a.b[].c`. */
function keyPaths(node: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) keyPaths(item, `${prefix}[]`, out);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const at = prefix === '' ? key : `${prefix}.${key}`;
      out.add(at);
      keyPaths(value, at, out);
    }
  }
  return out;
}

const pathsOf = (source: string): Set<string> => keyPaths(parse(source) as unknown);

const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);
const corpus = await readCorpus();
await mkdir(OUT_DIR, { recursive: true });

/**
 * The one shape the service emits but refuses to read back: `trigger: none` expands to
 * `trigger:\n  enabled: false`, and submitting *that* is rejected with "Unexpected value
 * 'enabled'". Undoing it isolates whether anything *else* blocks the round-trip.
 */
function undoDisableForm(yaml: string): string {
  return yaml.replace(/^(trigger|pr):\n {2}enabled: false\n/gm, '$1: none\n');
}

const rows: string[] = [];
const injectedEverywhere = new Map<string, Set<string>>();
let fixpoints = 0;
let moduloFixpoints = 0;

for (const entry of corpus) {
  const golden = await readFile(oraclePairPath(entry.name), 'utf8');

  // Question 1 — re-expand the service's own output.
  const again = await preview(config, { yamlOverride: golden });
  const reExpanded = again.kind === 'expanded' ? redact(again.finalYaml, config) : undefined;
  const stable = reExpanded === golden;
  if (stable) fixpoints += 1;

  // Second pass: same golden with the disable form undone. If *this* comes back identical to the
  // golden, the expansion is a fixpoint modulo exactly one rewrite.
  const patched = undoDisableForm(golden);
  const modulo =
    patched === golden
      ? undefined
      : await preview(config, { yamlOverride: patched }).then((o) =>
          o.kind === 'expanded' ? redact(o.finalYaml, config) === golden : false,
        );
  if (modulo === true) moduloFixpoints += 1;

  // Question 2 — key paths the output has and the authored input never mentioned.
  // A path counts as injected only when **no input path ends with it**. Plain set difference
  // would flag almost everything: wrapping a `steps:`-only document in `stages: __default` /
  // `job: Job` (C-E00-022) shifts every path, so `jobs[].workspace.clean` and
  // `stages[].jobs[].workspace.clean` are the same authored key at a deeper position.
  const inputPaths = [...pathsOf(entry.rootYaml)];
  const outputPaths = pathsOf(golden);
  const injected = [...outputPaths]
    .filter((p) => !inputPaths.some((i) => p === i || p.endsWith(`.${i}`) || i.endsWith(`.${p}`)))
    .sort();
  for (const p of injected) {
    if (!injectedEverywhere.has(p)) injectedEverywhere.set(p, new Set());
    injectedEverywhere.get(p)?.add(entry.name);
  }

  const verdict =
    again.kind === 'expanded'
      ? stable
        ? '**fixpoint**'
        : '**differs**'
      : again.kind === 'rejected'
        ? `**rejected** — ${redact(again.message, config).replace(/\s+/g, ' ').slice(0, 220)}`
        : again.kind;
  rows.push(
    `| \`${entry.name}\` | ${verdict} | ${
      modulo === undefined ? '— (no disable form)' : modulo ? '**identical**' : 'still differs'
    } | ${injected.length} |`,
  );
  console.log(
    `${entry.name.padEnd(30)} re-expand: ${
      again.kind === 'expanded' ? (stable ? 'IDENTICAL' : 'DIFFERS') : again.kind
    }  injected paths: ${injected.length}${
      again.kind === 'rejected'
        ? `\n   -> ${redact(again.message, config).replace(/\s+/g, ' ').slice(0, 160)}`
        : ''
    }`,
  );
}

// Paths absent from every input but present in some output, most widespread first.
const catalogue = [...injectedEverywhere.entries()]
  .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
  .map(([p, where]) => `| \`${p}\` | ${where.size}/${corpus.length} | ${[...where][0]} |`);

await writeFile(
  path.join(OUT_DIR, 'survey.md'),
  [
    '# E03-S05-T01 — normalizer survey (live)',
    '',
    'Generated by `node scripts/normalizer-survey.ts` against the ten corpus pairs.',
    '',
    '## 1. Is `finalYaml` a fixpoint?',
    '',
    `Re-submitting each committed golden as \`yamlOverride\`: **${fixpoints}/${corpus.length}** came`,
    `back byte-identical. Undoing the one output-only shape (\`trigger:/pr: {enabled: false}\` →`,
    `\`none\`) makes **${moduloFixpoints}** of the remaining ${corpus.length - fixpoints} identical too —`,
    'i.e. the expansion is a fixpoint *modulo that single rewrite*.',
    '',
    '| Entry | preview(finalYaml) | …with `enabled: false` undone | injected key paths |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## 2. Key paths present in the expansion and absent from the authored input',
    '',
    'Structural paths only (`a.b[].c`), so template-generated content is included — this is a',
    'catalogue to read, not a rule list; the rules it motivates live in `research/E03-normalizer.md`.',
    '',
    '| Path | entries | first seen in |',
    '|---|---|---|',
    ...catalogue,
    '',
  ].join('\n'),
  'utf8',
);
console.log(
  `\nfixpoints: ${fixpoints}/${corpus.length}; +${moduloFixpoints} once the disable form is undone` +
    ` -> ${path.join(OUT_DIR, 'survey.md')}`,
);
