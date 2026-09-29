import { cleanMediaTitle, scoreCandidate } from "../metadata.mjs";

export const SCRAPER_USER_AGENT = "OpenKTV/0.1 (local metadata scraper)";

export function queryText(song) {
  const title = cleanMediaTitle(song.title, song.mediaType) || song.title;
  return song.artist && song.artist !== "未知歌手" ? `${title} ${song.artist}` : title;
}

export function detectLyricsLanguage(lyrics = "") {
  const counts = {
    中文: (lyrics.match(/[\u4e00-\u9fff]/g) || []).length,
    日文: (lyrics.match(/[\u3040-\u30ff]/g) || []).length,
    韩文: (lyrics.match(/[\uac00-\ud7af]/g) || []).length,
    英文: (lyrics.match(/[a-z]/gi) || []).length,
  };
  const [language, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? language : "";
}

export function applyFetchedLyrics(candidate, fetched) {
  if (!fetched) return;
  const content = typeof fetched === "string" ? fetched : fetched.content;
  if (!content) return;
  candidate.syncedLyrics = content;
  candidate.lyricsFormat = typeof fetched === "string" ? "lrc" : fetched.format || "lrc";
  candidate.language = detectLyricsLanguage(content);
}

export function rankCandidates(song, candidates) {
  return candidates
    .filter((candidate) => candidate?.title)
    .map((candidate) => ({ ...candidate, score: candidate.score || scoreCandidate(song, candidate) }))
    .sort((left, right) => right.score.total - left.score.total);
}

export function matchResult(candidates) {
  const best = candidates[0] || null;
  if (!best) return { status: "not_found", candidate: null, candidates: [] };
  const status = best.score.total >= 0.78 ? "matched" : best.score.total >= 0.58 ? "review" : "not_found";
  return { status, candidate: best, candidates: candidates.slice(0, 15) };
}

export async function scrapeProvider(plugin, song, options = {}) {
  const ranked = rankCandidates(song, await plugin.searchCandidates(song, options));
  const result = matchResult(ranked);
  if (result.status === "matched" && options.fetchLyrics !== false && typeof plugin.fetchLyrics === "function") {
    try {
      applyFetchedLyrics(result.candidate, await plugin.fetchLyrics(result.candidate, options));
    } catch (error) {
      result.candidate.lyricsError = error instanceof Error ? error.message : "歌词获取失败";
    }
  }
  return result;
}

export function pluginAvailability(available = true, reason = "") {
  return () => ({ available, reason });
}
