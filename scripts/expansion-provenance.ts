// E03-S04-T02 — the expansion spot-check tool.
//
// "Where did this line come from?" — the question the provenance map exists to answer, asked from
// a terminal instead of from a test. Offline expansion is the fallback path (PLAN D3), so this is
// a repo-local tool in the survey-script idiom rather than a `azdo-emu` subcommand; the real CLI
// surface is E10's.
//
// It imports the **built** engine rather than its sources: the engine's internal imports carry the
// TypeScript `.js` specifiers, which Node's type stripping does not remap, so `pnpm
// expansion-provenance` builds the package first. Every other survey script only reaches into
// `packages/fetch`, which has no such chain, which is why this is the first one that needs it.
//
//   pnpm expansion-provenance <pipeline.yml> [line]
//
// With no line it prints the expanded YAML with a `file:line` gutter — every emitted line beside
// where it came from. With a line it prints that one line's source stack, which is the form a
// human uses when the service rejected something and they need to know which template wrote it.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  expandDocument,
  provenanceAtLine,
  type ExpansionMap,
} from '../packages/engine/dist/index.js';

function usage(): never {
  process.stderr.write(
    'usage: pnpm expansion-provenance <pipeline.yml> [line]\n' +
      '       pnpm expansion-provenance <pipeline.yml> --map <out.json>\n',
  );
  process.exit(2);
}

/** `file:line:col` plus the frame's depth and parameter hash when they say something. */
function describe(map: ExpansionMap, line: number): string {
  const entry = provenanceAtLine(map, line);
  if (entry === undefined) return '(no node starts on this line)';
  const { from } = entry;
  const extra = [
    from.depth > 0 ? `depth ${from.depth}` : undefined,
    from.repo,
    from.parameters === undefined ? undefined : `params ${from.parameters}`,
  ].filter((part): part is string => part !== undefined);
  const suffix = extra.length > 0 ? `  [${extra.join(' · ')}]` : '';
  return `${from.file}:${from.line}:${from.col}${suffix}  ${entry.path || '/'}`;
}

const [, , file, second, third] = process.argv;
if (file === undefined) usage();

const source = readFileSync(file, 'utf8');
const result = expandDocument(source, path.basename(file));

for (const diagnostic of result.diagnostics) {
  process.stderr.write(`${diagnostic.file}: ${diagnostic.message}\n`);
}

if (second === '--map') {
  if (third === undefined) usage();
  writeFileSync(third, `${JSON.stringify(result.map, undefined, 2)}\n`);
  process.stdout.write(`wrote ${result.map.entries.length} entries to ${third}\n`);
} else if (second !== undefined) {
  const line = Number(second);
  if (!Number.isInteger(line) || line < 1) usage();
  const text = result.yaml.split('\n')[line - 1] ?? '';
  process.stdout.write(`${line}: ${text}\n    from ${describe(result.map, line)}\n`);
} else {
  const lines = result.yaml.split('\n');
  const width = Math.max(...result.map.entries.map((e) => `${e.from.file}:${e.from.line}`.length));
  lines.forEach((text, index) => {
    const entry = provenanceAtLine(result.map, index + 1);
    const origin = entry === undefined ? '' : `${entry.from.file}:${entry.from.line}`;
    process.stdout.write(`${origin.padEnd(width)} │ ${text}\n`);
  });
}

if (result.diagnostics.length > 0) process.exit(1);
