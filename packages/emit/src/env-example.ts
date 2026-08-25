// E05-S02-T01 — the `.env.example` synthesizer.
//
// Spec: docs/04 §10 — one entry per unresolved input, each with a provenance comment, in a fixed
// section order. The entries are fed by E04-S02-T02's classifier (`env-required` and `group-member`)
// plus the runtime parameters the pipeline declares. This is internal spec, not Azure DevOps
// behavior: the agent has no `.env` file, so the layout is ours (recorded in docs/06 §5 decision 63).
//
// The one thing that *is* grounded is the `SYSTEM_ACCESSTOKEN` minting note: Azure DevOps' Entra
// resource identifier is `499b84ac-1321-427f-aa17-267ca6975798` (C-E00-011), which the note cites so
// a user minting an OAuth token knows the resource, and the PAT route is the org-scoped personal
// access token (C-E00-011).
import {
  classifyVariables,
  predefinedNames,
  type ClassifiedVariable,
  type ManifestEnvEntry,
  type Pipeline,
} from '@azdo-emu/engine';

/** One exact `.env` spelling → variable-store name mapping emitted beside `run.sh`. */
export interface EnvAlias {
  readonly name: string;
  readonly variable: string;
}

/** The generated `.env.example` plus its masking metadata and exact variable-name aliases. */
export interface EnvExampleResult {
  readonly content: string;
  readonly manifestEnv: readonly ManifestEnvEntry[];
  readonly envAliases: readonly EnvAlias[];
}

const SECTION_RULE = '# ─────────────────────────────────────────────────────────────────';

/** `# used by <stage>/<job>/<step-ordinal> (macro in <input|env>)` — the provenance comment. */
function provenanceComment(variable: ClassifiedVariable): string {
  const first = variable.references[0];
  /* istanbul ignore next -- a classified variable always carries ≥1 reference (grouped from non-empty lists). */
  if (first === undefined) return '# (no provenance recorded)';
  const where = first.via === 'input' ? 'macro in input' : 'macro in env';
  return `# used by ${first.stageId}/${first.jobId}/step ${first.stepId} (${where})`;
}

/**
 * A Bash-assignment-safe base spelling. This is deliberately stricter than the agent's public-env
 * transform (`azdo__env_name` preserves hyphens, C-E06-011/012): `.env` is sourced as Bash and
 * cannot carry those names. The exact original survives in `EnvAlias` (decision 67).
 */
function envName(name: string): string {
  const safe = name.replaceAll(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  return /^[a-zA-Z_]/.test(safe) ? safe : `AZDO_${safe}`;
}

/** Allocate one deterministic env spelling, reusing an existing alias for the same variable. */
function aliasFor(variable: string, aliases: EnvAlias[]): string {
  const existing = aliases.find((alias) => alias.variable.toLowerCase() === variable.toLowerCase());
  if (existing !== undefined) return existing.name;

  const base = envName(variable);
  const used = new Set(aliases.map((alias) => alias.name.toLowerCase()));
  let name = base;
  let suffix = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base}__${suffix}`;
    suffix += 1;
  }
  aliases.push({ name, variable });
  return name;
}

/** One `.env` entry plus the exact variable name that value must enter the runtime store under. */
function entry(
  variable: string,
  comments: readonly string[],
  aliases: EnvAlias[],
  value = '',
): string[] {
  const name = aliasFor(variable, aliases);
  return [...comments, `${name}=${value}`];
}

export function synthesizeEnvExample(pipeline: Pipeline): EnvExampleResult {
  const classification = classifyVariables(pipeline, { predefined: predefinedNames() });
  const sections: string[][] = [];
  const manifestEnv: ManifestEnvEntry[] = [];
  const envAliases: EnvAlias[] = [];

  // 1. Run identity overrides — optional, for simulating triggers (docs/04 §10).
  const runIdentity: string[] = [
    SECTION_RULE,
    '# 1. Run identity overrides (optional — simulate a trigger)',
  ];
  for (const variable of [
    'Build.SourceBranch',
    'Build.Reason',
    'System.PullRequest.SourceBranch',
    'System.PullRequest.TargetBranch',
  ]) {
    const name = aliasFor(variable, envAliases);
    runIdentity.push(...entry(variable, [`# ${name} — e.g. refs/heads/main`], envAliases));
  }
  sections.push(runIdentity);

  // 2. SYSTEM_ACCESSTOKEN — for steps that call the ADO REST API or package feeds.
  const accessToken = [
    SECTION_RULE,
    '# 2. SYSTEM_ACCESSTOKEN — needed by steps that call the ADO REST API or package feeds',
    '# Mint an org-scoped PAT, or use device-code OAuth against the Entra resource',
    '# 499b84ac-1321-427f-aa17-267ca6975798 (C-E00-011).',
  ];
  accessToken.push(...entry('System.AccessToken', [], envAliases));
  sections.push(accessToken);
  manifestEnv.push({ name: 'SYSTEM_ACCESSTOKEN', secret: true, origin: 'ADO REST / feeds access' });

  // 3. Unresolved pipeline variables — the user must supply these (C-E04-089).
  const envRequired = [...classification.variables.values()].filter(
    (v) => v.classification === 'env-required',
  );
  if (envRequired.length > 0) {
    const section: string[] = [
      SECTION_RULE,
      '# 3. Pipeline variables (unresolved — fill in a value)',
    ];
    for (const variable of envRequired) {
      section.push(...entry(variable.name, [provenanceComment(variable)], envAliases));
    }
    sections.push(section);
  }

  // 4. Variable groups — names only, never values (PLAN D7).
  const groupMembers = [...classification.variables.values()].filter(
    (v) => v.classification === 'group-member',
  );
  if (groupMembers.length > 0) {
    const section: string[] = [
      SECTION_RULE,
      '# 4. Variable groups — names only; values are never fetched (PLAN D7)',
    ];
    for (const variable of groupMembers) {
      const groups = variable.groups?.map((g) => `'${g}'`).join(', ') ?? 'unknown group';
      section.push(...entry(variable.name, [`# from group ${groups}`], envAliases));
    }
    sections.push(section);
  }

  // 5. Runtime parameters — passed through, prefilled with defaults.
  const parameters = Object.entries(pipeline.parameters);
  if (parameters.length > 0) {
    const section: string[] = [SECTION_RULE, '# 5. Runtime parameters (prefilled with defaults)'];
    for (const [name, defaultValue] of parameters) {
      section.push(...entry(name, [`# runtime parameter '${name}'`], envAliases, defaultValue));
    }
    sections.push(section);
  }

  // 6. Service connections & secure files are E08's; nothing to emit until then.
  sections.push([
    SECTION_RULE,
    '# 6. Service connections and secure files are populated once E08 lands.',
  ]);

  const header = [
    '# Generated .env.example — copy to .env and fill in values.',
    '#',
    '# This is a trusted Bash assignment file: `NAME=value`, one per line; names are',
    '# letters/digits/underscores and cannot begin with a digit (C-E06-014).',
    '',
  ];

  const content = [...header, ...sections.flatMap((s) => [...s, ''])].join('\n');
  return { content, manifestEnv, envAliases };
}
