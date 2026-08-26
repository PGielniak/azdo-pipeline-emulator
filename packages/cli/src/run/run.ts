/**
 * E10-S02-T02 — `azdo-emu run <outdir> [...]`: a proxy to `<outdir>/run.sh`, and nothing else.
 *
 * The whole value of this command is that it is *thin*. `run.sh` is the generated project's own
 * entry point (docs/04 §2) and it owns its flag surface — `--list`, `--env-file`, `--resume`
 * (E05-S01-T03, docs/06 §5 decision 62(c)). A proxy that knew those names would be a second place
 * to update whenever the emitter changes, and would silently diverge from the script it fronts. So
 * this module names **none** of them: everything after `<outdir>` is forwarded verbatim, and a test
 * asserts the source contains no flag string at all.
 *
 * **Exit-code transparency is the contract, not a nicety.** `run.sh` ends with
 * `exit "$(azdo_run_exit_code)"`, so its status *is* the pipeline's verdict. Collapsing that onto
 * the CLI's own 0/1/2 would make `azdo-emu run` and `bash run.sh` disagree about whether the
 * pipeline passed — which is exactly the thing a proxy must not do. The status therefore passes
 * through unchanged, including the two values only a child can produce:
 *
 *   - **128+N when the child dies on signal N.** "When a command terminates on a fatal signal whose
 *     number is N, Bash uses the value 128+N as the exit status" (GNU Bash Reference Manual 5.3,
 *     §3.7.5 Exit Status, C-E13-020). Node reports the signal by *name*, so the number is recovered
 *     from `os.constants.signals`.
 *   - **126/127 from the shell itself** when `bash` cannot find or execute the script — "If a
 *     command is not found … returns a status of 127. If a command is found but is not executable,
 *     the return status is 126" (same section, C-E13-021). Those come back untouched too: they are
 *     the shell's answer, and inventing our own would hide it.
 *
 * The one thing that is *not* the shell's answer is a missing output directory, which is a usage
 * mistake this command can diagnose before spawning anything.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { constants } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { CliError } from '../exit.js';

/** The generated project's entry point (docs/04 §2). */
export const RUN_SCRIPT = 'run.sh';

/** Injected so the proxy is testable without spawning a real shell. */
export type Spawn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => { status: number | null; signal: NodeJS.Signals | null; error?: Error | undefined };

export interface RunProxyDeps {
  readonly spawn?: Spawn | undefined;
}

/**
 * Signal name to number, for the 128+N convention (C-E13-020).
 *
 * `os.constants.signals` is the platform's own table rather than a hard-coded list: `SIGUSR1` is 10
 * on Linux and 30 on macOS, and a proxy that assumed one would report the wrong status on the other.
 */
function signalStatus(signal: NodeJS.Signals): number {
  const number = (constants.signals as Record<string, number | undefined>)[signal];
  // A signal Node named but the platform does not number cannot be translated; 128 alone still
  // says "died on a signal", which is more honest than pretending it exited normally.
  return number === undefined ? 128 : 128 + number;
}

/**
 * Run `<outdir>/run.sh`, forwarding `args` verbatim, and return its exit status.
 *
 * `stdio: 'inherit'` rather than capture: the pipeline's output is the user's output, and buffering
 * it would break the live log a long run exists to show.
 */
export function runProject(
  outdir: string,
  args: readonly string[],
  deps: RunProxyDeps = {},
): number {
  const directory = path.resolve(outdir);
  const script = path.join(directory, RUN_SCRIPT);
  if (!existsSync(script))
    throw new CliError(`not a generated project: ${outdir}`, {
      hint: `expected ${RUN_SCRIPT} in that directory — run \`azdo-emu convert\` first`,
    });

  const spawn = deps.spawn ?? spawnSync;
  const result = spawn('bash', [RUN_SCRIPT, ...args], {
    cwd: directory,
    stdio: 'inherit',
  });

  if (result.error !== undefined)
    throw new CliError(`cannot execute ${RUN_SCRIPT}: ${result.error.message}`, {
      hint: 'is `bash` on PATH?',
    });

  if (result.signal !== null) return signalStatus(result.signal);
  // `status` is null only when a signal ended the child, which the branch above already answered.
  return result.status ?? 0;
}
