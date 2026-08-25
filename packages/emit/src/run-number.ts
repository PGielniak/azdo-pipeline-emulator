// E05-S03-T01 — the run-number (`name:`) formatter.
//
// The pipeline's `name:` is a format string, not a name: Azure DevOps renders it at queue time into
// `Build.BuildNumber` (C-E05-003). It carries tokens that resolve **only** here and nowhere else in
// a pipeline (C-E05-004), so this is a small language of its own rather than a reuse of the macro
// expander.
//
// Two halves, split where the information is:
//   - **Parsing is compile-time** (`parseRunNumberFormat`): the token list is fixed and knowable
//     from the format string alone, so the emitter does it once and emits straight-line bash.
//   - **Evaluation is run time** (`emitRunNumberInit`): `Date:`/`Rev`/variable tokens all depend on
//     when the run starts and on what `.env` supplied, so the emitted snippet runs inside `run.sh`
//     after `azdo_env_load` and before the first stage.
//
// Grounded in the run-number page (deep-verified 2026-08-25, `research/E05-emitter.md`):
//   - the token table and its example values, C-E05-005;
//   - the standalone numeric tokens are **unpadded** while `Date:` tokens are padded, C-E05-006;
//   - `Rev` resets to 1 when any other part of the number changes, C-E05-009/010 — which is why the
//     emitted code renders everything *except* the revision first and hands that string to
//     `azdo_rev` as the key;
//   - additional `r`s zero-pad, C-E05-011;
//   - times are UTC, C-E05-013 — every `date` call is `date -u`.
//
// What is deliberately *not* implemented, each recorded as a delta claim rather than guessed:
// `$(Rev:.r)` and every other undocumented `Rev:` spelling (C-E05-025), and `Date:` specifiers
// outside the mapped subset (C-E05-024). Both become conversion warnings and render literally.
import type { ManifestWarning } from '@azdo-emu/engine';

import { shQuote } from './entrypoints.js';

/** The default format a pipeline with no `name:` gets (C-E05-001). */
export const DEFAULT_RUN_NUMBER_FORMAT = '$(Date:yyyyMMdd).$(Rev:r)';

/**
 * The .NET custom date/time specifiers the page actually documents, mapped to `date -u` conversions.
 *
 * The page gives a grammar for none of this — only two examples, `yyyyMMdd` and `MMddyy`
 * (C-E05-001/007) — so the map covers exactly what those examples plus a time-of-day need, and
 * anything else is a warning rather than an invention (C-E05-024). Longest-first, so `yyyy` is
 * matched before `yy`.
 */
const DATE_SPECIFIERS: readonly (readonly [string, string])[] = [
  ['yyyy', '%Y'],
  ['yy', '%y'],
  ['MM', '%m'],
  ['dd', '%d'],
  ['HH', '%H'],
  ['mm', '%M'],
  ['ss', '%S'],
];

/** The standalone numeric tokens: `date -u` conversion + whether the padding must be stripped. */
const NUMERIC_TOKENS: Readonly<Record<string, string>> = {
  dayofmonth: '%d',
  dayofyear: '%j',
  hours: '%H',
  minutes: '%M',
  month: '%m',
  seconds: '%S',
};

/** Run-number-only aliases for variables the store already holds (C-E05-005). */
const TOKEN_ALIASES: Readonly<Record<string, string>> = {
  sourcebranchname: 'Build.SourceBranchName',
  teamproject: 'System.TeamProject',
};

export type RunNumberToken =
  /** Text outside any `$( )`, and any token rendered literally because it was not understood. */
  | { readonly kind: 'literal'; readonly text: string }
  /** `$(Date:…)` and `$(Year:yy|yyyy)` — a `date -u` format string. */
  | { readonly kind: 'date'; readonly format: string }
  /** A standalone numeric token whose leading zeros are stripped (C-E05-006). */
  | { readonly kind: 'number'; readonly conversion: string }
  /** `$(Rev:r…)` — `width` is the number of `r`s, i.e. the zero-padding (C-E05-011). */
  | { readonly kind: 'rev'; readonly width: number }
  /** Anything else: a predefined or user-defined variable read (C-E05-012). */
  | { readonly kind: 'variable'; readonly name: string };

export interface ParsedRunNumber {
  readonly tokens: readonly RunNumberToken[];
  readonly warnings: readonly ManifestWarning[];
}

/** Translate a .NET date format into a `date -u` format, or report the specifier that defeated it. */
function translateDateFormat(format: string): { output?: string; unmapped?: string } {
  let out = '';
  let i = 0;
  outer: while (i < format.length) {
    for (const [specifier, conversion] of DATE_SPECIFIERS) {
      if (format.startsWith(specifier, i)) {
        out += conversion;
        i += specifier.length;
        continue outer;
      }
    }
    const char = format[i]!;
    // A letter outside the mapped set is a specifier we refuse to guess at (C-E05-024); anything
    // else (a dash, a dot, a slash) is literal text in .NET custom formats too.
    if (/[a-zA-Z]/.test(char)) return { unmapped: char };
    out += char === '%' ? '%%' : char;
    i += 1;
  }
  return { output: out };
}

/**
 * Parse a `name:` format into its tokens (C-E05-005), collecting a warning for every construct the
 * run-number page does not document.
 */
export function parseRunNumberFormat(
  format: string,
  file = 'pipeline.expanded.yml',
): ParsedRunNumber {
  const tokens: RunNumberToken[] = [];
  const warnings: ManifestWarning[] = [];
  const push = (token: RunNumberToken): void => {
    const last = tokens[tokens.length - 1];
    if (token.kind === 'literal' && last?.kind === 'literal') {
      tokens[tokens.length - 1] = { kind: 'literal', text: last.text + token.text };
      return;
    }
    tokens.push(token);
  };
  const warn = (code: string, message: string, text: string): void => {
    warnings.push({ code, message, location: { file, line: 1 } });
    push({ kind: 'literal', text });
  };

  let i = 0;
  while (i < format.length) {
    const open = format.indexOf('$(', i);
    if (open === -1) {
      push({ kind: 'literal', text: format.slice(i) });
      break;
    }
    if (open > i) push({ kind: 'literal', text: format.slice(i, open) });
    const close = format.indexOf(')', open + 2);
    if (close === -1) {
      // An unterminated `$(` is text, not a token — the service has no way to resolve it either.
      push({ kind: 'literal', text: format.slice(open) });
      break;
    }

    const raw = format.slice(open + 2, close);
    const whole = format.slice(open, close + 1);
    i = close + 1;
    const colon = raw.indexOf(':');
    const head = (colon === -1 ? raw : raw.slice(0, colon)).trim();
    const arg = colon === -1 ? undefined : raw.slice(colon + 1);
    const key = head.toLowerCase();

    if (key === 'rev') {
      // Only one-or-more `r` is documented (C-E05-011); `$(Rev:.r)` and friends are not (C-E05-025).
      if (arg !== undefined && /^r+$/.test(arg)) push({ kind: 'rev', width: arg.length });
      else
        warn(
          'E05-RUN-NUMBER-REV',
          `run number: '${whole}' is not a documented \`Rev\` spelling (only \`$(Rev:r)\`, \`$(Rev:rr)\`, … are); rendered literally`,
          whole,
        );
      continue;
    }

    if (key === 'date' || key === 'year') {
      const requested = arg ?? (key === 'year' ? 'yyyy' : 'yyyyMMdd');
      const translated = translateDateFormat(requested);
      if (translated.output === undefined)
        warn(
          'E05-RUN-NUMBER-DATE',
          `run number: date format '${requested}' uses the specifier '${translated.unmapped}', which is outside the documented subset (yyyy, yy, MM, dd, HH, mm, ss); rendered literally`,
          whole,
        );
      else push({ kind: 'date', format: translated.output });
      continue;
    }

    const numeric = NUMERIC_TOKENS[key];
    if (numeric !== undefined && arg === undefined) {
      push({ kind: 'number', conversion: numeric });
      continue;
    }

    // Everything else is a variable read: the run-number-only aliases first (C-E05-005), then any
    // predefined or user-defined name (C-E05-012).
    push({ kind: 'variable', name: TOKEN_ALIASES[key] ?? head });
  }

  return { tokens, warnings };
}

/** The bash word each token renders to. `rev` has none — it is spliced in by the emitted code. */
function tokenWord(token: RunNumberToken): string {
  switch (token.kind) {
    case 'literal':
      return shQuote(token.text);
    case 'date':
      // UTC, always (C-E05-013).
      return `"$(date -u +${shQuote(token.format)})"`;
    case 'number':
      // `10#` so `08`/`09` are decimal, not invalid octal; the strip is C-E05-006/023.
      return `"$((10#$(date -u +${shQuote(token.conversion)})))"`;
    case 'variable':
      return `"$(azdo_var ${shQuote(token.name)})"`;
    /* istanbul ignore next -- `rev` is filtered out before this is reached. */
    case 'rev':
      return '';
  }
}

/**
 * Emit the run-number initialization for `run.sh`: the lines that compute `Build.BuildNumber` and
 * seed `Build.BuildId`.
 *
 * Placement matters and is not free: this must run **after** `azdo_env_load` (the format may read
 * user-defined variables and `.env`-supplied run identity, C-E05-012) and **before** the first
 * stage, which is what makes `Build.BuildNumber` readable by the first step.
 *
 * The revision is computed in two passes because the reset rule is defined in terms of the rest of
 * the number (C-E05-009/010): everything except the revision is rendered first and handed to
 * `azdo_rev` as the key, then spliced back into place.
 */
export function emitRunNumberInit(
  format: string,
  file?: string,
): {
  readonly lines: readonly string[];
  readonly warnings: readonly ManifestWarning[];
} {
  const { tokens, warnings } = parseRunNumberFormat(format, file);
  const revIndex = tokens.findIndex((t) => t.kind === 'rev');
  const rev = revIndex === -1 ? undefined : (tokens[revIndex] as { kind: 'rev'; width: number });
  const before = (revIndex === -1 ? tokens : tokens.slice(0, revIndex)).map(tokenWord);
  const after = revIndex === -1 ? [] : tokens.slice(revIndex + 1).map(tokenWord);

  const lines: string[] = [
    '# Run number (`name:`) — evaluated once per run, before the first stage (E05-S03-T01).',
    'export AZDO_PERSIST_DIR="$WORK_DIR/.state"',
    // `Build.SourceBranchName` is otherwise seeded by `checkout`, which has not run yet; the format
    // may read it (C-E05-005), and decision 67 maps `.env`'s `BUILD_SOURCEBRANCH` spelling back to
    // the exact `Build.SourceBranch` store name before this runs.
    'azdo_seed_branch_name',
    `azdo__run_number_head=(${before.join(' ')})`,
  ];
  if (rev === undefined) {
    lines.push(
      'azdo_build_number="$(azdo__join_parts "${azdo__run_number_head[@]+"${azdo__run_number_head[@]}"}")"',
    );
  } else {
    lines.push(
      `azdo__run_number_tail=(${after.join(' ')})`,
      'azdo__run_number_key="$(azdo__join_parts "${azdo__run_number_head[@]+"${azdo__run_number_head[@]}"}" "${azdo__run_number_tail[@]+"${azdo__run_number_tail[@]}"}")"',
      `azdo__run_number_rev="$(azdo_rev "$azdo__run_number_key" ${rev.width})"`,
      'azdo_build_number="$(azdo__join_parts "${azdo__run_number_head[@]+"${azdo__run_number_head[@]}"}" "$azdo__run_number_rev" "${azdo__run_number_tail[@]+"${azdo__run_number_tail[@]}"}")"',
    );
  }
  lines.push(
    // Seed once in the pipeline scope. Each generated job copies that scope with its complete
    // metadata before applying job-local values (C-E05-017, decision 68).
    // `Build.BuildId` is the local monotonic run counter, not an org-unique Run ID (C-E05-022).
    'azdo_run_identity_seed "$azdo_build_number" "$run_number"',
    '',
  );
  return { lines, warnings };
}
