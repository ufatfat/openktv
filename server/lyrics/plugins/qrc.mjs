import { inflateRawSync, inflateSync } from "node:zlib";
import { normalizeLines, decodeEntities } from "../utils.mjs";
import { parseLrc } from "./lrc.mjs";
import { createSchedule, DECRYPT, tripleDESCrypt, tripleDESKeySetup } from "../vendor/qrc-des.mjs";

const QRC_KEY = Buffer.from("!@#)(*$%123ZXC!@!@#)(NHL", "ascii");

function looksLikePlainQrc(value) {
  return /LyricContent\s*=|\[\d+\s*,\s*\d+\]|^\[(?:ti|ar|al|offset):/im.test(value);
}

function inflatePayload(value) {
  try { return inflateSync(value); }
  catch (error) {
    try { return inflateRawSync(value); }
    catch { throw error; }
  }
}

function decryptCandidate(value) {
  const schedule = createSchedule();
  tripleDESKeySetup(QRC_KEY, schedule, DECRYPT);
  const decrypted = Buffer.alloc(value.length);
  for (let offset = 0; offset < value.length; offset += 8) {
    const input = Buffer.alloc(8);
    const output = Buffer.alloc(8);
    value.copy(input, 0, offset, Math.min(offset + 8, value.length));
    tripleDESCrypt(input, output, schedule);
    output.copy(decrypted, offset, 0, Math.min(8, value.length - offset));
  }
  return inflatePayload(decrypted).toString("utf8");
}

function decodeQmcMask(value) {
  const seedMap = [
    [0x4a,0xd6,0xca,0x90,0x67,0xf7,0x52], [0x5e,0x95,0x23,0x9f,0x13,0x11,0x7e],
    [0x47,0x74,0x3d,0x90,0xaa,0x3f,0x51], [0xc6,0x09,0xd5,0x9f,0xfa,0x66,0xf9],
    [0xf3,0xd6,0xa1,0x90,0xa0,0xf7,0xf0], [0x1d,0x95,0xde,0x9f,0x84,0x11,0xf4],
    [0x0e,0x74,0xbb,0x90,0xbc,0x3f,0x92], [0x00,0x09,0x5b,0x9f,0x62,0x66,0xa1],
  ];
  let x = -1; let y = 8; let direction = 1; let index = -1;
  const output = Buffer.alloc(value.length);
  const nextMask = () => {
    index += 1;
    let mask;
    if (x < 0) { direction = 1; y = (8 - y) % 8; mask = 0xc3; }
    else if (x > 6) { direction = -1; y = 7 - y; mask = 0xd8; }
    else mask = seedMap[y][x];
    x += direction;
    if (index === 0x8000 || (index > 0x8000 && (index + 1) % 0x8000 === 0)) return nextMask();
    return mask;
  };
  for (let offset = 0; offset < value.length; offset += 1) output[offset] = value[offset] ^ nextMask();
  return output;
}

function decryptPcQrc(value) {
  const decoded = decodeQmcMask(value);
  const lineEnd = decoded.indexOf(0x0a);
  if (lineEnd < 0 || !/^\[offset:-?\d+]$/.test(decoded.subarray(0, lineEnd).toString("utf8").trim())) return null;
  return decryptCandidate(decoded.subarray(lineEnd + 1));
}

function encryptedCandidates(value) {
  const candidates = [];
  const maxOffset = Math.min(512, Math.max(0, value.length - 8));
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const length = Math.floor((value.length - offset) / 8) * 8;
    if (length >= 8) candidates.push(value.subarray(offset, offset + length));
  }
  return candidates;
}

export function decodeQrc(content) {
  const source = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  const text = source.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (looksLikePlainQrc(text)) return text;

  const compact = text.replace(/\s+/g, "");
  const encrypted = /^[\da-f]+$/i.test(compact) && compact.length % 2 === 0 ? Buffer.from(compact, "hex") : source;
  if (Buffer.isBuffer(content)) {
    try {
      const local = decryptPcQrc(encrypted);
      if (local && looksLikePlainQrc(local)) return local;
    } catch { /* try raw encrypted variants */ }
  }
  for (const candidate of encryptedCandidates(encrypted)) {
    try {
      const decoded = decryptCandidate(candidate);
      if (looksLikePlainQrc(decoded)) return decoded;
    } catch { /* candidate may include a binary wrapper */ }
  }
  throw new Error("QRC 解密失败：不支持的文件变体或文件已损坏");
}

function lyricPayloads(source) {
  const matches = [...source.matchAll(/LyricContent\s*=\s*(["'])([\s\S]*?)\1/gi)];
  return matches.length ? matches.map((match) => decodeEntities(match[2])) : [source];
}

function parseQrcPayload(source) {
  const offsetMs = Number(source.match(/^\[offset:([+-]?\d+)\]/im)?.[1] || 0);
  const headers = [...source.matchAll(/\[(\d+)\s*,\s*(\d+)\]/g)];
  const lines = [];
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    const next = headers[index + 1];
    const lineStart = Math.max(0, Number(header[1]) + offsetMs);
    const duration = Number(header[2]);
    const body = source.slice(header.index + header[0].length, next?.index ?? source.length).replace(/^[\r\n]+|[\r\n]+$/g, "");
    const segments = [];
    const wordPattern = /([\s\S]*?)\((\d+)\s*,\s*(\d+)\)/g;
    let word;
    while ((word = wordPattern.exec(body))) {
      if (!word[1]) continue;
      const time = Math.max(0, Number(word[2]) + offsetMs) / 1000;
      segments.push({ time, end: time + Number(word[3]) / 1000, text: word[1] });
    }
    const text = segments.length ? segments.map((segment) => segment.text).join("") : body.replace(/\(\d+\s*,\s*\d+\)/g, "").trim();
    if (text) lines.push({ time: lineStart / 1000, end: (lineStart + duration) / 1000, text, ...(segments.length ? { segments } : {}) });
  }
  return lines;
}

export function parseQrc(content) {
  const source = decodeQrc(content);
  const lines = normalizeLines(lyricPayloads(source).flatMap(parseQrcPayload));
  if (lines.length) return lines;
  const lrcLines = parseLrc(source);
  if (lrcLines.length) return lrcLines;
  throw new Error("QRC 文件中没有有效的同步歌词");
}

export const qrcPlugin = {
  id: "qrc",
  name: "QQ Music QRC",
  extensions: [".qrc", ".qm.qrc"],
  displayPlugin: "traditional",
  parse: ({ content }) => parseQrc(content),
};
