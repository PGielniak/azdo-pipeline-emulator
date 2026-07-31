import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const vendorDir = path.join(import.meta.dirname, '..', 'vendor', 'tasks-meta');

// E00-S02-T03 Done set; refresh-tasks-meta.ts may add more without breaking this test.
const REQUIRED_SNAPSHOTS = ['CmdLine@2', 'Bash@3', 'PowerShell@2', 'CopyFiles@2'];

interface TaskJson {
  name: string;
  version: { Major: number; Minor: number; Patch: number };
}

interface Provenance {
  source: { repo: string; path: string; tag: string; commit: string };
  task: { name: string; version: string };
  sha256: string;
  bytes: number;
}

describe('vendored tasks-meta snapshots (E00-S02-T03)', () => {
  it('contains the required task snapshots', async () => {
    const dirs = await readdir(vendorDir);
    for (const snapshot of REQUIRED_SNAPSHOTS) {
      expect(dirs).toContain(snapshot);
    }
  });

  it('every snapshot matches its PROVENANCE pin and its own directory name', async () => {
    const dirs = await readdir(vendorDir);
    expect(dirs.length).toBeGreaterThan(0);

    for (const dir of dirs) {
      const raw = await readFile(path.join(vendorDir, dir, 'task.json'));
      const task = JSON.parse(raw.toString('utf8')) as TaskJson;
      const provenance = JSON.parse(
        await readFile(path.join(vendorDir, dir, 'PROVENANCE.json'), 'utf8'),
      ) as Provenance;

      // integrity: bytes on disk are exactly what was pinned
      expect(provenance.source.repo).toBe('microsoft/azure-pipelines-tasks');
      expect(provenance.source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(provenance.source.tag).toMatch(/^v\d+$/);
      expect(raw.byteLength).toBe(provenance.bytes);
      expect(createHash('sha256').update(raw).digest('hex')).toBe(provenance.sha256);

      // C-E00-014: snapshot dir is <name>@<version.Major> of the task.json it holds
      expect(dir).toBe(`${task.name}@${task.version.Major}`);
      expect(provenance.task.name).toBe(task.name);
      expect(provenance.task.version).toBe(
        `${task.version.Major}.${task.version.Minor}.${task.version.Patch}`,
      );
      // provenance points at the Tasks/<Dir>V<major>/ layout it was fetched from
      expect(provenance.source.path).toMatch(
        new RegExp(`^Tasks/[A-Za-z0-9]+V${task.version.Major}/task\\.json$`),
      );
    }
  });
});
