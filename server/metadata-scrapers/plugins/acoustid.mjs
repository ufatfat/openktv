import { spawnSync } from "node:child_process";
import { queryText, scrapeProvider, SCRAPER_USER_AGENT } from "../provider-utils.mjs";

function defaultFingerprint(mediaPath) {
  const result = spawnSync("fpcalc", ["-json", mediaPath], { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error(result.error.code === "ENOENT" ? "AcoustID 插件需要安装 Chromaprint/fpcalc" : result.error.message);
  if (result.status !== 0) throw new Error(result.stderr?.trim() || "音频指纹生成失败");
  return JSON.parse(result.stdout);
}

function hasFpcalc() {
  const result = spawnSync("fpcalc", ["-version"], { encoding: "utf8", timeout: 5000 });
  return !result.error && result.status === 0;
}

export function createAcoustIdPlugin({ fetchImpl = fetch, apiKey = process.env.ACOUSTID_API_KEY || "", fingerprintImpl = defaultFingerprint } = {}) {
  const customFingerprint = fingerprintImpl !== defaultFingerprint;
  const availability = () => {
    if (!apiKey) return { available: false, reason: "未配置 ACOUSTID_API_KEY" };
    if (!customFingerprint && !hasFpcalc()) return { available: false, reason: "未安装 Chromaprint/fpcalc" };
    return { available: true, reason: "" };
  };
  const plugin = {
    id: "acoustid",
    name: "AcoustID 音频指纹",
    providers: ["AcoustID", "MusicBrainz", "LRCLIB"],
    mediaTypes: ["audio", "mv"],
    capabilities: ["audio-fingerprint", "metadata", "synced-lyrics"],
    availability,
    async searchCandidates(song) {
      if (!song.mediaPath) return [];
      const fingerprint = fingerprintImpl(song.mediaPath);
      const url = new URL("https://api.acoustid.org/v2/lookup");
      url.searchParams.set("client", apiKey);
      url.searchParams.set("duration", String(Math.round(Number(fingerprint.duration) || song.durationSeconds || 0)));
      url.searchParams.set("fingerprint", fingerprint.fingerprint);
      url.searchParams.set("meta", "recordings+releasegroups+compress");
      const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": SCRAPER_USER_AGENT }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`AcoustID 返回 ${response.status}`);
      const payload = await response.json();
      return (payload.results || []).flatMap((match) => (match.recordings || []).map((recording) => {
        const release = recording.releasegroups?.[0] || {};
        return {
          provider: "acoustid", providerId: recording.id || match.id, title: recording.title || queryText(song),
          artist: (recording.artists || []).map((artist) => artist.name).filter(Boolean).join(" / "),
          album: release.title || "", year: (release.first_release_date || "").slice(0, 4),
          durationSeconds: Number(song.durationSeconds) || Math.round(Number(fingerprint.duration) || 0), coverUrl: "",
        };
      }));
    },
    async fetchLyrics(candidate) {
      const url = new URL("https://lrclib.net/api/get");
      url.searchParams.set("track_name", candidate.title);
      url.searchParams.set("artist_name", candidate.artist);
      if (candidate.album) url.searchParams.set("album_name", candidate.album);
      if (candidate.durationSeconds) url.searchParams.set("duration", String(candidate.durationSeconds));
      const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": SCRAPER_USER_AGENT }, signal: AbortSignal.timeout(10000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`LRCLIB 返回 ${response.status}`);
      return (await response.json()).syncedLyrics || null;
    },
  };
  plugin.scrape = (song, options) => scrapeProvider(plugin, song, options);
  return plugin;
}
