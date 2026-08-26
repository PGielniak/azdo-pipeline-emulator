#!/usr/bin/env node
// E13-S01-T01 — the only place that touches process state. Everything above it is pure:
// `run()` returns an exit code and writes through the injected Io, so the whole CLI surface is
// testable in-process (no spawning, no process.exit interception).
import { run } from './program.js';

// `run` became async with E10-S02-T01 (`convert` awaits the expansion); this stays the only
// place that touches process state.
process.exitCode = await run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
