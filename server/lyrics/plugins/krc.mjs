import { inflateSync } from "node:zlib";
import { normalizeLines } from "../utils.mjs";

export const KRC_XOR_KEY = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]);

export function decodeKrc(content) {
  const source = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (source.subarray(0, 4).toString("ascii") !== "krc1") return source.toString("utf8");
  const encrypted = source.subarray(4);
  const compressed = Buffer.allocUnsafe(encrypted.length);
  for (let index = 0; index < encrypted.length; index += 1) compressed[index] = encrypted[index] ^ KRC_XOR_KEY[index % KRC_XOR_KEY.length];
  return inflateSync(compressed).toString("utf8");
}

export function parseKrc(content) {
  const source = decodeKrc(content);
  const lines = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const match = rawLine.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!match) continue;
    const startMs = Number(match[1]);
    const durationMs = Number(match[2]);
    const segments = [];
    const tokenPattern = /<(\d+),(\d+),(?:\d+)>([^<]*)/g;
    let token;
    while ((token = tokenPattern.exec(match[3]))) {
      if (!token[3]) continue;
      const time = (startMs + Number(token[1])) / 1000;
      segments.push({ time, end: time + Number(token[2]) / 1000, text: token[3] });
    }
    const text = match[3].replace(/<\d+,\d+,\d+>/g, "").trim();
    if (text) lines.push({ time: startMs / 1000, end: (startMs + durationMs) / 1000, text, ...(segments.length ? { segments } : {}) });
  }
  return normalizeLines(lines);
}

export const krcPlugin = {
  id: "krc",
  name: "Kugou KRC",
  extensions: [".krc"],
  displayPlugin: "traditional",
  parse: ({ content }) => parseKrc(content),
};
