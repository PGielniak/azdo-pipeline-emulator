/**
 * Archive snapshot extraction (E09-S02-T04).
 *
 * E09-S02-T01/T02 leave two archive shapes in a cache entry — the ADO Items `$format=zip` fallback
 * and GitHub's tarball — and E09-S02-T03 could resolve and pin them but not *read* files out of
 * them. This unpacks either into `<entry>/tree/`, after which the CLI's `repositoryFetcher` reads
 * it like any working copy.
 *
 * Pure Node, no dependency and no host binary: `tar` and `unzip` are not both available on every
 * platform the CI matrix covers, and a snapshot that reads on Linux but not macOS is the kind of
 * host-dependence this repo has already been bitten by once (see `localFetcher`'s 2026-08-22 note).
 *
 * The two formats disagree about exactly the thing that matters (C-E09-050/051): the tarball
 * prefixes every entry with `<owner>-<repo>-<abbreviated sha>/` — abbreviated, so the prefix cannot
 * be computed from the pinned sha — while the zip has no prefix at all. One rule covers both: strip
 * a single leading component only when **every** entry shares it.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';

/** The directory an extracted snapshot lands in, beside its archive. */
export const EXTRACTED_TREE_DIR = 'tree';

export class ArchiveError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ArchiveError';
  }
}

export interface ArchiveEntry {
  /** Archive-relative path, prefix already stripped. Never absolute, never contains `..`. */
  readonly path: string;
  readonly bytes: Buffer;
}

const TAR_BLOCK = 512;

function octal(field: Buffer): number {
  const text = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (text.length === 0) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Read the regular files out of a POSIX/ustar tar.
 *
 * C-E09-052: the first member of a GitHub tarball is a PAX global header (typeflag `g`), and
 * directories carry `5`. Only typeflag `0` and the historical `\0` are regular files; everything
 * else — headers, directories, symlinks, devices — is skipped rather than written.
 */
export function readTarEntries(tar: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;

  while (offset + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK);
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (rawName.length === 0) break; // two zero blocks end the archive

    const size = octal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + TAR_BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new ArchiveError(
        `tar entry ${rawName} claims ${size} bytes past the end of the archive`,
      );
    }

    if (typeflag === '0' || typeflag === '\0') {
      // A `prefix` field (ustar) is prepended when the name did not fit in 100 bytes.
      const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
      const name = prefix.length === 0 ? rawName : `${prefix}/${rawName}`;
      entries.push({ path: name, bytes: tar.subarray(dataStart, dataEnd) });
    }
    offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return entries;
}

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;

/**
 * Read the files out of a zip via its central directory.
 *
 * C-E09-053: every member of the ADO snapshot is deflate (method 8); method 0 (stored) is legal in
 * the format and handled too. Anything else is refused rather than written as garbage.
 */
export function readZipEntries(zip: Buffer): ArchiveEntry[] {
  // The end-of-central-directory record is last, after an up-to-64KB comment.
  let eocd = -1;
  for (let index = zip.length - 22; index >= 0 && index >= zip.length - 22 - 0xffff; index -= 1) {
    if (zip.readUInt32LE(index) === ZIP_EOCD) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new ArchiveError('not a zip archive: no end-of-central-directory record');

  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  const entries: ArchiveEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== ZIP_CENTRAL) {
      throw new ArchiveError('zip central directory is truncated or malformed');
    }
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // a directory entry carries no bytes

    // The local header repeats the name and extra fields with its own lengths.
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zip.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.push({ path: name, bytes: Buffer.from(raw) });
    } else if (method === 8) {
      entries.push({ path: name, bytes: inflateRawSync(raw) });
    } else {
      throw new ArchiveError(`zip entry ${name} uses unsupported compression method ${method}`);
    }
  }
  return entries;
}

/**
 * C-E09-050/051: the tarball prefixes everything with `<owner>-<repo>-<short sha>/` and the zip
 * prefixes nothing. Deriving the prefix — rather than computing it from the pinned sha, which is
 * abbreviated in the archive and would never match — handles both with one rule.
 */
export function commonPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  const first = paths[0]!.split('/');
  if (first.length < 2) return '';
  const candidate = first[0]!;
  return paths.every((path) => path.startsWith(`${candidate}/`)) ? `${candidate}/` : '';
}

/**
 * C-E09-054: an archive is untrusted input. Neither service documents any constraint on the entry
 * names it may emit, so a destination that is not strictly inside `root` is refused. Local
 * hardening against zip-slip, not parity with anything.
 */
export function safeDestination(root: string, entryPath: string): string | undefined {
  if (entryPath.length === 0) return undefined;
  const normalizedRoot = resolve(root);
  const destination = resolve(normalizedRoot, entryPath);
  return destination !== normalizedRoot && destination.startsWith(normalizedRoot + sep)
    ? destination
    : undefined;
}

export interface ExtractionResult {
  readonly dir: string;
  readonly files: number;
  /** The leading component stripped from every entry, or `''` when the archive had none. */
  readonly strippedPrefix: string;
  /** Entries refused by the destination check (C-E09-054). */
  readonly rejected: readonly string[];
}

/** Unpack already-parsed entries into `targetDir`, stripping a shared leading component. */
export async function writeEntries(
  targetDir: string,
  entries: readonly ArchiveEntry[],
): Promise<ExtractionResult> {
  const prefix = commonPrefix(entries.map((entry) => entry.path));
  const rejected: string[] = [];
  let files = 0;

  await mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    const relative = prefix.length === 0 ? entry.path : entry.path.slice(prefix.length);
    const destination = safeDestination(targetDir, relative);
    if (destination === undefined) {
      rejected.push(entry.path);
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, entry.bytes);
    files += 1;
  }
  return { dir: targetDir, files, strippedPrefix: prefix, rejected };
}

export type ArchiveFormat = 'tar.gz' | 'zip';

/** Extract one archive into `<entryDir>/tree/`. */
export async function extractArchive(
  archive: Buffer,
  format: ArchiveFormat,
  entryDir: string,
): Promise<ExtractionResult> {
  const entries = format === 'zip' ? readZipEntries(archive) : readTarEntries(gunzipSync(archive));
  return writeEntries(join(entryDir, EXTRACTED_TREE_DIR), entries);
}
