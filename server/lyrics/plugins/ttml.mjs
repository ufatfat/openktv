import { decodeEntities, normalizeLines, parseClockTime, stripMarkup } from "../utils.mjs";

function attribute(source, name) {
  return source.match(new RegExp(`(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
}

export function parseTtml(content) {
  const source = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
  const lines = [];
  const paragraphPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let paragraph;
  while ((paragraph = paragraphPattern.exec(source))) {
    const time = parseClockTime(attribute(paragraph[1], "begin"));
    if (time === null) continue;
    const explicitEnd = parseClockTime(attribute(paragraph[1], "end"));
    const duration = parseClockTime(attribute(paragraph[1], "dur"));
    const end = explicitEnd ?? (duration !== null ? time + duration : null);
    const segments = [];
    const spanPattern = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
    let span;
    while ((span = spanPattern.exec(paragraph[2]))) {
      let segmentTime = parseClockTime(attribute(span[1], "begin"));
      if (segmentTime === null) continue;
      if (segmentTime < time && /^(?:\d+(?:\.\d+)?(?:ms|s|m|h))$/i.test(attribute(span[1], "begin") || "")) segmentTime += time;
      let segmentEnd = parseClockTime(attribute(span[1], "end"));
      const segmentDuration = parseClockTime(attribute(span[1], "dur"));
      if (segmentEnd === null && segmentDuration !== null) segmentEnd = segmentTime + segmentDuration;
      const text = stripMarkup(span[2]);
      if (text) segments.push({ time: segmentTime, ...(segmentEnd !== null ? { end: segmentEnd } : {}), text: decodeEntities(text) });
    }
    const text = stripMarkup(paragraph[2]);
    if (text) lines.push({ time, ...(end !== null ? { end } : {}), text, ...(segments.length ? { segments } : {}) });
  }
  return normalizeLines(lines);
}

export const ttmlPlugin = {
  id: "ttml",
  name: "TTML / DFXP",
  extensions: [".ttml", ".dfxp", ".xml"],
  displayPlugin: "traditional",
  parse: ({ content }) => parseTtml(content),
};
