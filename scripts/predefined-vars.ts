// E04-S02-T03 — generate `packages/engine/data/predefined-vars.json` from the docs.
//
// **The source is the docs repository, not the rendered page.** `learn.microsoft.com` renders the
// table through an `[!INCLUDE]`, so the rendered HTML has no stable identity to pin: it changes when
// the site's templates change, and it cannot be fetched at a version. The markdown behind it can —
// `MicrosoftDocs/azure-devops-docs` is public, and the include is fetched at an explicit commit, so
// re-running this script at the same pin produces the same bytes. That is what makes the task's
// "scraper re-run produces stable output" criterion meaningful rather than a hope about a web page.
//
// Two pins are needed, and that is the doc's structure rather than an accident: the page
// (`docs/pipelines/build/variables.md`) supplies the prose and the section anchors, while the table
// itself lives in `docs/pipelines/build/includes/variables-hosted.md`.
//
// Run:  pnpm predefined-vars            (regenerate at the pinned commits)
//       pnpm predefined-vars --latest   (repin to the current tip, then regenerate)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

/** The include that holds the table, pinned. `--latest` rewrites this line's value at repin time. */
const PINNED_INCLUDE_COMMIT = '8e41b654da0437cb473ea1c78cf3df6a36289237';
/** The page itself, pinned separately: it carries two variables the include's table does not. */
const PINNED_PAGE_COMMIT = '1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32';
const REPO = 'MicrosoftDocs/azure-devops-docs';
const INCLUDE_PATH = 'docs/pipelines/build/includes/variables-hosted.md';
const PAGE_PATH = 'docs/pipelines/build/variables.md';
/** Anchor base for every row's doc link — the *page*, not the include, which has no rendered URL. */
const DOC_URL = 'https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables';

const OUT = path.join('packages', 'engine', 'data', 'predefined-vars.json');

interface PredefinedVariable {
  readonly name: string;
  /** Section the row appeared under, e.g. `Agent variables`. */
  readonly section: string;
  /** Anchor on the rendered page, so a reader can jump to the row's own table. */
  readonly anchor: string;
  /** First sentence of the doc's description, plain text. */
  readonly description: string;
  /**
   * The two exceptions the page names: everything else is read-only.
   *
   * "These variables are automatically set by the system and read-only. (The exceptions are
   * Build.Clean and System.Debug.)" — so these two are the only predefined names a pipeline may
   * legitimately set, and a classifier seeing one on the left of an assignment should not warn.
   */
  readonly writable?: true;
}

function gh(args: readonly string[]): string {
  return execFileSync('gh', [...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function fetchFile(filePath: string, commit: string): string {
  const encoded = gh([
    'api',
    `repos/${REPO}/contents/${filePath}?ref=${commit}`,
    '--jq',
    '.content',
  ]);
  return Buffer.from(encoded.replaceAll('\n', ''), 'base64').toString('utf8');
}

/**
 * The two variables the page documents in their own `## Name` sections rather than in the table.
 *
 * They are there *because* they are the exceptions to "automatically set … and read-only", so
 * dropping them would lose both the names (docs/01 §5 requires `System.Debug`) and the one
 * semantic distinction the page draws between predefined variables.
 */
export function parsePageSections(markdown: string): readonly PredefinedVariable[] {
  const rows: PredefinedVariable[] = [];
  const sections = markdown.split(/^## /m).slice(1);
  for (const section of sections) {
    const heading = (section.split('\n')[0] ?? '').trim();
    if (!/^[A-Za-z][\w]*(\.[\w]+)+$/.test(heading)) continue;
    const body = section.slice(heading.length).split(/^## /m)[0] ?? '';
    const prose = body
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith(':::') && !line.startsWith('['))
      .join(' ');
    rows.push({
      name: heading,
      section: 'Page sections',
      anchor: `${DOC_URL}#${heading.toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
      description: firstSentence(plainText(prose)),
      writable: true,
    });
  }
  return rows;
}

function latestCommit(): string {
  return gh([
    'api',
    `repos/${REPO}/commits?path=${INCLUDE_PATH}&per_page=1`,
    '--jq',
    '.[0].sha',
  ]).trim();
}

/** `## Agent variables (DevOps Services)` → `Agent variables`, and its rendered anchor. */
function sectionOf(heading: string): { section: string; anchor: string } {
  const title = heading.replace(/^#+\s*/, '').trim();
  // Learn drops a parenthesised qualifier from the visible title but keeps it in the anchor, so the
  // anchor is derived from the full heading and the section name from the trimmed one.
  const section = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const anchor = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return { section, anchor };
}

/** Strip the doc's inline markup so a description is readable in a JSON file and in a warning. */
function plainText(markdown: string): string {
  return markdown
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First sentence, so the table stays a lookup rather than a copy of the page. */
function firstSentence(text: string): string {
  const match = /^(.*?[.!?])(\s|$)/.exec(text);
  return (match?.[1] ?? text).trim();
}

export function parseVariables(markdown: string): readonly PredefinedVariable[] {
  const rows: PredefinedVariable[] = [];
  const seen = new Set<string>();
  let current = { section: 'Unknown', anchor: '' };

  for (const line of markdown.split('\n')) {
    if (line.startsWith('#')) {
      current = sectionOf(line);
      continue;
    }
    if (!line.startsWith('|')) continue;

    const cells = line.split('|').slice(1, -1);
    if (cells.length < 2) continue;
    const name = plainText(cells[0] ?? '');
    // Header and separator rows.
    if (name === '' || name === 'Variable' || /^:?-+:?$/.test((cells[0] ?? '').trim())) continue;
    // A predefined variable is always `Namespace.Name`; anything else in the first cell is prose.
    if (!/^[A-Za-z][\w]*(\.[\w*]+)+$/.test(name)) continue;

    const folded = name.toLowerCase();
    // The page repeats a few names across sections; the first occurrence wins, which keeps the
    // output stable when a later section restates a row.
    if (seen.has(folded)) continue;
    seen.add(folded);

    rows.push({
      name,
      section: current.section,
      anchor: `${DOC_URL}#${current.anchor}`,
      description: firstSentence(plainText(cells[1] ?? '')),
    });
  }

  // Sorted by folded name: the doc's order is per-section and would reshuffle whenever a section
  // moves, which would make every regeneration a large diff for no semantic change.
  return rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

const repin = process.argv.includes('--latest');
const commit = repin ? latestCommit() : PINNED_INCLUDE_COMMIT;
if (repin && commit !== PINNED_INCLUDE_COMMIT) {
  console.log(`repin: ${PINNED_INCLUDE_COMMIT} -> ${commit}`);
  console.log('update PINNED_INCLUDE_COMMIT in this script and re-run without --latest');
}

// The include's table plus the page's own two sections, merged and re-sorted so the file has one
// order regardless of where a row came from.
const variables = [
  ...parseVariables(fetchFile(INCLUDE_PATH, commit)),
  ...parsePageSections(fetchFile(PAGE_PATH, PINNED_PAGE_COMMIT)),
].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: {
        repo: REPO,
        path: INCLUDE_PATH,
        commit,
        pagePath: PAGE_PATH,
        pageCommit: PINNED_PAGE_COMMIT,
        page: DOC_URL,
        generatedBy: 'pnpm predefined-vars',
      },
      variables,
    },
    undefined,
    2,
  ) + '\n',
  'utf8',
);
console.log(`${OUT}: ${variables.length} variables from ${REPO}@${commit.slice(0, 8)}`);
