// E13-S01-T01 — the exit-code policy, in one place.
//
// docs/06 §1 fixes the conversion outcomes; CLI *usage* errors are not in that list and reuse 1,
// the generic failure code, which is also commander's own default so the two never need translating
// (C-E13-007/004). Every command reports failure by throwing a CliError — never by calling
// process.exit — so the whole surface stays testable in-process.

// The set was `0/1/2/3` when C-E13-007 was recorded; `3` (below `--min-coverage`) went with the
// coverage metric in E12-S02-T01 (PLAN D10 revised, docs/07 §6). The decision C-E13-007 records —
// usage errors reuse `1` rather than inventing a code outside the documented set — is unchanged.

/** Exit codes the CLI is allowed to produce (docs/06 §1). */
export const EXIT = {
  /** Success. */
  ok: 0,
  /** Conversion errors — and, per C-E13-007, CLI usage errors. */
  error: 1,
  /** Warnings promoted to errors by `--strict`. */
  strict: 2,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** A failure with a chosen exit code. The message is user-facing; no stack trace is printed. */
export class CliError extends Error {
  readonly exitCode: ExitCode;
  /** Optional second line: what the user can do about it. */
  readonly hint: string | undefined;

  constructor(message: string, options: { exitCode?: ExitCode; hint?: string } = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = options.exitCode ?? EXIT.error;
    this.hint = options.hint;
  }
}

/**
 * A command that exists in the CLI surface (docs/06 §1) but whose behaviour lands in a later epic.
 * Registering it now — rather than hiding it — keeps `--help` honest about the intended surface and
 * gives every command an exercised exit path.
 */
export class NotImplementedError extends CliError {
  constructor(command: string, epic: string) {
    super(`\`azdo-emu ${command}\` is not implemented yet`, {
      exitCode: EXIT.error,
      hint: `it lands in ${epic} — see BACKLOG.md`,
    });
    this.name = 'NotImplementedError';
  }
}

/**
 * The exit status of a **proxied** child process, carried out through the one exit path.
 *
 * `run` fronts `<outdir>/run.sh`, whose status is the pipeline's verdict — including values the CLI
 * itself never produces: `128+N` for a fatal signal and `126`/`127` from the shell when the script
 * cannot be found or executed (GNU Bash Reference Manual §3.7.5, C-E13-020/021). Collapsing those
 * onto `EXIT` would make `azdo-emu run` and `bash run.sh` disagree about whether the pipeline
 * passed, which is the one thing a proxy must not do (E10-S02-T02).
 *
 * It is an `Error` so it travels the path every other outcome travels; it carries no message
 * because there is nothing to say — the child has already written whatever it had to write.
 */
export class ProxiedExit extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`proxied exit ${exitCode}`);
    this.name = 'ProxiedExit';
    this.exitCode = exitCode;
  }
}
