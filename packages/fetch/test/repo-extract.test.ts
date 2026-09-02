import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArchiveError,
  EXTRACTED_TREE_DIR,
  commonPrefix,
  extractArchive,
  readTarEntries,
  readZipEntries,
  safeDestination,
  writeEntries,
} from '../src/repo/extract.js';

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-extract-'));
  tempDirs.push(directory);
  return directory;
}

// --- tar construction -------------------------------------------------------------------------

function tarHeader(name: string, size: number, typeflag: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('000644 \0', 100, 8, 'ascii');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.write(typeflag, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  // Checksum: the field reads as spaces while it is summed.
  header.write('        ', 148, 8, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

function tarOf(members: readonly { name: string; body?: string; typeflag?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const member of members) {
    const body = Buffer.from(member.body ?? '', 'utf8');
    blocks.push(tarHeader(member.name, body.length, member.typeflag ?? '0'));
    if (body.length > 0) {
      const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
      body.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(1024)); // two zero blocks
  return Buffer.concat(blocks);
}

// --- zip construction -------------------------------------------------------------------------

function zipOf(members: readonly { name: string; body: string; stored?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const raw = Buffer.from(member.body, 'utf8');
    const data = member.stored === true ? raw : deflateRawSync(raw);
    const method = member.stored === true ? 0 : 8;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

// ----------------------------------------------------------------------------------------------

describe('commonPrefix (C-E09-050/051)', () => {
  it('derives the tarball prefix instead of computing it from the pinned sha', () => {
    // The archive abbreviates the sha to 7 characters, so a prefix built from the 40-character
    // commit the resolver pinned would never match. Deriving it sidesteps that entirely.
    expect(
      commonPrefix([
        'octocat-Hello-World-7fd1a60/README',
        'octocat-Hello-World-7fd1a60/ci/build.yml',
      ]),
    ).toBe('octocat-Hello-World-7fd1a60/');
  });

  it('is a no-op for the ADO zip, whose entries are repository-relative', () => {
    expect(commonPrefix(['README.md', 'cross/abs.yml', 'cross/leaf.yml'])).toBe('');
  });

  it('strips nothing when the first component is not shared, or there is nothing to share', () => {
    expect(commonPrefix(['a/x.yml', 'b/y.yml'])).toBe('');
    expect(commonPrefix(['README.md'])).toBe('');
    expect(commonPrefix([])).toBe('');
  });
});

describe('safeDestination (C-E09-054)', () => {
  it('refuses traversal, absolute paths and the root itself', () => {
    expect(safeDestination('/out', 'ci/build.yml')).toBe('/out/ci/build.yml');
    expect(safeDestination('/out', '../escape.yml')).toBeUndefined();
    expect(safeDestination('/out', 'ci/../../escape.yml')).toBeUndefined();
    expect(safeDestination('/out', '/etc/passwd')).toBeUndefined();
    expect(safeDestination('/out', '')).toBeUndefined();
    expect(safeDestination('/out', '.')).toBeUndefined();
  });

  it('does not treat a sibling directory with a shared name prefix as inside', () => {
    // `/outside` starts with `/out` as a string but is not under it.
    expect(safeDestination('/out', '../outside/x')).toBeUndefined();
  });
});

describe('readTarEntries', () => {
  it('skips the PAX global header and directory members (C-E09-052)', () => {
    const tar = tarOf([
      { name: 'pax_global_header', body: 'x'.repeat(52), typeflag: 'g' },
      { name: 'octocat-Hello-World-7fd1a60/', typeflag: '5' },
      { name: 'octocat-Hello-World-7fd1a60/README', body: 'Hello World!\n' },
    ]);
    const entries = readTarEntries(tar);
    expect(entries.map((entry) => entry.path)).toEqual(['octocat-Hello-World-7fd1a60/README']);
    expect(entries[0]?.bytes.toString('utf8')).toBe('Hello World!\n');
  });

  it('accepts the historical NUL typeflag for a regular file', () => {
    const entries = readTarEntries(tarOf([{ name: 'a.yml', body: 'x', typeflag: '\0' }]));
    expect(entries.map((entry) => entry.path)).toEqual(['a.yml']);
  });

  it('refuses a member whose size runs past the end of the archive', () => {
    const truncated = tarOf([{ name: 'a.yml', body: 'x'.repeat(2000) }]).subarray(0, 700);
    expect(() => readTarEntries(truncated)).toThrow(ArchiveError);
  });
});

describe('readZipEntries', () => {
  it('inflates deflate members and copies stored ones (C-E09-053)', () => {
    const zip = zipOf([
      { name: 'README.md', body: 'deflated body' },
      { name: 'cross/leaf.yml', body: 'steps: []\n', stored: true },
      { name: 'cross/', body: '' },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((entry) => entry.path)).toEqual(['README.md', 'cross/leaf.yml']);
    expect(entries[0]?.bytes.toString('utf8')).toBe('deflated body');
    expect(entries[1]?.bytes.toString('utf8')).toBe('steps: []\n');
  });

  it('refuses a buffer with no end-of-central-directory record', () => {
    expect(() => readZipEntries(Buffer.from('not a zip'))).toThrow(/no end-of-central-directory/);
  });

  it('refuses an unsupported compression method', () => {
    const zip = zipOf([{ name: 'a.yml', body: 'x' }]);
    // Rewrite the method in both the local and central headers to bzip2 (12).
    zip.writeUInt16LE(12, 8);
    const eocd = zip.length - 22;
    zip.writeUInt16LE(12, zip.readUInt32LE(eocd + 16) + 10);
    expect(() => readZipEntries(zip)).toThrow(/unsupported compression method 12/);
  });
});

describe('extractArchive', () => {
  it('unpacks a tarball into tree/ with the prefix stripped', async () => {
    const entry = await scratch();
    const tar = tarOf([
      { name: 'pax_global_header', body: 'x'.repeat(52), typeflag: 'g' },
      { name: 'o-r-7fd1a60/', typeflag: '5' },
      { name: 'o-r-7fd1a60/README', body: 'top\n' },
      { name: 'o-r-7fd1a60/ci/build.yml', body: 'steps:\n- script: built\n' },
    ]);

    const result = await extractArchive(gzipSync(tar), 'tar.gz', entry);
    expect(result.strippedPrefix).toBe('o-r-7fd1a60/');
    expect(result.files).toBe(2);
    expect(result.rejected).toEqual([]);
    expect(result.dir).toBe(join(entry, EXTRACTED_TREE_DIR));

    await expect(readFile(join(result.dir, 'README'), 'utf8')).resolves.toBe('top\n');
    await expect(readFile(join(result.dir, 'ci', 'build.yml'), 'utf8')).resolves.toContain('built');
    // The PAX header must not have been written as a file.
    await expect(stat(join(result.dir, 'pax_global_header'))).rejects.toThrow();
  });

  it('unpacks a zip with no prefix, keeping paths repository-relative', async () => {
    const entry = await scratch();
    const result = await extractArchive(
      zipOf([
        { name: 'README.md', body: '# fixture\n' },
        { name: 'cross/leaf.yml', body: 'steps: []\n' },
      ]),
      'zip',
      entry,
    );

    expect(result.strippedPrefix).toBe('');
    expect(result.files).toBe(2);
    await expect(readFile(join(result.dir, 'cross', 'leaf.yml'), 'utf8')).resolves.toBe(
      'steps: []\n',
    );
  });

  it('never strips a shared directory out of a zip, even when every entry has one', async () => {
    // Regression from E09-S03-T02: an artifact laid out as `app/build.txt` shares a first
    // component by *content*, not because anything wrapped it. C-E09-051 measured the ADO zip as
    // having no wrapper, so the zip path must never strip — losing a directory level here would
    // silently relocate every file in the artifact.
    const entry = await scratch();
    const result = await extractArchive(
      zipOf([{ name: 'app/build.txt', body: 'one file, one directory\n' }]),
      'zip',
      entry,
    );

    expect(result.strippedPrefix).toBe('');
    await expect(readFile(join(result.dir, 'app', 'build.txt'), 'utf8')).resolves.toBe(
      'one file, one directory\n',
    );
  });

  it('rejects a traversing entry instead of writing it (C-E09-054)', async () => {
    const entry = await scratch();
    const result = await extractArchive(
      zipOf([
        { name: 'ok.yml', body: 'fine\n' },
        { name: '../escaped.yml', body: 'should not be written\n' },
      ]),
      'zip',
      entry,
    );

    expect(result.files).toBe(1);
    expect(result.rejected).toEqual(['../escaped.yml']);
    await expect(stat(join(entry, 'escaped.yml'))).rejects.toThrow();
    await expect(readdir(result.dir)).resolves.toEqual(['ok.yml']);
  });

  it('handles an archive where a traversal would otherwise share the prefix', async () => {
    const entry = await scratch();
    // Both entries share `p/`, so the prefix strips to `../escape` — still refused.
    const result = await extractArchive(
      zipOf([
        { name: 'p/ok.yml', body: 'fine\n' },
        { name: 'p/../../escape.yml', body: 'nope\n' },
      ]),
      'zip',
      entry,
    );
    expect(result.rejected).toEqual(['p/../../escape.yml']);
    expect(result.files).toBe(1);
  });
});

describe('writeEntries against a real GitHub tarball shape', () => {
  it('reproduces the measured layout end to end', async () => {
    // Built with the system tar so the header encoding is not our own test helper's.
    const source = await scratch();
    await mkdir(join(source, 'octocat-Hello-World-7fd1a60', 'ci'), { recursive: true });
    await writeFile(join(source, 'octocat-Hello-World-7fd1a60', 'README'), 'Hello World!\n');
    await writeFile(
      join(source, 'octocat-Hello-World-7fd1a60', 'ci', 'build.yml'),
      'steps: []\n',
      'utf8',
    );
    const archive = join(await scratch(), 'a.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', source, 'octocat-Hello-World-7fd1a60'], {
      stdio: 'ignore',
    });

    const entry = await scratch();
    const result = await extractArchive(await readFile(archive), 'tar.gz', entry);
    expect(result.strippedPrefix).toBe('octocat-Hello-World-7fd1a60/');
    expect(result.files).toBe(2);
    await expect(readFile(join(result.dir, 'README'), 'utf8')).resolves.toBe('Hello World!\n');
  });

  it('writes nothing for an empty archive', async () => {
    const entry = await scratch();
    const result = await writeEntries(join(entry, EXTRACTED_TREE_DIR), []);
    expect(result).toMatchObject({ files: 0, strippedPrefix: '', rejected: [] });
    await expect(readdir(result.dir)).resolves.toEqual([]);
  });
});
