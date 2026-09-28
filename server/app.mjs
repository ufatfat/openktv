import { createReadStream, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { WebSocketServer } from "ws";

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

function parseLrc(content) {
  return content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
    if (!match) return [];
    const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
    return [{ time: Number(match[1]) * 60 + Number(match[2]) + fraction, text: match[4].trim() }];
  }).sort((a, b) => a.time - b.time);
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

export function createKtvApp(store) {
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
        return path ? json(res, 200, { lines: parseLrc(readFileSync(path, "utf8")) }) : json(res, 200, { lines: [] });
      }
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
