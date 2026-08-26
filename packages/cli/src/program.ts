// E13-S01-T01 — the command scaffold: every command of docs/06 §1 registered with its help text,
// the global `--json` flag, and a single exit path.
//
// Command *bodies* deliberately stop at NotImplementedError; their flags and behaviour belong to the
// epics that implement them (convert: E10-S02-T01, config: E10-S01-T02, auth: E09-S01 + E10-S03,
// doctor: E10-S04). Epic IDs re-pointed 2026-08-22 (E12-S03-T01) after the re-orientation's
// renumbering — the CLI epic is E10, fetchers/auth E09; `C-E13-*` claim IDs keep their prefix.
// What this module owns is the shape: the surface a user sees, and the exit code they get.
import { createRequire } from 'node:module';
import { Command, CommanderError, Option } from 'commander';
import {
  CHECKOUT_MODES,
  EXECUTION_ENVIRONMENTS,
  TARGET_OS,
  parseParameterOption,
  type CheckoutMode,
  type ExecutionEnvironment,
  type ParameterValue,
  type TargetOs,
} from './config/index.js';
import { convert, type ConvertFlags, type ConvertResult } from './convert/index.js';
import { runProject } from './run/index.js';
import { CliError, EXIT, NotImplementedError, ProxiedExit } from './exit.js';

/** Where the CLI writes, and what it knows about the terminal. Injected so tests are hermetic. */
export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  /** Columns for help text. Fixed in tests: commander otherwise reads `process.stdout.columns`
   *  when attached to a TTY and falls back to 80 when not (C-E13-006). */
  readonly helpWidth?: number | undefined;
  /** ANSI colours. Fixed in tests: commander turns colour *on* for a non-TTY stream whenever
   *  `FORCE_COLOR`/`CLICOLOR_FORCE` is set in the environment (C-E13-006). */
  readonly colors?: boolean | undefined;
}

export const PROGRAM_NAME = 'azdo-emu';

/** Global options every command shares. */
export interface GlobalOptions {
  /** Machine-readable output for tooling (docs/06 §1). */
  readonly json: boolean;
}

export function createProgram(io: Io): Command {
  const program = new Command();
  const helpWidth = io.helpWidth;

  program
    .name(PROGRAM_NAME)
    .description(
      'Convert an Azure DevOps YAML pipeline into a self-contained local project of bash scripts.',
    )
    .version(version(), '-V, --version', 'print the version and exit')
    .option('--json', 'machine-readable output for tooling', false)
    .showHelpAfterError(`(run \`${PROGRAM_NAME} --help\` for usage)`)
    // Required by `run`'s `passThroughOptions` (E10-S02-T02): with positional options on, a global
    // flag is only global *before* the subcommand, which is what lets `azdo-emu run out --list`
    // hand `--list` to `run.sh` instead of having commander reject it here.
    .enablePositionalOptions()
    // Errors and --help/--version both leave through here (C-E13-005); `run()` maps them by their
    // exit code. Without an override commander would call process.exit itself.
    .exitOverride()
    .configureOutput({
      writeOut: io.out,
      writeErr: io.err,
      getOutHasColors: () => io.colors ?? false,
      getErrHasColors: () => io.colors ?? false,
      // Width is overridden only when the caller pins one; left alone, commander reads the terminal
      // and falls back to 80 off a TTY, which is what a real user wants. (Its own default getter
      // returns `undefined` in that case even though the declared type says `number`, so the
      // override cannot simply forward `io.helpWidth`.)
      ...(helpWidth === undefined
        ? {}
        : { getOutHelpWidth: () => helpWidth, getErrHelpWidth: () => helpWidth }),
    });

  const auth = program
    .command('auth')
    .description('sign in to Azure DevOps or GitHub, and inspect the current session');

  auth
    .command('login')
    .description('sign in and cache a refresh token')
    .option('--github', 'sign in to GitHub instead of Azure DevOps', false)
    .option('--org <url>', 'organization URL, e.g. https://dev.azure.com/contoso')
    .addOption(choice('--mode <mode>', 'authentication mode', ['interactive', 'az', 'pat']))
    .action(() => {
      throw new NotImplementedError('auth login', 'E10-S03-T01 (auth UX) on top of E09-S01');
    });

  auth
    .command('status')
    .description('show who you are signed in as, and for which organization')
    .action(() => {
      throw new NotImplementedError('auth status', 'E10-S03-T01 (auth UX) on top of E09-S01');
    });

  program
    .command('convert')
    .description('convert a pipeline into a local project of bash scripts')
    .argument('<pipeline.yml>', 'the pipeline to convert')
    .requiredOption('-o, --out <dir>', 'output directory for the generated project')
    // Repeatable, and parsed here so a malformed value fails before any work starts. The value
    // stays as typed — coercion to the pipeline's declared parameter type is the binder's job
    // (C-E13-009). `name=@file.json` loads a complex value; `@@` escapes a literal `@` (C-E13-013).
    .option(
      '--parameter <name=value>',
      'runtime parameter (repeatable); `name=@file.json` for a complex value',
      collectParameter,
    )
    // E12-S01-T01 — the expansion gate. Expansion is the service's by default (PLAN D3); this flag
    // is the *only* way to reach the retained local template engine, and the conversion it produces
    // is labelled degraded (docs/07 §6). Its behaviour lives in `resolveExpansion`
    // (`@azdo-emu/fetch`); `convert`'s body binds it in E10-S02-T01.
    .option(
      '--offline-expand',
      'expand with the retained local template engine instead of the service (degraded fallback)',
      false,
    )
    // E10-S02-T01 — the rest of docs/06 §1's surface. Grouped by what they influence: context for
    // the service arm, the generated project's shape, lockfile discipline, and reporting.
    .option('--org <url>', 'organization URL, e.g. https://dev.azure.com/contoso')
    .option('--project <name>', 'project name, for @alias resolution and variable groups')
    .addOption(choice('--target-os <os>', 'override pool inference', [...TARGET_OS]))
    .addOption(choice('--checkout-mode <mode>', 'how `checkout` materializes', [...CHECKOUT_MODES]))
    // Registered so `--help` is honest about the intended surface, and refused by the body: the
    // container sandbox is deferred (docs/06 §1, E12-S02-T02). Silently accepting either would
    // write a manifest claiming an execution environment the project does not have.
    .addOption(
      choice('--exec-env <env>', 'execution environment (`sandbox` is deferred)', [
        ...EXECUTION_ENVIRONMENTS,
      ]),
    )
    .option('--sandbox-image <image>', 'sandbox image override (deferred with the sandbox)')
    .option('--group-names', 'list variable-group names in .env.example (values never fetched)')
    .option('--no-group-names', 'omit variable-group names from .env.example')
    .option('--only-stage <name>', 'convert only this stage (repeatable)', collectStage)
    .option('--frozen', 'resolve the expansion from cache only; never fetch', false)
    .option('--update', 'refresh the expansion and re-pin the lockfile', false)
    .option('--offline', 'make no network call (needs --frozen or --offline-expand)', false)
    .option('--strict', 'exit 2 when the conversion produced any warning', false)
    .option('--no-bundle', 'send the pipeline as authored, without inlining local templates')
    .action(async (pipeline: string, options: ConvertCommandOptions, command: Command) => {
      const globals = command.parent?.opts<GlobalOptions>() ?? { json: false };
      const result = await convert(pipeline, toConvertFlags(options));
      io.out(
        globals.json ? `${JSON.stringify(result.summary, undefined, 2)}\n` : summaryLine(result),
      );
    });

  program
    .command('doctor')
    .description("verify the generated project's tool prerequisites from its manifest")
    .argument('<outdir>', 'a generated project directory')
    .option('--sandbox', 'check inside the sandbox image instead of on the host', false)
    .action(() => {
      throw new NotImplementedError('doctor', 'E10-S04-T01 (doctor engine)');
    });

  program
    .command('fetch-artifacts')
    .description('download the pipeline artifacts a generated project depends on')
    .argument('<outdir>', 'a generated project directory')
    .option('--refresh', 're-download even when the cache is warm', false)
    .option('--latest', 'resolve each artifact to the latest run instead of the pinned one', false)
    .action(() => {
      throw new NotImplementedError('fetch-artifacts', 'E09-S03-T02 (artifact fetchers)');
    });

  program
    .command('run')
    .description(`convenience proxy to <outdir>/run.sh`)
    .argument('<outdir>', 'a generated project directory')
    .argument('[args...]', 'arguments forwarded verbatim to run.sh')
    // `passThroughOptions` so `azdo-emu run out --list` gives `--list` to `run.sh` rather than
    // letting commander reject it as unknown. The proxy knows none of run.sh's flags by design
    // (E10-S02-T02); it must not be in a position to reject one either.
    .passThroughOptions()
    .allowUnknownOption()
    .action((outdir: string, args: string[]) => {
      // The child's status *is* the pipeline's verdict, so it leaves through the same path an
      // error would rather than being collapsed onto the CLI's own 0/1/2.
      throw new ProxiedExit(runProject(outdir, args));
    });

  return program;
}

/** Commander's parsed `convert` options, before they become {@link ConvertFlags}. */
interface ConvertCommandOptions {
  readonly out: string;
  readonly parameter?: Record<string, ParameterValue>;
  readonly org?: string;
  readonly project?: string;
  readonly targetOs?: TargetOs;
  readonly checkoutMode?: CheckoutMode;
  readonly execEnv?: ExecutionEnvironment;
  readonly sandboxImage?: string;
  readonly groupNames?: boolean;
  readonly onlyStage?: string[];
  readonly frozen?: boolean;
  readonly update?: boolean;
  readonly offline?: boolean;
  readonly offlineExpand?: boolean;
  readonly strict?: boolean;
  readonly bundle?: boolean;
}

/** Drop the keys commander left undefined, so `exactOptionalPropertyTypes` stays satisfied. */
function toConvertFlags(options: ConvertCommandOptions): ConvertFlags {
  const defined = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as ConvertCommandOptions;
  return defined as ConvertFlags;
}

/**
 * The one-line summary docs/06 §1 asks for.
 *
 * It names the expansion arm because that is the single most load-bearing fact about a generated
 * project — a `degraded` conversion came from the retained local engine, not from the service.
 */
export function summaryLine(result: ConvertResult): string {
  const { summary } = result;
  const degraded = summary.expansion.degraded ? ' (degraded)' : '';
  const warnings =
    summary.warnings === 0
      ? 'no warnings'
      : `${summary.warnings} warning${summary.warnings === 1 ? '' : 's'} — see README.md`;
  return (
    `Converted ${summary.stages} stage(s), ${summary.jobs} job(s), ${summary.steps} step(s) ` +
    `into ${summary.out} — expanded by ${summary.expansion.mode}${degraded}; ${warnings}.\n`
  );
}

/**
 * Parse `argv` and return the process exit code. Never throws, never calls `process.exit`.
 *
 * Asynchronous since E10-S02-T01: `convert` awaits the expansion. Commander's `parseAsync` still
 * routes every failure through the same `report`, so the exit-code policy is unchanged.
 */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const program = createProgram(io);
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return EXIT.ok;
  } catch (error) {
    return report(error, io);
  }
}

function report(error: unknown, io: Io): number {
  // `run` proxies a child process, and a proxy that rewrote its status would make `azdo-emu run`
  // and `bash run.sh` disagree about whether the pipeline passed (E10-S02-T02).
  if (error instanceof ProxiedExit) return error.exitCode;

  // --help and --version arrive here as CommanderError with exitCode 0 (C-E13-005): the code is the
  // verdict, not the fact that something was thrown. Usage errors already carry commander's 1,
  // which is the code our own policy uses for them anyway (C-E13-007) — nothing to translate, and
  // the message has already been written to stderr by commander.
  if (error instanceof CommanderError) return asExitCode(error.exitCode);

  if (error instanceof CliError) {
    io.err(`${PROGRAM_NAME}: ${error.message}\n`);
    if (error.hint) io.err(`  ${error.hint}\n`);
    return error.exitCode;
  }

  // An unexpected failure is a bug in this tool, not a user error: say so, and keep the stack.
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  io.err(`${PROGRAM_NAME}: internal error\n${message}\n`);
  return EXIT.error;
}

function asExitCode(code: number): number {
  return (Object.values(EXIT) as number[]).includes(code) ? code : EXIT.error;
}

/** Accumulator for the repeatable `--parameter`; later occurrences win per name (C-E13-012). */
function collectParameter(
  raw: string,
  previous: Record<string, ParameterValue> | undefined,
): Record<string, ParameterValue> {
  const [name, value] = parseParameterOption(raw);
  return { ...previous, [name]: value };
}

/** Accumulator for the repeatable `--only-stage`. */
function collectStage(raw: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), raw];
}

/** `--mode interactive|az|pat` style options: a choice list commander validates and documents. */
function choice(flags: string, description: string, choices: readonly string[]): Option {
  return new Option(flags, description).choices([...choices]);
}

/**
 * The package's own version — read from `package.json`, never from the environment.
 *
 * `../package.json` resolves to the same file from `src/` (tests) and from `dist/` (the built bin),
 * so there is nothing to stamp at build time. Reading an env var here would make `--version` print
 * whatever happened to be set in the invoking shell, the same class of environment leak that
 * C-E13-006 pins away for help width and colour.
 */
function version(): string {
  const pkg = createRequire(import.meta.url)('../package.json') as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}
