import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { WebSocketServer } from "ws";
import { generateScoringProfile } from "./scoring.mjs";
import { lyricRegistry } from "./lyrics/registry.mjs";
export { parseLrc } from "./lyrics/plugins/lrc.mjs";

const CONTENT_TYPES = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
  ".m4v": "video/x-m4v", ".mov": "video/quicktime", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
};

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("请求内容过大");
  }
  return body ? JSON.parse(body) : {};
}

export function parseScoringProfile(content) {
  const payload = JSON.parse(content);
  if (payload?.version !== 1 || !Array.isArray(payload.notes)) throw new Error("评分谱格式无效");
  const notes = payload.notes.map((note) => ({
    start: Number(note.start),
    end: Number(note.end),
    midi: Number(note.midi),
    ...(typeof note.lyric === "string" ? { lyric: note.lyric } : {}),
    ...(["a", "b", "both"].includes(note.singer) ? { singer: note.singer } : {}),
  })).filter((note) => Number.isFinite(note.start) && Number.isFinite(note.end) && Number.isFinite(note.midi)
    && note.start >= 0 && note.end > note.start && note.midi >= 0 && note.midi <= 127)
    .sort((a, b) => a.start - b.start);
  if (!notes.length) throw new Error("评分谱没有有效音符");
  const analysis = payload.analysis && typeof payload.analysis === "object" ? {
    audioSource: payload.analysis.audioSource === "vocals" ? "vocals" : "original",
    separatorId: typeof payload.analysis.separatorId === "string" ? payload.analysis.separatorId : null,
    cachedStem: payload.analysis.cachedStem === true,
    guidedByLyrics: payload.analysis.guidedByLyrics === true,
    lyricWindows: Math.max(0, Number(payload.analysis.lyricWindows) || 0),
    ...(typeof payload.analysis.warning === "string" ? { warning: payload.analysis.warning } : {}),
  } : null;
  return { version: 1, ...(typeof payload.title === "string" ? { title: payload.title } : {}), ...(payload.generated === true ? { generated: true } : {}), ...(analysis ? { analysis } : {}), notes };
}

function serveMedia(req, res, path) {
  const size = statSync(path).size;
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { "content-type": contentType, "content-length": size, "accept-ranges": "bytes" });
    return createReadStream(path).pipe(res);
  }
  const match = range.match(/bytes=(\d*)-(\d*)/);
  if (!match) return json(res, 416, { error: "无效的 Range 请求" });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    res.writeHead(416, { "content-range": `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, {
    "content-type": contentType, "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes",
  });
  return createReadStream(path, { start, end }).pipe(res);
}

export function createKtvApp(store, { scraper = null, mediaConverters = null, stemSeparators = null } = {}) {
  const sockets = new Set();
  const websocket = new WebSocketServer({ noServer: true });
  websocket.on("connection", (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "snapshot", data: store.getSnapshot() }));
    socket.on("close", () => sockets.delete(socket));
  });

  const broadcast = (snapshot = store.getSnapshot()) => {
    const message = JSON.stringify({ type: "snapshot", data: snapshot });
    for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.send(message);
    return snapshot;
  };

  const handler = async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type,range");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const url = new URL(req.url, "http://localhost");

    try {
      if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { status: "ok", service: "openktv", time: new Date().toISOString() });
      if (req.method === "GET" && url.pathname === "/api/lyrics/plugins") return json(res, 200, { plugins: lyricRegistry.manifest() });
      if (req.method === "GET" && url.pathname === "/api/media/converters") return json(res, 200, { plugins: mediaConverters?.manifest() || [] });
      if (req.method === "GET" && url.pathname === "/api/metadata/scrapers") return json(res, 200, { plugins: scraper?.manifest?.() || [] });
      if (req.method === "GET" && url.pathname === "/api/stem-separators") return json(res, 200, { plugins: stemSeparators?.manifest?.() || [] });
      if (req.method === "POST" && url.pathname === "/api/media/convert") {
        if (!mediaConverters) return json(res, 503, { error: "媒体转换插件未配置" });
        const body = await readJson(req);
        const conversion = mediaConverters.convertDirectory(store.mediaDir, { overwrite: Boolean(body.overwrite) });
        const scan = store.scanMedia();
        const scrape = store.scrapeMetadata();
        return json(res, 200, { ...conversion, added: scan.added, scraped: scrape.updated, songs: store.listSongs() });
      }
      if (req.method === "GET" && url.pathname === "/api/songs") return json(res, 200, { songs: store.listSongs({ query: url.searchParams.get("q") || "", language: url.searchParams.get("language") || "" }) });
      if (req.method === "POST" && url.pathname === "/api/songs") return json(res, 201, { song: store.createSong(await readJson(req)) });
      if (req.method === "POST" && url.pathname === "/api/songs/scan") {
        const scan = store.scanMedia();
        const scrape = store.scrapeMetadata();
        return json(res, 200, { ...scan, scraped: scrape.updated, songs: store.listSongs() });
      }
      if (req.method === "POST" && url.pathname === "/api/songs/scrape") {
        const result = store.scrapeMetadata();
        return json(res, 200, { ...result, songs: store.listSongs() });
      }
      if (req.method === "POST" && url.pathname === "/api/songs/organize") {
        const result = store.organizeLibrary();
        return json(res, 200, { ...result, songs: store.listSongs() });
      }
      if (req.method === "POST" && url.pathname === "/api/songs/scrape/online") {
        if (!scraper) return json(res, 503, { error: "在线刮削器未配置" });
        const body = await readJson(req);
        const limit = Math.max(1, Math.min(20, Number(body.limit) || 10));
        const songs = store.songsForOnlineScrape({ limit, onlyIncomplete: body.onlyIncomplete !== false });
        const summary = { processed: 0, matched: 0, review: 0, notFound: 0, failed: 0, sourceWarnings: 0, remaining: Math.max(0, store.countOnlineScrapePending() - songs.length) };
        for (const song of songs) {
          summary.processed += 1;
          try {
            const result = await scraper.scrape(song, { fetchLyrics: body.fetchLyrics !== false, pluginId: body.pluginId });
            summary.sourceWarnings += result.sourceErrors?.length || 0;
            store.recordOnlineScrape(song.id, result, { overwrite: Boolean(body.overwrite), saveLyrics: body.fetchLyrics !== false });
            if (result.status === "matched") summary.matched += 1;
            else if (result.status === "review") summary.review += 1;
            else summary.notFound += 1;
          } catch (error) {
            summary.failed += 1;
            store.recordScrapeFailure(song.id, error instanceof Error ? error.message : "在线刮削失败");
          }
        }
        return json(res, 200, { ...summary, songs: store.listSongs() });
      }
      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, store.getSnapshot());
      if (req.method === "POST" && url.pathname === "/api/queue") {
        const body = await readJson(req);
        return json(res, 201, broadcast(store.enqueue(Number(body.songId), Boolean(body.priority))));
      }
      if (req.method === "PATCH" && url.pathname === "/api/playback") return json(res, 200, broadcast(store.updatePlayback(await readJson(req))));
      if (req.method === "POST" && url.pathname === "/api/playback/next") return json(res, 200, broadcast(store.nextSong()));
      if (req.method === "POST" && url.pathname === "/api/playback/play") {
        const body = await readJson(req);
        return json(res, 200, broadcast(store.playSong(Number(body.songId))));
      }

      const songMatch = url.pathname.match(/^\/api\/songs\/(\d+)$/);
      if (req.method === "PATCH" && songMatch) {
        const body = await readJson(req);
        const song = store.updateSong(Number(songMatch[1]), body);
        const organization = body.organize ? store.organizeSong(song.id) : null;
        return json(res, 200, { song: organization?.song || song, organization });
      }
      if (req.method === "DELETE" && songMatch) return json(res, 200, { deleted: store.deleteSong(Number(songMatch[1])), snapshot: broadcast() });
      const queueMatch = url.pathname.match(/^\/api\/queue\/(\d+)$/);
      if (req.method === "PATCH" && queueMatch) return json(res, 200, broadcast(store.moveQueueItem(Number(queueMatch[1]), (await readJson(req)).action)));
      if (req.method === "DELETE" && queueMatch) return json(res, 200, broadcast(store.removeQueueItem(Number(queueMatch[1]))));
      const mediaMatch = url.pathname.match(/^\/api\/media\/(\d+)$/);
      if (req.method === "GET" && mediaMatch) {
        const path = store.mediaForSong(Number(mediaMatch[1]));
        if (!path) return json(res, 404, { error: "歌曲没有可用媒体文件" });
        return serveMedia(req, res, path);
      }
      const lyricMatch = url.pathname.match(/^\/api\/lyrics\/(\d+)$/);
      if (req.method === "GET" && lyricMatch) {
        const path = store.lyricsForSong(Number(lyricMatch[1]));
        return path
          ? json(res, 200, lyricRegistry.parseFile(path))
          : json(res, 200, { format: null, formatName: null, displayPlugin: "traditional", lines: [] });
      }
      const scoringMatch = url.pathname.match(/^\/api\/scoring\/(\d+)$/);
      if (req.method === "GET" && scoringMatch) {
        const path = store.scoringForSong(Number(scoringMatch[1]));
        return path ? json(res, 200, { profile: parseScoringProfile(readFileSync(path, "utf8")) }) : json(res, 200, { profile: null });
      }
      const scoringGenerateMatch = url.pathname.match(/^\/api\/scoring\/(\d+)\/generate$/);
      if (req.method === "POST" && scoringGenerateMatch) {
        const songId = Number(scoringGenerateMatch[1]);
        const mediaPath = store.mediaForSong(songId);
        if (!mediaPath) return json(res, 404, { error: "歌曲没有可分析的媒体文件" });
        const body = await readJson(req);
        const lyricPath = store.lyricsForSong(songId);
        let lyricLines = [];
        let guidanceWarning = "";
        if (lyricPath) {
          try { lyricLines = lyricRegistry.parseFile(lyricPath).lines; }
          catch (error) { guidanceWarning = `歌词时间轴解析失败，未使用歌词引导：${error instanceof Error ? error.message : "未知错误"}`; }
        }
        const profile = await generateScoringProfile(mediaPath, {
          lyricLines,
          stemSeparators: body.useVocalStem === false ? null : stemSeparators,
          separatorId: typeof body.separatorId === "string" && body.separatorId ? body.separatorId : undefined,
          guidanceWarning,
        });
        writeFileSync(mediaPath.replace(/\.[^.]+$/, ".score.json"), JSON.stringify(profile, null, 2));
        return json(res, 200, { profile });
      }
      const scoringResultsMatch = url.pathname.match(/^\/api\/scoring\/(\d+)\/results$/);
      if (scoringResultsMatch && req.method === "GET") return json(res, 200, {
        results: store.scoreResults(Number(scoringResultsMatch[1]), { limit: url.searchParams.get("limit"), leaderboard: url.searchParams.get("leaderboard") === "1" }),
      });
      if (scoringResultsMatch && req.method === "POST") return json(res, 201, { result: store.recordScore(Number(scoringResultsMatch[1]), await readJson(req)) });
      return json(res, 404, { error: "接口不存在" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "请求处理失败";
      return json(res, 400, { error: message });
    }
  };

  const upgrade = (req, socket, head) => {
    if (new URL(req.url, "http://localhost").pathname !== "/ws") return socket.destroy();
    websocket.handleUpgrade(req, socket, head, (client) => websocket.emit("connection", client, req));
  };

  return { handler, upgrade, close: () => websocket.close() };
}
