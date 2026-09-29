import { normalizeLines, parseClockTime, stripMarkup } from "../utils.mjs";

export function parseSubtitle(content) {
  const source = (Buffer.isBuffer(content) ? content.toString("utf8") : String(content)).replace(/^\uFEFF/, "");
  const blocks = source.replace(/^WEBVTT[^\n]*\n/i, "").split(/\r?\n\s*\r?\n/);
  const lines = [];
  for (const block of blocks) {
    const rows = block.split(/\r?\n/).filter(Boolean);
    const timingIndex = rows.findIndex((row) => row.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = rows[timingIndex].match(/([^\s]+)\s*-->\s*([^\s]+)/);
    if (!timing) continue;
    const time = parseClockTime(timing[1]);
    const end = parseClockTime(timing[2]);
    const text = stripMarkup(rows.slice(timingIndex + 1).join(" "));
    if (time !== null && text) lines.push({ time, ...(end !== null ? { end } : {}), text });
  }
  return normalizeLines(lines);
}

export const subtitlePlugin = {
  id: "subtitle",
  name: "SRT / WebVTT",
  extensions: [".srt", ".vtt"],
  displayPlugin: "traditional",
  parse: ({ content }) => parseSubtitle(content),
};
