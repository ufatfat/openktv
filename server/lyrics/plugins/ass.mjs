import { normalizeLines, parseClockTime } from "../utils.mjs";

function cleanAssText(value) {
  return value.replace(/\\N/gi, " ").replace(/\\h/gi, " ").replace(/\{[^}]*}/g, "").trim();
}

export function parseAss(content) {
  const source = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
  const lines = [];
  for (const rawLine of source.split(/\r?\n/)) {
    if (!/^Dialogue\s*:/i.test(rawLine)) continue;
    const fields = rawLine.replace(/^Dialogue\s*:\s*/i, "").split(",");
    if (fields.length < 10) continue;
    const time = parseClockTime(fields[1]);
    const end = parseClockTime(fields[2]);
    const body = fields.slice(9).join(",");
    if (time === null) continue;
    const segments = [];
    let cursor = time;
    const karaoke = /\{[^}]*\\(?:k|K|kf|ko)(\d+)[^}]*\}([^{}]*)/g;
    let token;
    while ((token = karaoke.exec(body))) {
      const duration = Number(token[1]) / 100;
      const text = cleanAssText(token[2]);
      if (text) segments.push({ time: cursor, end: cursor + duration, text });
      cursor += duration;
    }
    const text = cleanAssText(body);
    if (text) lines.push({ time, ...(end !== null ? { end } : {}), text, ...(segments.length ? { segments } : {}) });
  }
  return normalizeLines(lines);
}

export const assPlugin = {
  id: "ass",
  name: "ASS / SSA Karaoke",
  extensions: [".ass", ".ssa"],
  displayPlugin: "traditional",
  parse: ({ content }) => parseAss(content),
};
