// The golden harness CLI (E11-S02-T02).
//
//   node scripts/golden.ts             verify the committed goldens against the emitter
//   node scripts/golden.ts --update    regenerate them from the pinned expansions
//
// Both arms run under **vitest**, not this process: the harness emits from the package *sources*,
// which import each other with `.js` specifiers that bare `node` cannot resolve to `.ts`, and the
// built-bundle alternative may lag `src` — a golden verified against a stale build would go green
// over a broken emitter. So this file is a launcher, and everything
// it launches lives in `packages/emit/test/golden.ts`, shared by both arms so a golden cannot
// confirm itself.
//
// `--update` refuses when any corpus entry's oracle pair is missing or does not match
// `fixtures/oracle/MANIFEST.json`. Re-fetching is `scripts/corpus-oracle.ts`'s job and only its
// job — the one thing in the repo that talks to the preview endpoint (see `scripts/corpus.ts`).
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const HARNESS = 'test/golden-harness.test.ts';
export const UPDATER = 'test/golden-update.test.ts';
export const UPDATE_ENV = 'AZDO_EMU_GOLDEN_UPDATE';

export function main(argv: readonly string[]): number {
  const update = argv.includes('--update');
  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--project', 'emit', update ? UPDATER : HARNESS],
    {
      stdio: 'inherit',
      env: update ? { ...process.env, [UPDATE_ENV]: '1' } : process.env,
    },
  );
  if (result.error !== undefined) {
    process.stderr.write(`could not run vitest: ${result.error.message}\n`);
    return 1;
  }
  if (result.status !== 0 && !update) {
    process.stderr.write(
      'The emitted projects no longer match the committed goldens. If that change was ' +
        'intended, re-fetch the expansions (`pnpm corpus-oracle`) and run ' +
        '`node scripts/golden.ts --update`.\n',
    );
  }
  return result.status ?? 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
