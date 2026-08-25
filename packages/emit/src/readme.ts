// E05-S02-T02 — the generated project's `README.md` and its ranked warnings report (docs/04 §12).
//
// This module renders, it does not decide: every claim in the README comes from the manifest
// (docs/04 §11) or from the scaffold plan (E05-S01-T01), which is what "content assembled only from
// manifest data (no free text at emit time)" means — the prose here is a fixed legend, identical for
// every conversion, and nothing about *this* pipeline is written by hand at emit time.
//
// Two things are deliberately absent, and both are decisions already made:
//   - **No coverage percentage and no tier histogram** (PLAN D10 revised, docs/04 §13's banner).
//     What survives the dropped metric is the per-step fidelity *label* and the **ranked**
//     warnings/unsupported list, which inherits §13's gap-list shape — location, task, tier, reason,
//     remediation — minus the arithmetic. A "N exact · N degraded · N stub" line is the histogram
//     wearing a different hat, so the summary counts structure (stages/jobs/steps) and warnings only.
//   - **No per-task prose.** The remediation column is keyed by fidelity tier from a fixed table
//     (`REMEDIATION`), so it stays a legend rather than an emit-time judgement about a task.
//
// The fidelity label falls back to `defaultFidelity()` — the same function the step header prints —
// whenever the manifest has none, which today is always: `Step.fidelity` is declared on the model but
// nothing assigns it until E07-S03-T01. That fallback is what keeps the README table and the emitted
// `.sh` headers in agreement, and it means E07 can populate the manifest with no change here.
//
// Section order and the ranking rule are internal spec, recorded in docs/06 §5 decision 64.
import type {
  SerializedManifest,
  ManifestExpansion,
  ManifestWarning,
  Step,
} from '@azdo-emu/engine';

import { originStepLabel, type Scaffold, type ScaffoldStep } from './scaffold.js';
import { defaultFidelity } from './step.js';

/** The fidelity tiers, most faithful first (PLAN §6). */
export type FidelityTier = 'exact' | 'equivalent' | 'degraded' | 'stub' | 'unsupported';

/** Ranking weight: a bigger number is a worse gap, and sorts earlier in the warnings report. */
const SEVERITY: Readonly<Record<FidelityTier, number>> = {
  exact: 0,
  equivalent: 1,
  degraded: 2,
  stub: 3,
  unsupported: 4,
};

/** What each tier means — the legend the step headers point at with "see README §fidelity". */
const TIER_MEANING: Readonly<Record<FidelityTier, string>> = {
  exact: 'runs verbatim — the same bytes the agent would have run.',
  equivalent: 'different implementation, same observable effect.',
  degraded: 'runs, but some behavior is approximated on this host.',
  stub: 'does not run the real task — the script records the resolved inputs and exits.',
  unsupported: 'has no local equivalent; the step cannot be reproduced here.',
};

/** Tier-keyed remediation. A fixed table, so no per-pipeline prose is written at emit time. */
const REMEDIATION: Readonly<Record<FidelityTier, string>> = {
  exact: 'No action needed.',
  equivalent: 'No action needed; expect the effect, not the implementation.',
  degraded:
    'Install the tool the step needs and re-run; `azdo-emu doctor` reports what is missing.',
  stub: 'Supply a handler for this task or run the step by hand; `azdo-emu doctor` lists the gaps.',
  unsupported: 'Remove or replace this step for local runs — there is nothing to fall back to.',
};

/** One row of the ranked warnings report. */
export interface WarningEntry {
  /** Sort key; conversion-level entries outrank every per-step one. */
  readonly severity: number;
  /** Project-relative script path, or the source file for a conversion-level warning. */
  readonly where: string;
  readonly task: string;
  readonly tier: FidelityTier | undefined;
  readonly reason: string;
  readonly remediation: string;
}

/** The fidelity label for a step: the manifest's if assigned, otherwise the per-kind default. */
export function stepFidelity(step: Step): FidelityTier {
  return step.fidelity ?? defaultFidelity(step);
}

/** `1 stage` / `2 stages` — the README is read by people, so the counts read like English. */
function plural(count: number, noun: string, suffix = 's'): string {
  return `${count} ${noun}${count === 1 ? '' : suffix}`;
}

/** Escape a value for a markdown table cell (`|` would otherwise start a new column). */
function cell(text: string): string {
  return text.replaceAll('|', '\\|');
}

/** `` `x` `` — a code span, with an empty value rendered as an em dash rather than an empty span. */
function code(text: string | undefined): string {
  return text === undefined || text === '' ? '—' : `\`${cell(text)}\``;
}

/** The label the step tables show in the "Task" column: `checkout`/`publish`/`download` keep theirs. */
function taskLabel(step: Step): string {
  return originStepLabel(step) ?? `${step.task.name}@${step.task.version}`;
}

/** How the pipeline was expanded — a fidelity fact, so it sits in the summary (E12-S01-T01). */
function expansionLine(expansion: ManifestExpansion): string {
  if (expansion.mode === 'offline') {
    return (
      '**offline** — expanded by the local compile-time engine (`--offline-expand`), not by Azure ' +
      'DevOps. Template and `${{ }}` results are an approximation; re-convert online for a faithful tree.'
    );
  }
  const cached = expansion.fromCache ? 'from cache' : 'fresh';
  return `**service** — expanded by Azure DevOps (pipeline \`${expansion.pipelineId}\`, api-version \`${expansion.apiVersion}\`, ${cached}).`;
}

/** Flatten the scaffold into one row per emitted step script, in project order. */
function scaffoldSteps(
  plan: Scaffold,
): { stage: string; job: string; entry: ScaffoldStep; order: number }[] {
  const rows: { stage: string; job: string; entry: ScaffoldStep; order: number }[] = [];
  let order = 0;
  for (const stage of plan.stages) {
    for (const job of stage.jobs) {
      for (const entry of job.steps) {
        rows.push({ stage: stage.stage.id, job: job.job.referenceName, entry, order: order++ });
      }
    }
  }
  return rows;
}

/**
 * The ranked warnings report (docs/04 §13's gap-list shape, minus the arithmetic).
 *
 * Ranking, in order: conversion-level warnings first (they can invalidate the whole tree), then
 * per-step entries by fidelity severity descending, then project order — so the same pipeline always
 * produces the same list, and the worst gap is always the first thing read.
 *
 * A step earns an entry when it carries a convert-time warning **or** when its tier is `degraded` or
 * worse; `exact`/`equivalent` steps with nothing to say stay out of the list and are visible in the
 * per-stage tables instead.
 */
export function rankWarnings(
  manifest: SerializedManifest,
  plan: Scaffold,
): readonly WarningEntry[] {
  const conversion: WarningEntry[] = manifest.warnings.map((warning: ManifestWarning) => ({
    severity: Number.POSITIVE_INFINITY,
    where:
      warning.location === undefined
        ? '(conversion)'
        : `${warning.location.file}:${warning.location.line}`,
    task: warning.code,
    tier: undefined,
    reason: warning.message,
    remediation: 'Convert-time warning — see the message.',
  }));

  const perStep: { entry: WarningEntry; order: number }[] = [];
  for (const row of scaffoldSteps(plan)) {
    const step = row.entry.step;
    const tier = stepFidelity(step);
    const severity = SEVERITY[tier];
    const reasons = step.warnings.length > 0 ? step.warnings : [TIER_MEANING[tier]];
    if (step.warnings.length === 0 && severity < SEVERITY.degraded) continue;
    for (const reason of reasons) {
      perStep.push({
        order: row.order,
        entry: {
          severity,
          where: row.entry.path,
          task: taskLabel(step),
          tier,
          reason,
          remediation: REMEDIATION[tier],
        },
      });
    }
  }
  perStep.sort((a, b) => b.entry.severity - a.entry.severity || a.order - b.order);
  return [...conversion, ...perStep.map((p) => p.entry)];
}

/** Every relative link target the README references — the input to the broken-link check. */
export function extractLinks(markdown: string): readonly string[] {
  const links: string[] = [];
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    links.push(target);
  }
  return links;
}

function summarySection(manifest: SerializedManifest, plan: Scaffold): string[] {
  const jobs = plan.stages.reduce((n, stage) => n + stage.jobs.length, 0);
  const steps = scaffoldSteps(plan).length;
  const warnings = rankWarnings(manifest, plan).length;
  const lines = [
    `# ${manifest.pipeline.name ?? 'Converted Azure DevOps pipeline'}`,
    '',
    'A local, dependency-free bash rendering of an Azure DevOps pipeline, generated by `azdo-emu`.',
    'Every stage, job and step below is a script you can read, edit, and run on its own.',
    '',
    `- **Structure:** ${plural(plan.stages.length, 'stage')}, ${plural(jobs, 'job')}, ${plural(steps, 'step script')}.`,
    `- **Expansion:** ${expansionLine(manifest.expansion)}`,
    `- **Gaps:** ${warnings === 1 ? '1 entry' : `${warnings} entries`} in [Warnings](#warnings); ${plural(manifest.unsupported.length, 'unsupported construct')}.`,
  ];
  const parameters = Object.entries(manifest.pipeline.parameters);
  if (parameters.length > 0) {
    lines.push(
      '',
      '**Baked parameters** — the values the expansion was performed with:',
      '',
      '| Parameter | Value |',
      '| --- | --- |',
      ...parameters.map(([name, value]) => `| ${code(name)} | ${code(value)} |`),
    );
  }
  return lines;
}

function quickStartSection(): string[] {
  return [
    '## Quick start',
    '',
    '```bash',
    'cp .env.example .env    # then fill it in — see “Environment” below',
    './run.sh                # run every stage, in dependency order',
    './run.sh --list         # print the stage/job/step tree with fidelity labels',
    './run.sh --env-file F   # load F instead of ./.env',
    './run.sh --resume       # reuse the previous run number and its run directory',
    '```',
    '',
    'Each run gets `.work/run-<n>/` — `logs/` per job, `state/` for results and output variables, and',
    '`workspace/` as the checkout root. Published artifacts land in `.artifacts/`.',
    '',
    'The per-stage and per-job scripts (`run-stage.sh`, `run-job.sh`) are sequenced by `run.sh` and',
    'read the environment it exports; run them directly only with that environment in place.',
    '',
    'See [.env.example](.env.example) for the values this pipeline needs.',
  ];
}

function pipelineSection(manifest: SerializedManifest, plan: Scaffold): string[] {
  const lines = ['## Pipeline', ''];
  if (plan.stages.length === 0) {
    lines.push('This pipeline has no stages.');
    return lines;
  }
  // The stage `dependsOn` shown is the manifest's **effective** list — the sequential default already
  // applied (C-E04-123) — because that is the order `run.sh` actually uses, not the authored text.
  const effectiveDependsOn = new Map(manifest.stages.map((s) => [s.id, s.dependsOn]));
  for (const stage of plan.stages) {
    const dependsOn: readonly string[] =
      effectiveDependsOn.get(stage.stage.id) ?? stage.stage.dependsOn ?? [];
    lines.push(`### Stage \`${cell(stage.stage.id)}\``, '');
    const facts = [
      `depends on: ${dependsOn.length > 0 ? dependsOn.map((d) => `\`${cell(d)}\``).join(', ') : '—'}`,
      `condition: ${code(stage.stage.condition)}`,
      `runner: [\`${stage.dir}/run-stage.sh\`](${stage.dir}/run-stage.sh)`,
    ];
    lines.push(facts.map((f) => `- ${f}`).join('\n'), '');
    for (const job of stage.jobs) {
      lines.push(
        `#### Job \`${cell(job.job.referenceName)}\`${job.job.matrixKey === undefined ? '' : ` · leg \`${cell(job.job.matrixKey)}\``} (${job.job.kind})`,
        '',
        `- depends on: ${job.job.dependsOn.length > 0 ? job.job.dependsOn.map((d) => `\`${cell(d)}\``).join(', ') : '—'}`,
        `- condition: ${code(job.job.condition)}`,
        `- runner: [\`${job.dir}/run-job.sh\`](${job.dir}/run-job.sh)`,
        '',
      );
      if (job.steps.length === 0) {
        lines.push('This job has no steps.', '');
        continue;
      }
      lines.push('| # | Step | Task | Fidelity | Script |', '| --- | --- | --- | --- | --- |');
      for (const entry of job.steps) {
        const label = entry.hook === undefined ? '' : ` _(${entry.hook})_`;
        lines.push(
          `| ${entry.number} | ${cell(entry.step.displayName)}${label} | ${code(taskLabel(entry.step))} | \`${stepFidelity(entry.step)}\` | [\`${entry.path.split('/').pop()!}\`](${entry.path}) |`,
        );
      }
      lines.push('');
    }
  }
  return lines;
}

function fidelitySection(): string[] {
  return [
    '## Fidelity',
    '',
    'Every step carries one of these labels, in its script header and in the tables above. There is',
    'no coverage percentage: a label says what *this* step does locally, which is the thing worth',
    'knowing when a run behaves differently from the service.',
    '',
    '| Label | Meaning |',
    '| --- | --- |',
    ...(Object.keys(TIER_MEANING) as FidelityTier[]).map(
      (tier) => `| \`${tier}\` | ${cell(TIER_MEANING[tier])} |`,
    ),
  ];
}

function environmentSection(manifest: SerializedManifest): string[] {
  const lines = ['## Environment', ''];
  if (manifest.env.length === 0) {
    lines.push(
      'This pipeline needs no `.env` entries beyond the optional ones in [.env.example](.env.example).',
    );
    return lines;
  }
  lines.push(
    'Copy [.env.example](.env.example) to `.env` and fill these in. `.env` is git-ignored, and values',
    'marked secret are masked in the run log the same way the service masks them.',
    '',
    '| Variable | Secret | Why it is needed |',
    '| --- | --- | --- |',
    ...manifest.env.map(
      (entry) =>
        `| ${code(entry.name)} | ${entry.secret ? 'yes' : 'no'} | ${cell(entry.origin ?? '—')} |`,
    ),
  );
  return lines;
}

function toolsSection(manifest: SerializedManifest): string[] {
  const lines = ['## Tool prerequisites', ''];
  if (manifest.tools.length === 0) {
    lines.push('None recorded. Run `azdo-emu doctor` against this project to re-check the host.');
    return lines;
  }
  lines.push(
    'These must be on `PATH` before the run. `azdo-emu doctor` re-checks them and reports versions.',
    '',
    '| Tool | Minimum | Needed by |',
    '| --- | --- | --- |',
    ...manifest.tools.map(
      (tool) =>
        `| ${code(tool.cmd)} | ${code(tool.min)} | ${tool.neededBy.map((n) => `\`${cell(n)}\``).join(', ') || '—'} |`,
    ),
  );
  return lines;
}

function warningsSection(manifest: SerializedManifest, plan: Scaffold): string[] {
  const entries = rankWarnings(manifest, plan);
  const lines = ['## Warnings', ''];
  if (entries.length === 0) {
    lines.push('No warnings: every step converted to a faithful local equivalent.');
  } else {
    lines.push(
      'Ranked worst-first. Each entry says where the gap is, what the step is, how faithful it is,',
      'and what to do about it.',
      '',
    );
    entries.forEach((entry, index) => {
      const tier = entry.tier === undefined ? '' : ` · \`${entry.tier}\``;
      lines.push(
        `${index + 1}. **${cell(entry.where)}** — ${code(entry.task)}${tier}`,
        `   ${cell(entry.reason)}`,
        `   → ${cell(entry.remediation)}`,
      );
    });
  }
  lines.push('', '## Unsupported', '');
  if (manifest.unsupported.length === 0) {
    lines.push('Nothing in the original pipeline was dropped as unsupported.');
  } else {
    lines.push(
      'Present in the original pipeline, with no local meaning — parsed, then left out on purpose:',
      '',
      ...manifest.unsupported.map((item) => `- ${cell(item)}`),
    );
  }
  return lines;
}

/**
 * Render the generated project's `README.md`.
 *
 * `manifest` supplies every claim about the pipeline; `plan` supplies the paths the README links to,
 * which is the scaffolder's to own (E05-S01-T01) and the only reason it is a second argument.
 */
export function generateReadme(manifest: SerializedManifest, plan: Scaffold): string {
  const sections = [
    summarySection(manifest, plan),
    quickStartSection(),
    pipelineSection(manifest, plan),
    fidelitySection(),
    environmentSection(manifest),
    toolsSection(manifest),
    warningsSection(manifest, plan),
  ];
  return `${sections.map((s) => s.join('\n')).join('\n\n')}\n`;
}
