import { defineConfig } from 'vitest/config';

// E12-S01-T01 — one vitest project per TypeScript package (docs/06 §3, layers L1/L2).
// Projects are enumerated rather than globbed. `projects: ['packages/*']` does run (a package
// without test files is not an error, C-E12-005), but it enrolls `packages/runtime` as a
// project that can never match anything — its layer is L4/bats — and names every project after
// its package.json name, so filtering reads `--project @azdo-emu/engine` instead of
// `--project engine`. The list below is kept honest by test/test-layout.test.ts.
// The per-project include keeps the pre-existing `packages/*/test/**/*.test.ts` layout, so every
// suite written before this task resolves unchanged.
export const TS_PACKAGES = ['cli', 'engine', 'emit', 'fetch'] as const;

// The repo's own meta-tests (test layout, config drift): rooted at the repo root, not in a package.
const REPO_PROJECT = 'repo';

export default defineConfig({
  test: {
    projects: [
      ...TS_PACKAGES.map((name) => ({
        test: {
          name,
          root: `packages/${name}`,
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      })),
      {
        test: {
          name: REPO_PROJECT,
          root: '.',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
    // Coverage is root-level in vitest 4 (there is no per-project coverage config);
    // per-package thresholds are expressed as glob keys under `thresholds` (C-E12-006).
    coverage: {
      provider: 'v8',
      // Without `include`, v8 reports only files a test happened to load; the globs make
      // untouched sources count against the thresholds too (C-E12-009).
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/dist/**', '**/vendor/**', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Ratchet, not aspiration: each number is the coverage measured when this task landed,
      // rounded down. Raise them when a package's real number rises; never lower one to make
      // a red run green — write the test instead.
      // Glob keys are matched against paths relative to the repo root. The top-level numbers are
      // their own threshold set over *every* file, glob-matched ones included, checked
      // independently of the per-package sets — so a package number below the repo floor is a
      // narrower gate on that package's own aggregate, not a weakening (C-E12-007).
      // `emit` is a placeholder package: its 100 is simply its measurement today, and gets
      // re-seeded from measurement when E09 fills it (a re-baseline, not a lowering).
      thresholds: {
        statements: 90,
        branches: 78,
        functions: 90,
        lines: 92,
        'packages/cli/src/**': { statements: 92, branches: 84, functions: 90, lines: 95 },
        'packages/engine/src/**': { statements: 90, branches: 80, functions: 94, lines: 94 },
        'packages/emit/src/**': { statements: 100, lines: 100 },
        'packages/fetch/src/**': { statements: 96, branches: 76, functions: 100, lines: 96 },
      },
    },
  },
});
