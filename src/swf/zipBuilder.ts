export interface ZipEntryInput {
  path: string;
  data: Uint8Array | string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipArchive(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    const cleanPath = entry.path.replace(/^\/+/, '');
    const pathBytes = encoder.encode(cleanPath);
    const dataBytes =
      typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(dataBytes);
    return {
      pathBytes,
      dataBytes,
      crc,
      offset: 0,
    };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const item of prepared) {
    item.offset = localSize;
    localSize += 30 + item.pathBytes.length + item.dataBytes.length;
    centralSize += 46 + item.pathBytes.length;
  }

  const totalSize = localSize + centralSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  let pos = 0;

  // Write Local File Headers + Data
  for (const item of prepared) {
    view.setUint32(pos, 0x04034b50, true); // Local file header signature
    view.setUint16(pos + 4, 20, true); // Version needed to extract (2.0)
    view.setUint16(pos + 6, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(pos + 8, 0, true); // Compression method (0 = Store)
    view.setUint16(pos + 10, 0x4000, true); // File modification time
    view.setUint16(pos + 12, 0x555e, true); // File modification date
    view.setUint32(pos + 14, item.crc, true); // CRC-32
    view.setUint32(pos + 18, item.dataBytes.length, true); // Compressed size
    view.setUint32(pos + 22, item.dataBytes.length, true); // Uncompressed size
    view.setUint16(pos + 26, item.pathBytes.length, true); // File name length
    view.setUint16(pos + 28, 0, true); // Extra field length
    pos += 30;

    out.set(item.pathBytes, pos);
    pos += item.pathBytes.length;

    out.set(item.dataBytes, pos);
    pos += item.dataBytes.length;
  }

  const centralDirOffset = pos;

  // Write Central Directory Headers
  for (const item of prepared) {
    view.setUint32(pos, 0x02014b50, true); // Central file header signature
    view.setUint16(pos + 4, 20, true); // Version made by
    view.setUint16(pos + 6, 20, true); // Version needed to extract
    view.setUint16(pos + 8, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(pos + 10, 0, true); // Compression method (0 = Store)
    view.setUint16(pos + 12, 0x4000, true); // Last mod file time
    view.setUint16(pos + 14, 0x555e, true); // Last mod file date
    view.setUint32(pos + 16, item.crc, true); // CRC-32
    view.setUint32(pos + 20, item.dataBytes.length, true); // Compressed size
    view.setUint32(pos + 24, item.dataBytes.length, true); // Uncompressed size
    view.setUint16(pos + 28, item.pathBytes.length, true); // File name length
    view.setUint16(pos + 30, 0, true); // Extra field length
    view.setUint16(pos + 32, 0, true); // File comment length
    view.setUint16(pos + 34, 0, true); // Disk number start
    view.setUint16(pos + 36, 0, true); // Internal file attributes
    view.setUint32(pos + 38, 0, true); // External file attributes
    view.setUint32(pos + 42, item.offset, true); // Relative offset of local header
    pos += 46;

    out.set(item.pathBytes, pos);
    pos += item.pathBytes.length;
  }

  const centralDirSize = pos - centralDirOffset;

  // End of central directory record
  view.setUint32(pos, 0x06054b50, true); // End of central dir signature
  view.setUint16(pos + 4, 0, true); // Number of this disk
  view.setUint16(pos + 6, 0, true); // Disk where central directory starts
  view.setUint16(pos + 8, prepared.length, true); // Number of central directory records on this disk
  view.setUint16(pos + 10, prepared.length, true); // Total number of central directory records
  view.setUint32(pos + 12, centralDirSize, true); // Size of central directory
  view.setUint32(pos + 16, centralDirOffset, true); // Offset of start of central directory
  view.setUint16(pos + 20, 0, true); // Comment length

  return out;
}
