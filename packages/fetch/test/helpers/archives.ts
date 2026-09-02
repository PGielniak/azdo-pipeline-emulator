/**
 * Minimal real archives for tests (E09-S02-T04).
 *
 * The snapshot fetchers now unpack what they download, so a test body of `'tar-bytes'` no longer
 * stands in for an archive. These builders emit byte-valid tar.gz and zip containers so the
 * fetchers' tests exercise the same path production does.
 */
import { deflateRawSync, gzipSync } from 'node:zlib';

export interface ArchiveMember {
  readonly name: string;
  readonly body: string;
}

function tarHeader(name: string, size: number, typeflag: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('000644 \0', 100, 8, 'ascii');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.write(typeflag, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

/** A gzipped tar with the `<owner>-<repo>-<short sha>/` prefix GitHub really emits (C-E09-050). */
export function githubTarball(
  prefix: string,
  members: readonly ArchiveMember[] = [{ name: 'README', body: 'fixture\n' }],
): Buffer {
  const blocks: Buffer[] = [tarHeader(`${prefix}/`, 0, '5')];
  for (const member of members) {
    const body = Buffer.from(member.body, 'utf8');
    blocks.push(tarHeader(`${prefix}/${member.name}`, body.length, '0'));
    const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
    body.copy(padded);
    if (padded.length > 0) blocks.push(padded);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A deflate zip with repository-relative entries, as the ADO Items route emits (C-E09-051/053). */
export function adoZip(
  members: readonly ArchiveMember[] = [{ name: 'README.md', body: 'fixture\n' }],
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const raw = Buffer.from(member.body, 'utf8');
    const data = deflateRawSync(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
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
