# E12-S01-T01 — test-harness behaviour probes

Three questions the tool documentation does not answer, measured on this repo (2026-08-11) with the
versions it pins: vitest 4.1.10 + `@vitest/coverage-v8` 4.1.10, bats-core 1.13.0. Each probe was run
against a temporary edit of `vitest.config.ts` (or a throwaway `.bats` file) that was reverted
afterwards; the committed configuration is the *conclusion* of these probes.

## 1. Does `projects: ['packages/*']` work, and what does it enrol? (C-E12-005)

```console
$ cat vitest.probe.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { projects: ['packages/*'] } });

$ pnpm vitest run --config vitest.probe.config.ts --reporter=dot
 Test Files  16 passed (16)
      Tests  252 passed (252)
EXIT=0

$ pnpm vitest run --config vitest.probe.config.ts --project '@azdo-emu/runtime' --reporter=dot
projects: @azdo-emu/runtime
|@azdo-emu/runtime|
include: **/*.{test,spec}.?(c|m)[jt]s?(x)
exclude:  **/node_modules/**, **/.git/**
EXIT=0
```

**Verdict:** the glob runs and a test-less package is not an error — but `packages/runtime`, whose
tests are bats files, becomes a real project that matches nothing, and project names come from
`package.json`. Enumerating the four TypeScript packages gives short filter names (`--project engine`)
and keeps the L1/L2 ↔ L4 split visible in the config.

## 2. Do coverage thresholds actually gate — and what happens to a glob that matches nothing? (C-E12-008)

Probe A — threshold above measured coverage (`packages/engine/src/**`: statements 90 → 99):

```console
$ pnpm vitest run --coverage --reporter=dot; echo "EXIT=$?"
ERROR: Coverage for statements (91.96%) does not meet "packages/engine/src/**" threshold (99%)
EXIT=1
```

Probe B — an extra glob for a package that does not exist
(`'packages/typo-nonexistent/src/**': { statements: 90, lines: 90 }`):

```console
$ pnpm vitest run --coverage --reporter=dot; echo "EXIT=$?"
=============================== Coverage summary ===============================
Statements   : 92.96% ( 846/910 )
…
EXIT=0
$ grep -i "ERROR: Coverage" run.txt        # no match
```

**Verdict:** enforcement works and names the offending glob, but an unmatched glob is silently
inert — no error, no warning, exit 0. That is the hole `test/test-layout.test.ts` closes; the guard
itself was mutation-tested by renaming `packages/fetch/src/**` → `packages/fetcher/src/**`, which
turns two meta-tests red.

## 3. Does bats really clean up its temporary directories? (C-E12-003)

```console
$ cat tmpdir-probe.bats
#!/usr/bin/env bats
@test "record tmpdirs" {
  printf '%s\n%s\n%s\n' "$BATS_TEST_TMPDIR" "$BATS_FILE_TMPDIR" "$BATS_SUITE_TMPDIR" > "$PROBE_OUT"
  touch "$BATS_TEST_TMPDIR/leftover"
}

$ PROBE_OUT=$PWD/tmpdirs.txt bats tmpdir-probe.bats
/tmp/bats-run-4dfRNX/test/1   exists=no
/tmp/bats-run-4dfRNX/file/1   exists=no
/tmp/bats-run-4dfRNX/suite    exists=no

$ PROBE_OUT=$PWD/tmpdirs2.txt bats --no-tempdir-cleanup tmpdir-probe.bats
BATS_RUN_TMPDIR: /tmp/bats-run-oB1Yf3
/tmp/bats-run-oB1Yf3/test/1   exists=yes
/tmp/bats-run-oB1Yf3/file/1   exists=yes
/tmp/bats-run-oB1Yf3/suite    exists=yes
```

**Verdict:** all three scratch directories (including files a test created inside them) are removed
when the run ends, and `--no-tempdir-cleanup` preserves them and prints the run directory. The fixture
store hands out directories under `BATS_TEST_TMPDIR` rather than calling `mktemp -d`, so isolation and
cleanup both come from bats and a failing test can still be inspected with one flag.
