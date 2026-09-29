import { applyFetchedLyrics, pluginAvailability, queryText, scrapeProvider, SCRAPER_USER_AGENT } from "../provider-utils.mjs";
import { decodeQrc } from "../../lyrics/plugins/qrc.mjs";

const LYRIC_ENDPOINT = "https://u.y.qq.com/cgi-bin/musicu.fcg";

function lyricPayload(candidate) {
  return {
    comm: { ct: 19, cv: 0, tmeAppID: "qqmusiclight" },
    req_0: {
      module: "music.musichallSong.PlayLyricInfo", method: "GetPlayLyricInfo",
      param: {
        songMID: candidate.providerId, songID: 0, platform: 0, needNew: 1,
        crypt: 1, qrc: 1, roma: 1, trans: 1,
      },
    },
  };
}

function searchPayload(query) {
  return {
    comm: {
      wid: "", tmeAppID: "qqmusic", authst: "", uid: "", gray: "0",
      OpenUDID: "2d484d3157d4ed482e406e6c5fdcf8c3d3275deb", ct: "6", patch: "2",
      psrf_qqopenid: "", sid: "", psrf_access_token_expiresAt: "", cv: "80600",
      gzip: "0", qq: "", nettype: "2", psrf_qqunionid: "", psrf_qqaccess_token: "", tmeLoginType: "2",
    },
    "music.search.SearchCgiService.DoSearchForQQMusicDesktop": {
      module: "music.search.SearchCgiService", method: "DoSearchForQQMusicDesktop",
      param: {
        query, num_per_page: 10, page_num: 1, remoteplace: "txt.mac.search",
        search_type: 0, grp: 1, searchid: crypto.randomUUID(), nqc_flag: 0,
      },
    },
  };
}

export function createQqMusicPlugin({ fetchImpl = fetch } = {}) {
  const plugin = {
    id: "qqmusic",
    name: "QQ 音乐",
    providers: ["QQ Music"],
    mediaTypes: ["audio", "mv"],
    capabilities: ["metadata", "cover", "synced-lyrics", "word-timed-qrc", "mv-title-cleanup"],
    availability: pluginAvailability(),
    async searchCandidates(song) {
      const response = await fetchImpl("https://u.y.qq.com/cgi-bin/musicu.fcg", {
        method: "POST", headers: {
          accept: "application/json", "content-type": "application/json;charset=utf-8",
          referer: "https://y.qq.com/portal/profile.html", "user-agent": "Mozilla/5.0",
        },
        body: JSON.stringify(searchPayload(queryText(song))), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`QQ 音乐返回 ${response.status}`);
      const payload = await response.json();
      const section = payload["music.search.SearchCgiService.DoSearchForQQMusicDesktop"];
      if (section?.code && section.code !== 0) throw new Error(`QQ 音乐搜索暂不可用（${section.code}）`);
      const songs = section?.data?.body?.song?.list || section?.data?.song?.list || [];
      return songs.map((item) => ({
        provider: "qqmusic", providerId: item.mid || item.songmid || String(item.id || ""), title: item.title || item.name || "",
        artist: (item.singer || []).map((artist) => artist.name).filter(Boolean).join(" / "),
        album: item.album?.name || "", year: (item.time_public || "").slice(0, 4),
        durationSeconds: Number(item.interval) || 0,
        coverUrl: item.album?.mid ? `https://y.qq.com/music/photo_new/T002R300x300M000${item.album.mid}.jpg` : "",
      }));
    },
    async fetchLrc(candidate) {
      const url = new URL("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg");
      url.searchParams.set("format", "json");
      url.searchParams.set("platform", "h5");
      url.searchParams.set("songmid", candidate.providerId);
      const response = await fetchImpl(url, { headers: { accept: "application/json", referer: "https://y.qq.com/", "user-agent": SCRAPER_USER_AGENT }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`QQ 音乐歌词返回 ${response.status}`);
      const payload = await response.json();
      const content = payload.lyric ? Buffer.from(payload.lyric, "base64").toString("utf8") : null;
      return content ? { content, format: "lrc" } : null;
    },
    async fetchLyrics(candidate) {
      try {
        const response = await fetchImpl(LYRIC_ENDPOINT, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json;charset=utf-8", referer: "https://y.qq.com/", "user-agent": SCRAPER_USER_AGENT },
          body: JSON.stringify(lyricPayload(candidate)), signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`QQ 音乐逐字歌词返回 ${response.status}`);
        const section = (await response.json()).req_0;
        if (section?.code && section.code !== 0) throw new Error(`QQ 音乐逐字歌词暂不可用（${section.code}）`);
        const data = section?.data;
        if (data?.qrc === 1 && data.lyric) return { content: decodeQrc(data.lyric), format: "qrc" };
      } catch {
        // The legacy endpoint remains a useful fallback when the richer endpoint is unavailable.
      }
      return plugin.fetchLrc(candidate);
    },
  };
  plugin.scrape = async (song, options = {}) => {
    if (song.metadataSource === "qqmusic" && song.metadataId) {
      const candidate = {
        provider: "qqmusic", providerId: song.metadataId, title: song.title, artist: song.artist,
        album: song.album || "", year: song.releaseYear || "", durationSeconds: song.durationSeconds || 0,
        score: { total: 1 },
      };
      if (options.fetchLyrics !== false) {
        try { applyFetchedLyrics(candidate, await plugin.fetchLyrics(candidate, options)); }
        catch (error) { candidate.lyricsError = error instanceof Error ? error.message : "歌词获取失败"; }
      }
      return { status: "matched", candidate, candidates: [candidate] };
    }
    return scrapeProvider(plugin, song, options);
  };
  return plugin;
}
