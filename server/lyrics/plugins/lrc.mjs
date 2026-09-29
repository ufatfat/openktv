import { normalizeLines, timestampToSeconds } from "../utils.mjs";

const LINE_TIME = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIME = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;

export function parseLrc(content) {
  const source = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
  const offset = Number(source.match(/^\[offset:([+-]?\d+)\]/im)?.[1] || 0) / 1000;
  const lines = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(LINE_TIME)];
    if (!timestamps.length || timestamps[0].index !== 0) continue;
    const body = rawLine.slice(timestamps.at(-1).index + timestamps.at(-1)[0].length).trim();
    const text = body.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "").trim();
    if (!text) continue;
    for (const stamp of timestamps) {
      WORD_TIME.lastIndex = 0;
      const segments = [];
      let segment;
      while ((segment = WORD_TIME.exec(body))) {
        if (!segment[4]) continue;
        segments.push({ time: Math.max(0, timestampToSeconds(segment[1], segment[2], segment[3]) + offset), text: segment[4] });
      }
      lines.push({
        time: Math.max(0, timestampToSeconds(stamp[1], stamp[2], stamp[3]) + offset),
        text,
        ...(segments.length ? { segments } : {}),
      });
    }
  }
  return normalizeLines(lines);
}

export const lrcPlugin = {
  id: "lrc",
  name: "LRC / Enhanced LRC",
  extensions: [".lrc", ".elrc"],
  displayPlugin: "traditional",
  parse: ({ content }) => parseLrc(content),
};
