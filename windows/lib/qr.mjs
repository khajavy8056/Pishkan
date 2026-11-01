/**
 * Minimal, dependency-free QR Code encoder (byte mode, versions 1–10, ECC M).
 *
 * The Windows manager must show a scannable QR for the private LAN URL without
 * downloading anything at runtime, so the encoder is implemented here instead
 * of pulling a package. Only the URL is encoded: never a password, session
 * token, or gateway secret.
 */
import zlib from 'node:zlib';

const EC_LEVEL_M_BITS = 0b00;

// version → [ec codewords per block, blocks g1, data codewords g1, blocks g2, data codewords g2]
const BLOCKS_M = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const MAX_BYTES = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 };

/* --------------------------------- GF(256) -------------------------------- */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}());

function gfMul(a, b) {
  if (!a || !b) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, degree) {
  const divisor = rsDivisor(degree);
  const result = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i += 1) result[i] ^= gfMul(divisor[i], factor);
  }
  return [...result];
}

/* --------------------------------- encoding ------------------------------- */

function versionFor(length) {
  for (let version = 1; version <= 10; version += 1) {
    if (length <= MAX_BYTES[version]) return version;
  }
  throw new Error('QR payload too long (max 213 bytes)');
}

function dataCodewords(bytes, version) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  const [ecPerBlock, blocks1, data1, blocks2, data2] = BLOCKS_M[version];
  const totalData = blocks1 * data1 + blocks2 * data2;
  const capacityBits = totalData * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  push(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    words.push(byte);
  }
  let pad = 0;
  while (words.length < totalData) {
    words.push(pad % 2 === 0 ? 0xec : 0x11);
    pad += 1;
  }
  void ecPerBlock;

  // Split into blocks and compute ECC per block.
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < blocks1; i += 1) {
    blocks.push(words.slice(offset, offset + data1));
    offset += data1;
  }
  for (let i = 0; i < blocks2; i += 1) {
    blocks.push(words.slice(offset, offset + data2));
    offset += data2;
  }
  const ecLength = BLOCKS_M[version][0];
  const ecc = blocks.map((block) => rsRemainder(block, ecLength));

  // Interleave data then ECC codewords.
  const maxData = Math.max(...blocks.map((block) => block.length));
  const out = [];
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecLength; i += 1) {
    for (const block of ecc) out.push(block[i]);
  }
  return out;
}

/* ---------------------------------- matrix -------------------------------- */

function bchFormat(data) {
  let value = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((value >> i) & 1) value ^= 0x537 << (i - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

function bchVersion(version) {
  let value = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((value >> i) & 1) value ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | value;
}

function buildMatrix(codewords, version, mask) {
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    matrix[y][x] = Boolean(dark);
    reserved[y][x] = true;
  };

  const placeFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };

  placeFinder(3, 3);
  placeFinder(size - 4, 3);
  placeFinder(3, size - 4);

  for (let i = 8; i < size - 8; i += 1) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }

  const positions = ALIGNMENT[version];
  for (const cy of positions) {
    for (const cx of positions) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, ring !== 1);
        }
      }
    }
  }

  // Reserve format areas (values written later) and the dark module.
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) { reserved[8][i] = true; reserved[i][8] = true; }
  }
  reserved[8][8] = true;
  reserved[size - 8][8] = true;
  for (let i = 0; i < 8; i += 1) reserved[size - 1 - i][8] = true;
  for (let i = 0; i < 8; i += 1) reserved[8][size - 1 - i] = true;
  matrix[size - 8][8] = true;

  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        reserved[size - 11 + j][i] = true;
        reserved[i][size - 11 + j] = true;
      }
    }
  }

  const bits = [];
  for (const word of codewords) for (let i = 7; i >= 0; i -= 1) bits.push((word >> i) & 1);
  let index = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (reserved[y][x]) continue;
        let bit = index < bits.length ? bits[index] : 0;
        index += 1;
        if (maskApplies(mask, x, y)) bit ^= 1;
        matrix[y][x] = bit === 1;
      }
    }
    upward = !upward;
  }

  // Format info (ECC level M + mask), both copies.
  const format = bchFormat((EC_LEVEL_M_BITS << 3) | mask);
  const formatBits = [];
  for (let i = 14; i >= 0; i -= 1) formatBits.push((format >> i) & 1);
  const f = (i) => formatBits[14 - i] === 1;
  // First copy, bit 0 first, around the top-left finder (x,y).
  const coordsA = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  coordsA.forEach(([x, y], i) => { matrix[y][x] = f(i); });
  for (let i = 0; i < 8; i += 1) matrix[size - 1 - i][8] = f(i);
  for (let i = 8; i < 15; i += 1) matrix[8][size - 15 + i] = f(i);
  matrix[size - 8][8] = true;

  if (version >= 7) {
    const versionBits = bchVersion(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((versionBits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      matrix[a][b] = bit;
      matrix[b][a] = bit;
    }
  }

  return matrix;
}

function maskApplies(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

function penalty(matrix) {
  const size = matrix.length;
  let score = 0;
  const lineScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) run += 1;
      else { if (run >= 5) total += run - 2; run = 1; }
    }
    if (run >= 5) total += run - 2;
    const text = line.map((cell) => (cell ? '1' : '0')).join('');
    const pattern = /10111010000|00001011101/g;
    const matches = text.match(pattern);
    if (matches) total += matches.length * 40;
    return total;
  };
  for (let y = 0; y < size; y += 1) score += lineScore(matrix[y]);
  for (let x = 0; x < size; x += 1) score += lineScore(matrix.map((row) => row[x]));
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const value = matrix[y][x];
      if (matrix[y][x + 1] === value && matrix[y + 1][x] === value && matrix[y + 1][x + 1] === value) score += 3;
    }
  }
  const dark = matrix.flat().filter(Boolean).length;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** Returns `{ size, modules }` where modules[y][x] is a boolean (true = dark). */
export function qrMatrix(text, forcedMask = null) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  const version = versionFor(bytes.length);
  const codewords = dataCodewords(bytes, version);
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    if (forcedMask !== null && mask !== forcedMask) continue;
    const matrix = buildMatrix(codewords, version, mask);
    const score = penalty(matrix);
    if (!best || score < best.score) best = { matrix, score, mask };
  }
  return { size: best.matrix.length, modules: best.matrix, mask: best.mask, version };
}

/* ----------------------------------- PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Renders the QR as a PNG (grayscale) with a 4-module quiet zone. */
export function qrPng(text, { scale = 6, quiet = 4 } = {}) {
  const { modules } = qrMatrix(text);
  const size = modules.length;
  const pixels = size + quiet * 2;
  const width = pixels * scale;
  const stride = width + 1;
  const raw = Buffer.alloc(stride * width, 0xff);
  for (let y = 0; y < width; y += 1) raw[y * stride] = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        const row = (quiet + y) * scale + dy;
        for (let dx = 0; dx < scale; dx += 1) {
          raw[row * stride + 1 + (quiet + x) * scale + dx] = 0x00;
        }
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(width, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // grayscale
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function qrPngBase64(text, options) {
  return qrPng(text, options).toString('base64');
}

/** Text-mode QR (two module rows per line) for terminals and the console setup. */
export function qrAscii(text) {
  const { modules } = qrMatrix(text);
  const size = modules.length;
  const lines = [];
  for (let y = 0; y < size; y += 2) {
    let line = '';
    for (let x = 0; x < size; x += 1) {
      const top = modules[y][x];
      const bottom = y + 1 < size ? modules[y + 1][x] : false;
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines;
}
