// E13-S01-T01 — the CLI scaffold: surface (help snapshots), exit-code policy, and usage errors.
//
// Everything runs in-process: `run()` returns the exit code and writes through the injected Io, so
// no test spawns a process or intercepts process.exit. Width and colour are pinned per C-E13-006 —
// commander otherwise reads the terminal for width and honours FORCE_COLOR/CLICOLOR_FORCE even for
// a non-TTY stream, either of which would make these snapshots pass locally and fail in CI.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CliError, EXIT, NotImplementedError } from '../src/exit.js';
import { PROGRAM_NAME, createProgram, run, type Io } from '../src/program.js';

const packageVersion = (createRequire(import.meta.url)('../package.json') as { version: string })
  .version;

interface Result {
  code: number;
  out: string;
  err: string;
}

function cli(...argv: string[]): Result {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => (out += text),
    err: (text) => (err += text),
    helpWidth: 80,
    colors: false,
  };
  return { code: run(argv, io), out, err };
}

/** Every command of docs/06 §1, as `--help` reaches it. */
const COMMANDS = [
  [],
  ['auth'],
  ['auth', 'login'],
  ['auth', 'status'],
  ['convert'],
  ['doctor'],
  ['fetch-artifacts'],
  ['preview-diff'],
  ['run'],
] as const;

describe('CLI scaffold (E13-S01-T01)', () => {
  describe('help', () => {
    for (const command of COMMANDS) {
      const label = command.length === 0 ? PROGRAM_NAME : `${PROGRAM_NAME} ${command.join(' ')}`;
      it(`\`${label} --help\` output is stable`, () => {
        const { code, out, err } = cli(...command, '--help');
        expect(err).toBe('');
        expect(code).toBe(EXIT.ok);
        expect(out).toMatchSnapshot();
      });
    }

    it('the documented command set is exactly what is registered (docs/06 §1)', () => {
      const registered = createProgram({ out: () => {}, err: () => {} })
        .commands.map((command) => command.name())
        .sort();
      expect(registered).toEqual([
        'auth',
        'convert',
        'doctor',
        'fetch-artifacts',
        'preview-diff',
        'run',
      ]);
    });

    it('--version prints the package version and exits 0 (C-E13-005)', () => {
      const { code, out } = cli('--version');
      expect(code).toBe(EXIT.ok);
      expect(out.trim()).toBe(packageVersion);
    });

    it('--version comes from package.json, not from the environment', () => {
      // A version read from an env var would print whatever the invoking shell happened to set —
      // the same environment leak C-E13-006 pins away for help width and colour.
      process.env['AZDO_EMU_VERSION'] = 'hijacked';
      try {
        expect(cli('--version').out.trim()).toBe(packageVersion);
      } finally {
        delete process.env['AZDO_EMU_VERSION'];
      }
    });
  });

  describe('exit-code policy (docs/06 §1, C-E13-007)', () => {
    it('reserves 0/1/2/3 and nothing else', () => {
      expect(EXIT).toEqual({ ok: 0, error: 1, strict: 2, coverage: 3 });
    });

    it('a CliError carries its own code, message and hint to stderr', () => {
      const io = { out: () => {}, err: () => {} };
      expect(new CliError('boom').exitCode).toBe(EXIT.error);
      expect(new CliError('too many warnings', { exitCode: EXIT.strict }).exitCode).toBe(
        EXIT.strict,
      );
      expect(new CliError('coverage 41% < 60%', { exitCode: EXIT.coverage }).exitCode).toBe(
        EXIT.coverage,
      );
      expect(createProgram(io).name()).toBe(PROGRAM_NAME); // program builds without touching process
    });

    it('an unimplemented command fails with 1 and names the epic that implements it', () => {
      const { code, err } = cli('doctor', 'out');
      expect(code).toBe(EXIT.error);
      expect(err).toContain('`azdo-emu doctor` is not implemented yet');
      expect(err).toContain('E13-S04-T01');
    });

    it('every registered command reports not-implemented rather than doing something', () => {
      const invocations: readonly string[][] = [
        ['auth', 'login'],
        ['auth', 'status'],
        ['convert', 'azure-pipelines.yml', '-o', 'out'],
        ['doctor', 'out'],
        ['fetch-artifacts', 'out'],
        ['preview-diff', 'azure-pipelines.yml'],
        ['run', 'out'],
      ];
      for (const argv of invocations) {
        const { code, err } = cli(...argv);
        expect({ argv, code }).toEqual({ argv, code: EXIT.error });
        expect(err).toContain('is not implemented yet');
      }
    });

    it('NotImplementedError is a CliError, so it flows through the same exit path', () => {
      const error = new NotImplementedError('convert', 'E13-S02-T01');
      expect(error).toBeInstanceOf(CliError);
      expect(error.exitCode).toBe(EXIT.error);
      expect(error.hint).toContain('E13-S02-T01');
    });
  });

  describe('usage errors (C-E13-004)', () => {
    it('an unknown flag exits 1, writes to stderr only, and points at --help', () => {
      const { code, out, err } = cli('--nope');
      expect(code).toBe(EXIT.error);
      expect(out).toBe('');
      expect(err).toContain("error: unknown option '--nope'");
      expect(err).toContain(`(run \`${PROGRAM_NAME} --help\` for usage)`);
    });

    it('an unknown flag on a subcommand is reported by that subcommand', () => {
      const { code, err } = cli('convert', 'azure-pipelines.yml', '-o', 'out', '--nope');
      expect(code).toBe(EXIT.error);
      expect(err).toContain("error: unknown option '--nope'");
    });

    it('a near-miss flag gets a did-you-mean suggestion', () => {
      const { err } = cli('--jsonn');
      expect(err).toContain('(Did you mean --json?)');
    });

    it('an unknown command exits 1', () => {
      const { code, err } = cli('frobnicate');
      expect(code).toBe(EXIT.error);
      expect(err).toContain('unknown command');
    });

    it('a missing required option exits 1 and names the option', () => {
      const { code, err } = cli('convert', 'azure-pipelines.yml');
      expect(code).toBe(EXIT.error);
      expect(err).toContain("required option '-o, --out <dir>' not specified");
    });

    it('a missing required argument exits 1', () => {
      const { code, err } = cli('doctor');
      expect(code).toBe(EXIT.error);
      expect(err).toContain("error: missing required argument 'outdir'");
    });

    it('a missing required *option* is reported before a missing argument', () => {
      // `convert` lacks both; commander checks options first, so this is the message a user sees.
      const { err } = cli('convert');
      expect(err).toContain("error: required option '-o, --out <dir>' not specified");
      expect(err).not.toContain('missing required argument');
    });

    it('an invalid choice for --mode exits 1 and lists the allowed values', () => {
      const { code, err } = cli('auth', 'login', '--mode', 'telepathy');
      expect(code).toBe(EXIT.error);
      expect(err).toContain('interactive');
      expect(err).toContain('pat');
    });
  });

  describe('global options', () => {
    it('--json is accepted before the command and defaults to false', () => {
      const program = createProgram({ out: () => {}, err: () => {} });
      expect(program.opts()['json']).toBe(false);
      const { code } = cli('--json', 'doctor', 'out');
      expect(code).toBe(EXIT.error); // reaches the command, which is not implemented yet
    });
  });
});
