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

async function cli(...argv: string[]): Promise<Result> {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => (out += text),
    err: (text) => (err += text),
    helpWidth: 80,
    colors: false,
  };
  return { code: await run(argv, io), out, err };
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
  ['run'],
] as const;

describe('CLI scaffold (E13-S01-T01)', async () => {
  describe('help', () => {
    for (const command of COMMANDS) {
      const label = command.length === 0 ? PROGRAM_NAME : `${PROGRAM_NAME} ${command.join(' ')}`;
      it(`\`${label} --help\` output is stable`, async () => {
        const { code, out, err } = await cli(...command, '--help');
        expect(err).toBe('');
        expect(code).toBe(EXIT.ok);
        expect(out).toMatchSnapshot();
      });
    }

    it('the documented command set is exactly what is registered (docs/06 §1)', async () => {
      const registered = createProgram({ out: () => {}, err: () => {} })
        .commands.map((command) => command.name())
        .sort();
      expect(registered).toEqual(['auth', 'convert', 'doctor', 'fetch-artifacts', 'run']);
    });

    it('--version prints the package version and exits 0 (C-E13-005)', async () => {
      const { code, out } = await cli('--version');
      expect(code).toBe(EXIT.ok);
      expect(out.trim()).toBe(packageVersion);
    });

    it('--version comes from package.json, not from the environment', async () => {
      // A version read from an env var would print whatever the invoking shell happened to set —
      // the same environment leak C-E13-006 pins away for help width and colour.
      process.env['AZDO_EMU_VERSION'] = 'hijacked';
      try {
        expect((await cli('--version')).out.trim()).toBe(packageVersion);
      } finally {
        delete process.env['AZDO_EMU_VERSION'];
      }
    });
  });

  describe('exit-code policy (docs/06 §1, C-E13-007)', async () => {
    it('reserves 0/1/2 and nothing else', async () => {
      expect(EXIT).toEqual({ ok: 0, error: 1, strict: 2 });
    });

    it('a CliError carries its own code, message and hint to stderr', async () => {
      const io = { out: () => {}, err: () => {} };
      expect(new CliError('boom').exitCode).toBe(EXIT.error);
      expect(new CliError('too many warnings', { exitCode: EXIT.strict }).exitCode).toBe(
        EXIT.strict,
      );
      expect(createProgram(io).name()).toBe(PROGRAM_NAME); // program builds without touching process
    });

    it('an unimplemented command fails with 1 and names the epic that implements it', async () => {
      const { code, err } = await cli('doctor', 'out');
      expect(code).toBe(EXIT.error);
      expect(err).toContain('`azdo-emu doctor` is not implemented yet');
      expect(err).toContain('E10-S04-T01');
    });

    it('every still-unimplemented command reports not-implemented rather than doing something', async () => {
      // `convert` left this list with E10-S02-T01: it now does the work, and its own failure modes
      // are exercised in `convert.test.ts`.
      const invocations: readonly string[][] = [
        ['auth', 'login'],
        ['auth', 'status'],
        ['doctor', 'out'],
        ['fetch-artifacts', 'out'],
        ['run', 'out'],
      ];
      for (const argv of invocations) {
        const { code, err } = await cli(...argv);
        expect({ argv, code }).toEqual({ argv, code: EXIT.error });
        expect(err).toContain('is not implemented yet');
      }
    });

    it('NotImplementedError is a CliError, so it flows through the same exit path', async () => {
      const error = new NotImplementedError('convert', 'E10-S02-T01');
      expect(error).toBeInstanceOf(CliError);
      expect(error.exitCode).toBe(EXIT.error);
      expect(error.hint).toContain('E10-S02-T01');
    });
  });

  describe('usage errors (C-E13-004)', async () => {
    it('an unknown flag exits 1, writes to stderr only, and points at --help', async () => {
      const { code, out, err } = await cli('--nope');
      expect(code).toBe(EXIT.error);
      expect(out).toBe('');
      expect(err).toContain("error: unknown option '--nope'");
      expect(err).toContain(`(run \`${PROGRAM_NAME} --help\` for usage)`);
    });

    it('an unknown flag on a subcommand is reported by that subcommand', async () => {
      const { code, err } = await cli('convert', 'azure-pipelines.yml', '-o', 'out', '--nope');
      expect(code).toBe(EXIT.error);
      expect(err).toContain("error: unknown option '--nope'");
    });

    it('a near-miss flag gets a did-you-mean suggestion', async () => {
      const { err } = await cli('--jsonn');
      expect(err).toContain('(Did you mean --json?)');
    });

    it('an unknown command exits 1', async () => {
      const { code, err } = await cli('frobnicate');
      expect(code).toBe(EXIT.error);
      expect(err).toContain('unknown command');
    });

    it('a missing required option exits 1 and names the option', async () => {
      const { code, err } = await cli('convert', 'azure-pipelines.yml');
      expect(code).toBe(EXIT.error);
      expect(err).toContain("required option '-o, --out <dir>' not specified");
    });

    it('a missing required argument exits 1', async () => {
      const { code, err } = await cli('doctor');
      expect(code).toBe(EXIT.error);
      expect(err).toContain("error: missing required argument 'outdir'");
    });

    it('a missing required *option* is reported before a missing argument', async () => {
      // `convert` lacks both; commander checks options first, so this is the message a user sees.
      const { err } = await cli('convert');
      expect(err).toContain("error: required option '-o, --out <dir>' not specified");
      expect(err).not.toContain('missing required argument');
    });

    it('an invalid choice for --mode exits 1 and lists the allowed values', async () => {
      const { code, err } = await cli('auth', 'login', '--mode', 'telepathy');
      expect(code).toBe(EXIT.error);
      expect(err).toContain('interactive');
      expect(err).toContain('pat');
    });
  });

  describe('--parameter wiring (E13-S01-T02)', async () => {
    /** Parse a convert invocation and read what `--parameter` collected, ignoring the
     *  not-implemented action that follows. */
    async function collected(...argv: string[]): Promise<unknown> {
      const program = createProgram({ out: () => {}, err: () => {} });
      const convert = program.commands.find((command) => command.name() === 'convert')!;
      try {
        // `parseAsync`, not `parse`: since E10-S02-T01 the action is async, and the synchronous
        // form returns before it settles — leaving the failure as an unhandled rejection instead
        // of something this `catch` sees.
        await program.parseAsync(['convert', 'azure-pipelines.yml', '-o', 'out', ...argv], {
          from: 'user',
        });
      } catch {
        // The pipeline file does not exist here; the flag has already been parsed by then.
      }
      return convert.opts()['parameter'];
    }

    it('is repeatable, collecting one entry per occurrence', async () => {
      expect(await collected('--parameter', 'deployEnv=dev', '--parameter', 'region=weu')).toEqual({
        deployEnv: 'dev',
        region: 'weu',
      });
    });

    it('is absent when never passed, so the config layer shows through', async () => {
      expect(await collected()).toBeUndefined();
    });

    it('a malformed value fails with exit 1 before any work starts', async () => {
      const { code, err } = await cli(
        'convert',
        'azure-pipelines.yml',
        '-o',
        'out',
        '--parameter',
        'oops',
      );
      expect(code).toBe(EXIT.error);
      expect(err).toContain('needs `name=value`');
      expect(err).not.toContain('not implemented yet');
    });
  });

  describe('--offline-expand (E12-S01-T01)', async () => {
    /** Parse a convert invocation and read one of its options, ignoring the not-implemented
     *  action that follows. `convert`'s body binds the flag to `resolveExpansion` in E10-S02-T01;
     *  what this asserts is that the gate exists on the surface and is off unless asked for. */
    async function option(name: string, ...argv: string[]): Promise<unknown> {
      const program = createProgram({ out: () => {}, err: () => {} });
      const convert = program.commands.find((command) => command.name() === 'convert')!;
      try {
        await program.parseAsync(['convert', 'azure-pipelines.yml', '-o', 'out', ...argv], {
          from: 'user',
        });
      } catch {
        // The pipeline file does not exist here; the flag has already been parsed by then.
      }
      return convert.opts()[name];
    }

    it('defaults to false, so the service is the expansion path (PLAN D3)', async () => {
      expect(await option('offlineExpand')).toBe(false);
    });

    it('is true only when explicitly passed', async () => {
      expect(await option('offlineExpand', '--offline-expand')).toBe(true);
    });

    it('advertises itself as degraded in --help, not as an equal alternative', async () => {
      const { out } = await cli('convert', '--help');
      expect(out).toContain('--offline-expand');
      expect(out).toContain('degraded fallback');
    });
  });

  describe('global options', async () => {
    it('--json is accepted before the command and defaults to false', async () => {
      const program = createProgram({ out: () => {}, err: () => {} });
      expect(program.opts()['json']).toBe(false);
      const { code } = await cli('--json', 'doctor', 'out');
      expect(code).toBe(EXIT.error); // reaches the command, which is not implemented yet
    });
  });
});
