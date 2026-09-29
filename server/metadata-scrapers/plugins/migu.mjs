import { pluginAvailability, queryText, scrapeProvider, SCRAPER_USER_AGENT } from "../provider-utils.mjs";

export function createMiguPlugin({ fetchImpl = fetch, enableMigu = process.env.OPENKTV_ENABLE_MIGU === "1" } = {}) {
  const headers = { accept: "application/json", referer: "https://m.music.migu.cn/", "user-agent": SCRAPER_USER_AGENT };
  const plugin = {
    id: "migu",
    name: "咪咕音乐",
    providers: ["Migu Music"],
    mediaTypes: ["audio", "mv"],
    capabilities: ["metadata", "cover", "synced-lyrics", "mv-title-cleanup"],
    availability: pluginAvailability(enableMigu, enableMigu ? "" : "上游搜索接口当前不稳定；设置 OPENKTV_ENABLE_MIGU=1 强制启用"),
    async searchCandidates(song) {
      const url = new URL("https://m.music.migu.cn/migu/remoting/scr_search_tag");
      url.searchParams.set("rows", "10");
      url.searchParams.set("type", "2");
      url.searchParams.set("keyword", queryText(song));
      url.searchParams.set("pgc", "1");
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`咪咕音乐返回 ${response.status}`);
      if (!response.headers.get("content-type")?.includes("json")) throw new Error("咪咕搜索接口返回非 JSON，可能被上游限流或接口已变更");
      const payload = await response.json();
      return (payload.musics || []).map((item) => ({
        provider: "migu", providerId: String(item.copyrightId || item.id || ""), title: item.songName || item.name || "",
        artist: item.singerName || "", album: item.albumName || "", year: "",
        durationSeconds: Number(item.duration || item.length) || 0, coverUrl: item.cover || item.coverUrl || "",
      }));
    },
    async fetchLyrics(candidate) {
      const url = new URL("https://music.migu.cn/v3/api/music/audioPlayer/getLyric");
      url.searchParams.set("copyrightId", candidate.providerId);
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`咪咕歌词返回 ${response.status}`);
      if (!response.headers.get("content-type")?.includes("json")) throw new Error("咪咕歌词接口返回非 JSON，可能被上游限流或接口已变更");
      return (await response.json()).lyric || null;
    },
  };
  plugin.scrape = (song, options) => scrapeProvider(plugin, song, options);
  return plugin;
}
