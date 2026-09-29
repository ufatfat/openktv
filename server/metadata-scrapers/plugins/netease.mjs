import { pluginAvailability, queryText, scrapeProvider, SCRAPER_USER_AGENT } from "../provider-utils.mjs";

export function createNeteasePlugin({ fetchImpl = fetch } = {}) {
  const plugin = {
    id: "netease",
    name: "网易云音乐",
    providers: ["NetEase Cloud Music"],
    mediaTypes: ["audio", "mv"],
    capabilities: ["metadata", "cover", "synced-lyrics", "mv-title-cleanup"],
    availability: pluginAvailability(),
    async searchCandidates(song) {
      const url = new URL("https://music.163.com/api/search/get");
      url.searchParams.set("s", queryText(song));
      url.searchParams.set("type", "1");
      url.searchParams.set("limit", "10");
      url.searchParams.set("offset", "0");
      const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": SCRAPER_USER_AGENT }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`网易云音乐返回 ${response.status}`);
      const payload = await response.json();
      return (payload.result?.songs || []).map((item) => ({
        provider: "netease", providerId: String(item.id), title: item.name || "",
        artist: (item.artists || item.ar || []).map((artist) => artist.name).filter(Boolean).join(" / "),
        album: item.album?.name || item.al?.name || "",
        year: item.publishTime ? new Date(item.publishTime).getUTCFullYear().toString() : "",
        durationSeconds: Math.round((Number(item.duration || item.dt) || 0) / 1000),
        coverUrl: item.album?.picUrl || item.al?.picUrl || "",
      }));
    },
    async fetchLyrics(candidate) {
      const url = new URL("https://music.163.com/api/song/lyric");
      url.searchParams.set("id", candidate.providerId);
      url.searchParams.set("lv", "1");
      url.searchParams.set("kv", "1");
      url.searchParams.set("tv", "-1");
      const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": SCRAPER_USER_AGENT }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`网易云歌词返回 ${response.status}`);
      const payload = await response.json();
      return payload.lrc?.lyric || payload.klyric?.lyric || null;
    },
  };
  plugin.scrape = (song, options) => scrapeProvider(plugin, song, options);
  return plugin;
}
