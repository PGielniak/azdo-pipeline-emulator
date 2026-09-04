/**
 * `azdo-emu doctor <outdir>` — the CLI wiring over E10-S04-T01's probe engine.
 *
 * The engine, the probe table, the version comparison and the report were built and tested on
 * 2026-09-02; what was missing was the call site, and one input. **`manifest.json`'s `tools[]` was
 * always empty** (C-E10-035): `aggregateTools` landed with E10-S04-T02's contract and nothing ever
 * invoked it, so `doctor` would have answered "this pipeline needs no external tools" for a project
 * full of `az` and `kubectl` steps — a confidently wrong answer, which is worse than no command.
 * `convert` now fills it, and this reads it back.
 *
 * Reading the manifest rather than re-deriving the requirements is the point of the contract
 * (E10-S04-T02): the generated project is the artifact a user shares, so `doctor` must be able to
 * answer from it alone, on a machine that never ran `convert`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { CliError } from '../exit.js';
import { formatDoctor, runDoctor, type DoctorOptions, type ToolRequirement } from './probe.js';

/** The slice of `manifest.json` this command reads. Deliberately narrow (C-E10-036). */
interface ManifestToolsView {
  readonly schemaVersion?: unknown;
  readonly tools?: unknown;
}

export interface DoctorCommandOptions extends DoctorOptions {
  readonly json?: boolean;
  readonly sandbox?: boolean;
}

export interface DoctorOutput {
  readonly text: string;
  readonly ok: boolean;
}

/**
 * Read `tools[]` out of a generated project's manifest.
 *
 * Every failure here is the user pointing at the wrong directory, so each one says which directory
 * and what was expected — `ENOENT` on a path they typed is not a diagnosis.
 */
export function readManifestTools(outdir: string): readonly ToolRequirement[] {
  const file = path.join(outdir, 'manifest.json');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new CliError(`no manifest.json in ${outdir}`, {
      hint: 'point doctor at a directory `azdo-emu convert -o` produced',
    });
  }

  let parsed: ManifestToolsView;
  try {
    parsed = JSON.parse(raw) as ManifestToolsView;
  } catch {
    throw new CliError(`${file} is not valid JSON`, {
      hint: 're-run `azdo-emu convert` for this project',
    });
  }

  // C-E10-036: an *absent* `tools` and an empty one mean different things. Absent means the manifest
  // predates this field — a project converted by an older build — and answering "nothing needed"
  // for it would be the same confidently-wrong answer this task exists to remove. Empty means the
  // pipeline genuinely uses no task that shells out, which is a real and common answer.
  if (parsed.tools === undefined) {
    throw new CliError(`${file} declares no tools[] — it predates the doctor contract`, {
      hint: 're-run `azdo-emu convert` to regenerate the project',
    });
  }
  if (!Array.isArray(parsed.tools)) {
    throw new CliError(`${file} has a malformed tools[]`, {
      hint: 're-run `azdo-emu convert` for this project',
    });
  }
  return parsed.tools as readonly ToolRequirement[];
}

/** Run the probes for a generated project and render them. */
export function doctor(outdir: string, options: DoctorCommandOptions = {}): DoctorOutput {
  if (options.sandbox === true) {
    // Refused rather than ignored, for decision 69's reason: accepting the flag would report on an
    // execution environment the project does not have (PLAN D9 defers the container sandbox).
    throw new CliError(
      '`--sandbox` is not available: the container sandbox is deferred (PLAN D9)',
      {
        hint: 'run doctor on the host, which is where the generated project runs',
      },
    );
  }

  const tools = readManifestTools(outdir);
  const report = runDoctor(tools, options);
  const text =
    options.json === true
      ? `${JSON.stringify({ version: 1, ok: report.ok, results: report.results }, undefined, 2)}\n`
      : formatDoctor(report);
  return { text, ok: report.ok };
}
