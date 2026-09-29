export function timestampToSeconds(minutes, seconds, fraction = "") {
  return Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0);
}

export function parseClockTime(value) {
  const input = String(value || "").trim();
  if (!input) return null;
  const unit = input.match(/^(-?\d+(?:\.\d+)?)(ms|s|m|h)$/i);
  if (unit) {
    const factor = { ms: 0.001, s: 1, m: 60, h: 3600 }[unit[2].toLowerCase()];
    return Number(unit[1]) * factor;
  }
  const parts = input.replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

export function decodeEntities(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

export function stripMarkup(value) {
  return decodeEntities(String(value || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")).replace(/\s*\n\s*/g, " ").trim();
}

export function normalizeLines(lines) {
  return lines
    .filter((line) => Number.isFinite(line.time) && line.time >= 0 && String(line.text || "").trim())
    .map((line) => ({
      ...line,
      time: Number(line.time),
      text: String(line.text).trim(),
      ...(Number.isFinite(line.end) && line.end > line.time ? { end: Number(line.end) } : {}),
      ...(line.segments?.length ? {
        segments: line.segments
          .filter((segment) => Number.isFinite(segment.time) && String(segment.text || ""))
          .map((segment) => ({
            ...segment,
            time: Number(segment.time),
            text: String(segment.text),
            ...(Number.isFinite(segment.end) && segment.end > segment.time ? { end: Number(segment.end) } : {}),
          }))
          .sort((a, b) => a.time - b.time),
      } : {}),
    }))
    .sort((a, b) => a.time - b.time);
}
