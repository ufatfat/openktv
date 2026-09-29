// Clean JavaScript port of music-geshizhuanhuan's MIT-licensed QMC implementation.
// Original project: https://github.com/Afle520/music-geshizhuanhuan
import { DatabaseSync } from "node:sqlite";
import { closeSync, fstatSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { basename, extname } from "node:path";

const V1_STATIC_KEY = Buffer.from([
  0xc3, 0x4a, 0xd6, 0xca, 0x90, 0x67, 0xf7, 0x52, 0xd8, 0xa1, 0x66, 0x62, 0x9f, 0x5b, 0x09, 0x00,
  0xc3, 0x5e, 0x95, 0x23, 0x9f, 0x13, 0x11, 0x7e, 0xd8, 0x92, 0x3f, 0xbc, 0x90, 0xbb, 0x74, 0x0e,
  0xc3, 0x47, 0x74, 0x3d, 0x90, 0xaa, 0x3f, 0x51, 0xd8, 0xf4, 0x11, 0x84, 0x9f, 0xde, 0x95, 0x1d,
  0xc3, 0xc6, 0x09, 0xd5, 0x9f, 0xfa, 0x66, 0xf9, 0xd8, 0xf0, 0xf7, 0xa0, 0x90, 0xa1, 0xd6, 0xf3,
  0xc3, 0xf3, 0xd6, 0xa1, 0x90, 0xa0, 0xf7, 0xf0, 0xd8, 0xf9, 0x66, 0xfa, 0x9f, 0xd5, 0x09, 0xc6,
  0xc3, 0x1d, 0x95, 0xde, 0x9f, 0x84, 0x11, 0xf4, 0xd8, 0x51, 0x3f, 0xaa, 0x90, 0x3d, 0x74, 0x47,
  0xc3, 0x0e, 0x74, 0xbb, 0x90, 0xbc, 0x3f, 0x92, 0xd8, 0x7e, 0x11, 0x13, 0x9f, 0x23, 0x95, 0x5e,
  0xc3, 0x00, 0x09, 0x5b, 0x9f, 0x62, 0x66, 0xa1, 0xd8, 0x52, 0xf7, 0x67, 0x90, 0xca, 0xd6, 0x4a,
]);

const V1_EXTENSIONS = new Set([
  ".tkm", ".bkcmp3", ".bkcm4a", ".bkcflac", ".bkcwav", ".bkcape", ".bkcogg", ".bkcwma",
  ".666c6163", ".6d7033", ".6f6767", ".6d3461", ".776176",
]);
const MUSICEX_BLOCK_SIZE = 0xc0;
const MAX_EKEY_LENGTH = 0x500;
const EKEY_V2_PREFIX = Buffer.from("QQMusic EncV2,Key:").toString("base64");
const EKEY_V2_KEY_1 = Buffer.from([0x33, 0x38, 0x36, 0x5a, 0x4a, 0x59, 0x21, 0x40, 0x23, 0x2a, 0x24, 0x25, 0x5e, 0x26, 0x29, 0x28]);
const EKEY_V2_KEY_2 = Buffer.from([0x2a, 0x2a, 0x23, 0x21, 0x28, 0x23, 0x24, 0x25, 0x26, 0x5e, 0x61, 0x31, 0x63, 0x5a, 0x2c, 0x54]);
const DB_TABLES = [
  ["audio_file_ekey_table", "file_path", "ekey"],
  ["EKeyFileInfo", "filePath", "eKey"],
  ["p2p_cache_info_table", "file_id", "ekey"],
];

function isBase64Text(value) {
  return value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function decodeUtf16Ascii(value) {
  let result = "";
  for (let index = 0; index + 1 < value.length; index += 2) {
    const low = value[index];
    const high = value[index + 1];
    if (low === 0 && high === 0) break;
    if (high !== 0 || low === 0 || low >= 128) break;
    result += String.fromCharCode(low);
  }
  return result;
}

export function parseQmcFooter(tail) {
  if (tail.length < 8) return null;
  const marker = tail.subarray(tail.length - 4).toString("ascii");
  if (marker === "STag" || marker === "QTag") {
    const payloadLength = tail.readUInt32BE(tail.length - 8);
    if (payloadLength <= 0 || payloadLength > tail.length - 8) throw new Error(`${marker} 长度不一致`);
    const parts = tail.subarray(tail.length - 8 - payloadLength, tail.length - 8).toString("utf8").split(",");
    if (marker === "STag") {
      if (parts.length !== 3 || parts[1] !== "2" || !/^\d+$/.test(parts[0])) throw new Error("STag 内容非法");
      return { size: payloadLength + 8, ekey: null, kind: marker, resourceId: Number(parts[0]), mid: parts[2] };
    }
    if (parts.length !== 3 || parts[2] !== "2" || !/^\d+$/.test(parts[1]) || !isBase64Text(parts[0])) throw new Error("QTag 内容非法");
    return { size: payloadLength + 8, ekey: parts[0], kind: marker, resourceId: Number(parts[1]) };
  }

  if (tail.subarray(tail.length - 8).equals(Buffer.from("musicex\0", "ascii"))) {
    if (tail.length < MUSICEX_BLOCK_SIZE + 12) throw new Error("MusicEx 尾包过短");
    const version = tail.readUInt32LE(tail.length - 12);
    const payloadLength = tail.readUInt32LE(tail.length - 16);
    if (version !== 1) throw new Error(`MusicEx 版本 ${version} 暂不支持`);
    if (payloadLength !== MUSICEX_BLOCK_SIZE) throw new Error(`MusicEx 长度非法 0x${payloadLength.toString(16).toUpperCase()}`);
    const innerEnd = tail.length - 16;
    const inner = tail.subarray(innerEnd - (payloadLength - 0x10), innerEnd);
    return {
      size: payloadLength + 12,
      ekey: null,
      kind: "MusicEx",
      mid: decodeUtf16Ascii(inner.subarray(12, 72)),
      mediaFilename: decodeUtf16Ascii(inner.subarray(72, 172)),
    };
  }

  const payloadLength = tail.readUInt32LE(tail.length - 4);
  if (payloadLength <= 0 || payloadLength > MAX_EKEY_LENGTH) return null;
  if (payloadLength > tail.length - 4) throw new Error("PcV1Legacy 长度不一致");
  let encoded = tail.subarray(tail.length - 4 - payloadLength, tail.length - 4).toString("latin1");
  const zero = encoded.indexOf("\0");
  if (zero >= 0) encoded = encoded.slice(0, zero);
  if (!isBase64Text(encoded)) throw new Error("PcV1Legacy EKey 非法");
  return { size: payloadLength + 4, ekey: encoded, kind: "PcV1Legacy" };
}

function teaMix(value, sum, key1, key2) {
  return (((((value << 4) >>> 0) + key1) >>> 0) ^ ((sum + value) >>> 0) ^ (((value >>> 5) + key2) >>> 0)) >>> 0;
}

function teaDecryptBlock(block, key) {
  let high = block.readUInt32BE(0);
  let low = block.readUInt32BE(4);
  const words = [0, 4, 8, 12].map((offset) => key.readUInt32BE(offset));
  const delta = 0x9e3779b9;
  let sum = Math.imul(delta, 16) >>> 0;
  for (let round = 0; round < 16; round += 1) {
    low = (low - teaMix(high, sum, words[2], words[3])) >>> 0;
    high = (high - teaMix(low, sum, words[0], words[1])) >>> 0;
    sum = (sum - delta) >>> 0;
  }
  const result = Buffer.allocUnsafe(8);
  result.writeUInt32BE(high, 0);
  result.writeUInt32BE(low, 4);
  return result;
}

function xorBlock(left, right) {
  const result = Buffer.allocUnsafe(8);
  for (let index = 0; index < 8; index += 1) result[index] = left[index] ^ right[index];
  return result;
}

function decryptTencentTea(ciphertext, key) {
  if (ciphertext.length < 16 || ciphertext.length % 8 !== 0) throw new Error(`TEA 密文长度非法：${ciphertext.length}`);
  let previousCipher = Buffer.alloc(8);
  let previousDecrypted = Buffer.alloc(8);
  const plain = Buffer.allocUnsafe(ciphertext.length);
  for (let offset = 0; offset < ciphertext.length; offset += 8) {
    const cipherBlock = ciphertext.subarray(offset, offset + 8);
    const nextDecrypted = teaDecryptBlock(xorBlock(cipherBlock, previousDecrypted), key);
    xorBlock(nextDecrypted, previousCipher).copy(plain, offset);
    previousCipher = Buffer.from(cipherBlock);
    previousDecrypted = nextDecrypted;
  }
  const paddingLength = plain[0] & 0x07;
  const bodyStart = 1 + paddingLength + 2;
  const bodyEnd = ciphertext.length - 7;
  if (bodyStart > bodyEnd || plain.subarray(bodyEnd).some((value) => value !== 0)) throw new Error("TEA 尾部校验失败");
  return plain.subarray(bodyStart, bodyEnd);
}

function simpleKey() {
  const result = Buffer.allocUnsafe(8);
  for (let index = 0; index < 8; index += 1) {
    const argument = Math.fround(106 + Math.fround(index * Math.fround(0.1)));
    const value = Math.abs(Math.tan(argument));
    result[index] = Math.max(0, Math.min(Math.trunc(Math.fround(Math.fround(value) * 100)), 255));
  }
  return result;
}

function decodeBase64(value, label) {
  if (!isBase64Text(value)) throw new Error(`${label} 不是合法 Base64`);
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length) throw new Error(`${label} 为空`);
  return decoded;
}

function deriveV1MasterKey(ekey) {
  const decoded = decodeBase64(ekey, "EKey");
  if (decoded.length < 16) throw new Error("EKey 解码后过短");
  const header = decoded.subarray(0, 8);
  const fixed = simpleKey();
  const teaKey = Buffer.allocUnsafe(16);
  for (let index = 0; index < 8; index += 1) {
    teaKey[index * 2] = fixed[index];
    teaKey[index * 2 + 1] = header[index];
  }
  return Buffer.concat([header, decryptTencentTea(decoded.subarray(8), teaKey)]);
}

export function deriveMasterKey(value) {
  const ekey = Buffer.isBuffer(value) ? value.toString("latin1").trim() : String(value || "").trim();
  if (!ekey) throw new Error("EKey 为空");
  if (!ekey.startsWith(EKEY_V2_PREFIX)) return deriveV1MasterKey(ekey);
  let payload = decodeBase64(ekey.slice(EKEY_V2_PREFIX.length), "EKey v2");
  payload = decryptTencentTea(payload, EKEY_V2_KEY_1);
  payload = decryptTencentTea(payload, EKEY_V2_KEY_2);
  const zero = payload.indexOf(0);
  return deriveV1MasterKey(payload.subarray(0, zero < 0 ? payload.length : zero).toString("latin1"));
}

function qmc1Transform(data, key, offset = 0) {
  const output = Buffer.allocUnsafe(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const absolute = offset + index;
    const normalized = absolute > 0x7fff ? absolute % 0x7fff : absolute;
    output[index] = data[index] ^ key[normalized % 128];
  }
  return output;
}

export function createQmc1Cipher(key = V1_STATIC_KEY) {
  if (key.length !== 128) throw new Error("QMC v1 密钥必须为 128 字节");
  return { decrypt: (data, offset = 0) => qmc1Transform(data, key, offset) };
}

export const createStaticCipher = createQmc1Cipher;

function compressMapKey(masterKey) {
  if (!masterKey.length) throw new Error("QMC Map 密钥为空");
  const key = Buffer.allocUnsafe(128);
  for (let index = 0; index < key.length; index += 1) {
    const sourceIndex = (index * index + 71_214) % masterKey.length;
    const shift = (sourceIndex + 4) % 8;
    key[index] = ((masterKey[sourceIndex] << shift) | (masterKey[sourceIndex] >>> shift)) & 0xff;
  }
  return key;
}

export function createMapCipher(masterKey) {
  const key = compressMapKey(masterKey);
  return { decrypt: (data, offset = 0) => qmc1Transform(data, key, offset) };
}

function qmc2Hash(key) {
  let hash = 1;
  for (const value of key) {
    if (value === 0) continue;
    const next = Math.imul(hash, value) >>> 0;
    if (next === 0 || next <= hash) break;
    hash = next;
  }
  return hash;
}

function segmentKey(segmentId, seed, hash) {
  if (seed === 0) return 0;
  return Math.trunc((hash / ((segmentId + 1) * seed)) * 100);
}

export function createRc4Cipher(masterKey) {
  if (!masterKey.length) throw new Error("QMC RC4 密钥为空");
  const key = Buffer.from(masterKey);
  const state = Array.from({ length: key.length }, (_, index) => index & 0xff);
  let right = 0;
  for (let left = 0; left < state.length; left += 1) {
    right = (right + state[left] + key[left % key.length]) % key.length;
    [state[left], state[right]] = [state[right], state[left]];
  }
  let left = 0;
  right = 0;
  const keyStream = Buffer.allocUnsafe(0x1400 + 512);
  for (let index = 0; index < keyStream.length; index += 1) {
    left = (left + 1) % key.length;
    right = (right + state[left]) % key.length;
    [state[left], state[right]] = [state[right], state[left]];
    keyStream[index] = state[(state[left] + state[right]) % key.length];
  }
  const hash = qmc2Hash(key);
  return {
    decrypt(data, offset = 0) {
      const output = Buffer.from(data);
      let start = 0;
      let position = offset;
      if (position < 0x80) {
        const length = Math.min(0x80 - position, output.length);
        for (let index = 0; index < length; index += 1) {
          const absolute = position + index;
          output[index] ^= key[segmentKey(absolute, key[absolute % key.length], hash) % key.length];
        }
        start += length;
        position += length;
      }
      while (start < output.length) {
        const segmentId = Math.floor(position / 0x1400);
        const blockOffset = position % 0x1400;
        const skip = segmentKey(segmentId, key[segmentId % key.length], hash) & 0x1ff;
        const length = Math.min(0x1400 - blockOffset, output.length - start);
        for (let index = 0; index < length; index += 1) output[start + index] ^= keyStream[skip + blockOffset + index];
        start += length;
        position += length;
      }
      return output;
    },
  };
}

export function lookupQmcEkey(databasePath, ...names) {
  if (!databasePath) return null;
  const candidates = names.filter(Boolean).flatMap((name) => [basename(String(name)), String(name)]);
  if (!candidates.length) return null;
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const [table, pathColumn, keyColumn] of DB_TABLES) {
      if (!tables.has(table)) continue;
      for (const row of database.prepare(`SELECT ${pathColumn} AS path, ${keyColumn} AS ekey FROM ${table}`).iterate()) {
        if (row.path == null || row.ekey == null) continue;
        const path = String(row.path);
        if (candidates.includes(basename(path)) || candidates.some((candidate) => candidate.length >= 8 && path.includes(candidate))) {
          const found = String(row.ekey).trim();
          if (found) return found;
        }
      }
    }
  } catch {
    return null;
  } finally {
    database?.close();
  }
  return null;
}

function readExactly(file, length, position) {
  const buffer = Buffer.allocUnsafe(length);
  let total = 0;
  while (total < length) {
    const bytesRead = readSync(file, buffer, total, length - total, position + total);
    if (bytesRead === 0) throw new Error("QMC 文件被截断");
    total += bytesRead;
  }
  return buffer;
}

function sniffContainer(header) {
  if (header.subarray(0, 4).toString("ascii") === "fLaC") return "flac";
  if (header.subarray(0, 4).toString("ascii") === "OggS") return "ogg";
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE") return "wav";
  if (header.subarray(4, 8).toString("ascii") === "ftyp") return "m4a";
  if (header.subarray(0, 3).toString("ascii") === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) return "mp3";
  return "bin";
}

function inspectQmc(file, sourcePath, { ekey, ekeyDbPath }) {
  const fileLength = fstatSync(file).size;
  if (fileLength < 8) throw new Error("QMC 文件太短");
  if (V1_EXTENSIONS.has(extname(sourcePath).toLowerCase())) return { audioSize: fileLength, cipher: createQmc1Cipher(), footerKind: "QMC-v1" };
  const tailLength = Math.min(1024, fileLength);
  let footer;
  try {
    footer = parseQmcFooter(readExactly(file, tailLength, fileLength - tailLength));
  } catch (error) {
    throw new Error(`${basename(sourcePath)}：${error.message}`);
  }
  if (!footer) {
    const head = createQmc1Cipher().decrypt(readExactly(file, Math.min(64, fileLength), 0));
    if (sniffContainer(head) !== "bin") return { audioSize: fileLength, cipher: createQmc1Cipher(), footerKind: "QMC-v1-fallback" };
    throw new Error(`${basename(sourcePath)}：未找到 QMC 尾包或静态密钥特征`);
  }
  const resolvedEkey = footer.ekey || ekey || lookupQmcEkey(
    ekeyDbPath,
    basename(sourcePath),
    footer.mid,
    footer.mediaFilename,
    footer.resourceId ? String(footer.resourceId) : null,
  );
  if (!resolvedEkey) {
    const details = [footer.mid && `MID ${footer.mid}`, footer.mediaFilename && `媒体文件 ${footer.mediaFilename}`].filter(Boolean).join("，");
    throw new Error(`${basename(sourcePath)}：${footer.kind} 类型无内嵌密钥${details ? `（${details}）` : ""}。请设置 OPENKTV_QMC_EKEY_DB 指向安卓 player_process_db，或设置 OPENKTV_QMC_EKEY`);
  }
  const masterKey = deriveMasterKey(resolvedEkey);
  return {
    audioSize: fileLength - footer.size,
    cipher: masterKey.length <= 300 ? createMapCipher(masterKey) : createRc4Cipher(masterKey),
    footerKind: footer.kind,
  };
}

export function decodeQmcFile(sourcePath, outputPath, { chunkSize = 1024 * 1024, ekey = "", ekeyDbPath = "" } = {}) {
  const source = openSync(sourcePath, "r");
  let output = null;
  try {
    const { audioSize, cipher, footerKind } = inspectQmc(source, sourcePath, { ekey, ekeyDbPath });
    output = openSync(outputPath, "wx");
    let offset = 0;
    let container = "bin";
    while (offset < audioSize) {
      const length = Math.min(chunkSize, audioSize - offset);
      const decrypted = cipher.decrypt(readExactly(source, length, offset), offset);
      if (offset === 0) container = sniffContainer(decrypted.subarray(0, 64));
      writeSync(output, decrypted, 0, decrypted.length);
      offset += length;
    }
    return { bytesWritten: audioSize, container, footerKind };
  } catch (error) {
    if (output !== null) {
      closeSync(output);
      output = null;
      rmSync(outputPath, { force: true });
    }
    throw error;
  } finally {
    if (output !== null) closeSync(output);
    closeSync(source);
  }
}
