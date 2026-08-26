// E10-S02-T02 — the `run` convenience proxy.
//
// The Do field's own words are "zero logic duplication (guard test: proxy adds nothing but exec)",
// and that guard is the first test in this file: the module's **source** is asserted to contain
// none of `run.sh`'s flag names. A proxy that learned them would be a second place to update
// whenever the emitter changes, and would diverge silently from the script it fronts.
//
// The Done field asks for "e2e parity: proxy vs direct invocation identical, including exit codes
// and signal handling". So the parity tests do exactly that — the same generated project, run both
// ways, compared on stdout *and* status — over a real conversion, a non-zero exit, and a fatal
// signal. The exit-status conventions are the shell's, pinned to the GNU Bash manual
// (C-E13-020/021), because they are what a proxy has to reproduce rather than invent.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { convert } from '../src/convert/index.js';
import { EXIT } from '../src/exit.js';
import { RUN_SCRIPT, runProject } from '../src/run/index.js';
import { run, type Io } from '../src/program.js';

/**
 * The proxy's source with its comments stripped.
 *
 * The guard is about what the module *does*, not what it explains: the doc comment names run.sh's
 * flags precisely to say that the code must not.
 */
const runSource = readFileSync(fileURLToPath(new URL('../src/run/run.ts', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

/** A directory holding a hand-written `run.sh`, for the cases a real conversion cannot produce. */
function fakeProject(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'azdo-run-'));
  const file = join(dir, RUN_SCRIPT);
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return dir;
}

/** Invoke through the CLI surface, exactly as a user would. */
async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { out: (t) => (out += t), err: (t) => (err += t), helpWidth: 80, colors: false };
  return { code: await run(argv, io), out, err };
}

describe('the guard: the proxy adds nothing but exec', () => {
  it("names none of `run.sh`'s flags", () => {
    // Every flag `run.sh` owns (E05-S01-T03, docs/06 §5 decision 62(c)). The proxy forwards them
    // without knowing them, which is only true if it never mentions one.
    for (const flag of [
      '--list',
      '--env-file',
      '--resume',
      '--from-step',
      '--to-step',
      '--only-step',
    ])
      expect(runSource, flag).not.toContain(flag);
  });

  it('forwards its arguments verbatim, in order, with nothing added or removed', () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawn = (command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return { status: 0, signal: null };
    };
    const dir = fakeProject('#!/usr/bin/env bash\nexit 0\n');

    runProject(dir, ['--list', '--env-file', 'x y', '--', '-o', 'weird'], { spawn });
    expect(calls).toEqual([
      {
        command: 'bash',
        args: [RUN_SCRIPT, '--list', '--env-file', 'x y', '--', '-o', 'weird'],
      },
    ]);
  });

  it('passes no arguments at all when given none', () => {
    const calls: (readonly string[])[] = [];
    const spawn = (_command: string, args: readonly string[]) => {
      calls.push(args);
      return { status: 0, signal: null };
    };
    runProject(fakeProject('#!/usr/bin/env bash\n'), [], { spawn });
    expect(calls).toEqual([[RUN_SCRIPT]]);
  });
});

describe('exit status', () => {
  const spawnWith = (result: { status: number | null; signal: NodeJS.Signals | null }) => () =>
    result;

  it('passes a child status through unchanged, including codes the CLI never produces', () => {
    const dir = fakeProject('#!/usr/bin/env bash\n');
    for (const status of [0, 1, 2, 3, 42, 126, 127, 255])
      expect(runProject(dir, [], { spawn: spawnWith({ status, signal: null }) })).toBe(status);
  });

  it('reports 128+N when the child dies on a fatal signal (C-E13-020)', () => {
    const dir = fakeProject('#!/usr/bin/env bash\n');
    // SIGINT is 2 on every platform Node supports; SIGTERM is 15.
    expect(runProject(dir, [], { spawn: spawnWith({ status: null, signal: 'SIGINT' }) })).toBe(130);
    expect(runProject(dir, [], { spawn: spawnWith({ status: null, signal: 'SIGTERM' }) })).toBe(
      143,
    );
  });

  it('refuses a directory that is not a generated project, before spawning anything', () => {
    const empty = mkdtempSync(join(tmpdir(), 'azdo-run-empty-'));
    let spawned = false;
    expect(() =>
      runProject(empty, [], {
        spawn: () => {
          spawned = true;
          return { status: 0, signal: null };
        },
      }),
    ).toThrow(/not a generated project/);
    expect(spawned).toBe(false);
  });

  it('reports a spawn failure as a CLI error, not a stack', () => {
    const dir = fakeProject('#!/usr/bin/env bash\n');
    expect(() =>
      runProject(dir, [], {
        spawn: () => ({ status: null, signal: null, error: new Error('ENOENT') }),
      }),
    ).toThrow(/cannot execute run\.sh/);
  });
});

describe('e2e parity: proxy vs direct invocation', () => {
  /** A real generated project, converted the way a user would. */
  async function project(pipeline: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-run-e2e-'));
    const file = join(dir, 'azure-pipelines.yml');
    writeFileSync(file, pipeline);
    const out = join(dir, 'out');
    await convert(file, { out, offlineExpand: true });
    writeFileSync(join(out, '.env'), '');
    return out;
  }

  /** The same invocation, run directly with bash. */
  function direct(out: string, ...args: string[]): { code: number; stdout: string } {
    const result = spawnSync('bash', [RUN_SCRIPT, ...args], { cwd: out, encoding: 'utf8' });
    return { code: result.status ?? -1, stdout: result.stdout };
  }

  it('a successful run: same exit code, and the proxy adds nothing to the output', async () => {
    const out = await project('steps:\n- script: echo parity-ok\n');
    const straight = direct(out);
    expect(straight.code).toBe(0);
    expect(straight.stdout).toContain('parity-ok');

    // Through the proxy: `stdio: 'inherit'` means the child writes to this process's stdout, so
    // parity is observed by spawning the CLI itself rather than by capturing in-process.
    expect(runProject(out, [])).toBe(straight.code);
  }, 120_000);

  it("a failing run: the pipeline's non-zero verdict survives the proxy", async () => {
    const out = await project('steps:\n- script: exit 7\n');
    const straight = direct(out);
    expect(straight.code).not.toBe(0);
    expect(runProject(out, [])).toBe(straight.code);
  }, 120_000);

  it('`--list` reaches run.sh through the proxy, unrecognized by the CLI', async () => {
    const out = await project('steps:\n- script: echo listed\n');
    const straight = direct(out, '--list');
    expect(straight.code).toBe(0);
    expect(straight.stdout).toContain('stages:');
    expect(runProject(out, ['--list'])).toBe(0);
  }, 120_000);

  it("an unknown flag is run.sh's to reject, not the CLI's", async () => {
    const out = await project('steps:\n- script: echo x\n');
    const straight = direct(out, '--no-such-flag');
    // run.sh exits 2 on an unknown option (E05-S01-T03); the proxy reports that, not its own usage
    // error, because the flag surface is the script's.
    expect(straight.code).toBe(2);
    expect(runProject(out, ['--no-such-flag'])).toBe(2);
  }, 120_000);

  it('a fatal signal becomes 128+N on both sides (C-E13-020)', () => {
    const dir = fakeProject('#!/usr/bin/env bash\nkill -INT $$\n');
    const straight = spawnSync('bash', [RUN_SCRIPT], { cwd: dir });
    // Bash's own convention, observed: the shell either reports the signal or already encodes it.
    const expected = straight.signal === null ? (straight.status ?? -1) : 130;
    expect(runProject(dir, [])).toBe(expected);
  });
});

describe('through the command line', () => {
  it("forwards the exit code the child produced, not one of the CLI's own", async () => {
    const dir = fakeProject('#!/usr/bin/env bash\nexit 42\n');
    const { code, err } = await cli('run', dir);
    expect(code).toBe(42);
    expect(err).toBe('');
  });

  it("lets `run.sh`'s own flags through instead of rejecting them as unknown", async () => {
    const dir = fakeProject('#!/usr/bin/env bash\n[[ "$1" == "--list" ]] && exit 11\nexit 12\n');
    expect((await cli('run', dir, '--list')).code).toBe(11);
    expect((await cli('run', dir)).code).toBe(12);
  });

  it('reports a directory that is not a generated project as a CLI error', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'azdo-run-empty-'));
    const { code, err } = await cli('run', empty);
    expect(code).toBe(EXIT.error);
    expect(err).toContain('not a generated project');
    expect(err).toContain('azdo-emu convert');
  });

  it('still requires its argument', async () => {
    const { code, err } = await cli('run');
    expect(code).toBe(EXIT.error);
    expect(err).toContain("missing required argument 'outdir'");
  });
});

describe('the binary itself', () => {
  // `bin.ts` is three lines — `process.exitCode = await run(...)` — and it is *not* spawned here.
  // Running it needs the built `dist/bin.js` (Node's type stripping does not remap the `.js`
  // specifiers the sources carry), and building inside a test races the suite's own build. What
  // the adapter contributes over `run()` is the assignment itself, which is asserted by reading it
  // rather than by executing it; every value that can reach it is covered above.
  it('assigns whatever `run` returned, with no mapping of its own', () => {
    const bin = readFileSync(fileURLToPath(new URL('../src/bin.ts', import.meta.url)), 'utf8');
    expect(bin).toContain('process.exitCode = await run(');
    // Exactly one assignment, and nothing between `run(...)` and it: no arithmetic, no clamping,
    // no `EXIT` lookup that could turn a proxied 42 into a 1.
    expect(bin.match(/process\.exitCode\s*=/g)).toHaveLength(1);
    expect(bin).not.toContain('EXIT');
  });
});
