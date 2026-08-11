// E12-S01-T01 — meta-tests over the repo's own test layout.
//
// These guard the two ways the layout rots silently:
//  * a package gains tests but no vitest project, so its suite never runs;
//  * a coverage threshold glob stops matching (package renamed/moved) — vitest reports **no
//    error** for a glob that matches nothing, it just stops gating (C-E12-008, measured).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import config, { TS_PACKAGES } from '../vitest.config.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

type ThresholdMap = Record<string, unknown>;

const projects = config.test?.projects ?? [];
const projectNames = projects.map((project) =>
  typeof project === 'object' && project !== null && 'test' in project
    ? ((project as { test?: { name?: string } }).test?.name ?? '')
    : '',
);
const thresholds = (config.test?.coverage as { thresholds?: ThresholdMap } | undefined)?.thresholds;
const thresholdGlobs = Object.entries(thresholds ?? {})
  .filter(([, value]) => typeof value === 'object' && value !== null)
  .map(([glob]) => glob);

/** Every file under `dir`, as a repo-relative posix path. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(relative(repoRoot, full).split('\\').join('/'));
  }
  return out;
}

/**
 * Minimal glob → RegExp for the shapes the coverage config uses. Deliberately refuses anything
 * richer than `*` / `**` so a future exotic glob can't be silently mis-matched here and reported
 * as "covered" while vitest's own picomatch reads it differently.
 */
function globToRegExp(glob: string): RegExp {
  if (/[?{}[\]!()+@]/.test(glob)) {
    throw new Error(`glob "${glob}" uses syntax this guard does not implement — extend it`);
  }
  const source = glob
    .split('/')
    .map((segment) => {
      if (segment === '**') return '.*';
      return segment.replace(/[.+^$|\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    })
    .join('/')
    .replace(/\.\*\/\.\*/g, '.*');
  return new RegExp(`^${source}$`);
}

const packageFiles = walk(join(repoRoot, 'packages'));

describe('vitest projects', () => {
  it('covers every package that has *.test.ts files', () => {
    const packagesWithVitestTests = [
      ...new Set(
        packageFiles
          .filter((file) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(file))
          .map((file) => file.split('/')[1] as string),
      ),
    ].sort();
    expect(packagesWithVitestTests).toEqual([...TS_PACKAGES].sort());
    for (const name of TS_PACKAGES) expect(projectNames).toContain(name);
  });

  it('has a project for the repo-level meta tests (this file)', () => {
    expect(projectNames).toContain('repo');
    expect(existsSync(join(repoRoot, 'test'))).toBe(true);
  });

  it('leaves packages/runtime to bats (L4), not vitest', () => {
    expect(projectNames).not.toContain('runtime');
    const runtimePkg = JSON.parse(
      readFileSync(join(repoRoot, 'packages/runtime/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(runtimePkg.scripts.test).toContain('bats');
    expect(packageFiles.some((file) => /^packages\/runtime\/test\/.*\.bats$/.test(file))).toBe(
      true,
    );
  });

  it('lints every bats helper (shellcheck is a hard requirement for shipped shell)', () => {
    const runtimePkg = JSON.parse(
      readFileSync(join(repoRoot, 'packages/runtime/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const helpers = packageFiles.filter((file) =>
      /^packages\/runtime\/test\/helpers\/.*\.bash$/.test(file),
    );
    expect(helpers.length).toBeGreaterThan(0);
    expect(runtimePkg.scripts.lint).toContain('test/helpers/*.bash');
  });
});

describe('coverage thresholds', () => {
  it('has one glob per TypeScript package', () => {
    expect(thresholdGlobs.sort()).toEqual(
      [...TS_PACKAGES].map((name) => `packages/${name}/src/**`).sort(),
    );
  });

  // A glob that matches nothing passes silently — this is the only thing standing between a
  // renamed package and an ungated one (C-E12-008).
  it.each(thresholdGlobs)('glob %s still matches source files', (glob) => {
    const pattern = globToRegExp(glob);
    const matched = packageFiles.filter((file) => pattern.test(file) && file.endsWith('.ts'));
    expect(matched.length).toBeGreaterThan(0);
  });

  it('keeps a repo-wide floor alongside the per-package numbers', () => {
    // The global keys are their own threshold set over *all* files, checked independently of the
    // per-package sets (C-E12-007) — so this only asserts the floor exists, deliberately not any
    // ordering between it and a package's number: a package number *below* the floor is a real,
    // narrower gate (it fires on that package's own aggregate), not a decorative one.
    const global = thresholds as Record<string, unknown>;
    for (const key of ['statements', 'branches', 'functions', 'lines']) {
      expect(typeof global[key]).toBe('number');
    }
  });
});

describe('dependency pins', () => {
  // `yaml` is declared in three package.json files — the two packages that parse pipelines and
  // the repo root (for scripts/normalizer-survey.ts). An exact pin per file only helps while the
  // three agree: a survey parsing with a different yaml than the engine would produce evidence
  // about a parser the product does not use. This repo already treats pin drift as a test
  // concern (C-E12-010).
  const manifests = ['package.json', 'packages/engine/package.json', 'packages/cli/package.json'];

  it('pins yaml to the same exact version everywhere it is declared', () => {
    const versions = manifests.map((file) => {
      const json = JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const pin = json.dependencies?.yaml ?? json.devDependencies?.yaml;
      expect(pin, `${file} no longer declares yaml`).toBeDefined();
      expect(pin, `${file} must pin yaml exactly`).toMatch(/^\d+\.\d+\.\d+$/);
      return pin;
    });
    expect(new Set(versions).size, `yaml pins diverged: ${versions.join(', ')}`).toBe(1);
  });
});
