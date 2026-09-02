/**
 * E11-S02-T02 — the `--update` arm of the golden harness.
 *
 * `scripts/golden.ts --update` drives this file with `AZDO_EMU_GOLDEN_UPDATE=1`; a normal run
 * skips it. It is a test rather than a standalone script because bare `node` cannot execute the
 * package sources (they import each other with `.js` specifiers) and the built bundle beside each
 * package may lag `src` — a golden regenerated from a stale build would pin behaviour the
 * emitter no longer has. vitest is the repo's TypeScript runner, so the update runs where the
 * verification runs, over exactly the same code.
 *
 * The freshness gate lives in `./golden.ts` and refuses outright when any corpus entry's oracle
 * pair is missing or stale, so this arm cannot record a golden the service never produced.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

import { GOLDEN_MANIFEST_PATH, updateGoldens } from './golden.js';

const updating = process.env.AZDO_EMU_GOLDEN_UPDATE === '1';
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('golden --update', () => {
  it.runIf(updating)('regenerates the committed goldens from the pinned expansions', async () => {
    const manifest = await updateGoldens(repoRoot);
    const count = Object.keys(manifest.entries).length;
    expect(count).toBeGreaterThan(0);
    // This arm is a CLI: its output is the point.
    console.log(`wrote ${count} goldens to ${GOLDEN_MANIFEST_PATH}`);
  });
});
