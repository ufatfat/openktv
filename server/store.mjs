import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { findLyricSidecar, lyricFormatForPath } from "./lyrics/registry.mjs";

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".m4v", ".mov"]);
const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ".mp3", ".m4a", ".wav", ".ogg", ".flac"]);

function now() {
  return new Date().toISOString();
}

function createDemoWave(filePath) {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  const sampleRate = 44100;
  const duration = 12;
  const samples = sampleRate * duration;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  const notes = [261.63, 329.63, 392, 523.25];
  for (let i = 0; i < samples; i += 1) {
    const second = i / sampleRate;
    const frequency = notes[Math.floor(second / 1.5) % notes.length];
    const envelope = Math.min(1, (second % 1.5) * 8, (1.5 - (second % 1.5)) * 5);
    const value = Math.sin(2 * Math.PI * frequency * second) * 0.18 * Math.max(0, envelope);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  writeFileSync(filePath, buffer);
}

function scanFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
    }
  };
  visit(root);
  return files;
}

function cleanName(value = "") {
  return value
    .replace(/[\[【（(]\s*(?:mv|official(?:\s+(?:mv|video|music\s+video))?|music\s+video|video|lyric(?:s)?\s+video|visualizer|伴奏|原唱|高清|超清|官方\s*mv|官方音乐(?:录像|录影)带|完整版|中字|中文字幕|4k|8k|hd|full\s+hd|\d{3,4}p)\s*[\]】）)]/gi, " ")
    .replace(/\s*[-–—|·]\s*(?:official(?:\s+(?:mv|video|music\s+video))?|music\s+video|mv|video|lyric(?:s)?\s+video|visualizer|官方\s*mv|官方音乐(?:录像|录影)带|4k|8k|hd|\d{3,4}p)\s*$/gi, "")
    .replaceAll(/[_]+/g, " ").replaceAll(/\s+/g, " ").trim();
}

function metadataFromFilename(path, mediaRoot = null) {
  const stem = cleanName(basename(path, extname(path)));
  const hierarchy = mediaRoot ? relative(mediaRoot, path).split(/[\\/]+/) : [];
  const hierarchyMetadata = hierarchy.length >= 3
    ? { artist: cleanName(hierarchy.at(-3)), album: cleanName(hierarchy.at(-2)) }
    : {};
  if (hierarchyMetadata.artist && hierarchyMetadata.album) {
    return { title: stem || "未命名歌曲", ...hierarchyMetadata };
  }
  const parts = stem.split(/\s+-\s+|\s+–\s+/).map(cleanName).filter(Boolean);
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(" - ") };
  const compactParts = stem.match(/^(.+?)\s*[-–—]\s*(.+)$/u);
  if (compactParts) return { artist: cleanName(compactParts[1]), title: cleanName(compactParts[2]) };
  const folder = cleanName(basename(dirname(path)));
  return { title: stem || "未命名歌曲", artist: folder && folder !== "media" ? folder : "未知歌手" };
}

function defaultProbeMedia(path) {
  const result = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], { encoding: "utf8", timeout: 15000 });
  if (result.error || result.status !== 0 || !result.stdout) return {};
  try {
    const payload = JSON.parse(result.stdout);
    const audioTags = payload.streams?.find((stream) => stream.codec_type === "audio")?.tags || {};
    const videoTags = payload.streams?.find((stream) => stream.codec_type === "video")?.tags || {};
    const tags = { ...audioTags, ...videoTags, ...(payload.format?.tags || {}) };
    const normalized = Object.fromEntries(Object.entries(tags).map(([key, value]) => [key.toLowerCase(), String(value)]));
    const releaseDate = normalized.date || normalized.year || normalized.release_date || "";
    return {
      title: normalized.title,
      artist: normalized.artist || normalized.album_artist || normalized.author || normalized.performer,
      album: normalized.album,
      year: releaseDate.match(/\d{4}/)?.[0],
      language: normalized.language,
      category: normalized.genre,
      durationSeconds: Math.round(Number(payload.format?.duration) || 0),
    };
  } catch {
    return {};
  }
}

function mediaType(path) {
  return VIDEO_EXTENSIONS.has(extname(path).toLowerCase()) ? "mv" : "audio";
}

function safePathSegment(value, fallback) {
  const cleaned = String(value || "").normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[.\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned.slice(0, 120);
}

export class KtvStore {
  constructor({ dbPath, mediaDir, probeMedia = defaultProbeMedia }) {
    this.mediaDir = resolve(mediaDir);
    this.probeMedia = probeMedia;
    mkdirSync(dirname(dbPath), { recursive: true });
    mkdirSync(this.mediaDir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
    this.seed();
    this.repairMovedMediaPaths();
  }

  repairMovedMediaPaths() {
    const relocate = (path) => {
      if (!path || existsSync(path)) return path;
      const parts = path.split(/[\\/]+/);
      const mediaIndex = parts.lastIndexOf("media");
      const candidates = [];
      if (mediaIndex >= 0 && mediaIndex < parts.length - 1) candidates.push(join(this.mediaDir, ...parts.slice(mediaIndex + 1)));
      candidates.push(join(this.mediaDir, basename(path)));
      return candidates.find((candidate) => existsSync(candidate)) || path;
    };
    const rows = this.db.prepare("SELECT id, media_path, lyric_path FROM songs WHERE media_path IS NOT NULL OR lyric_path IS NOT NULL").all();
    const update = this.db.prepare("UPDATE songs SET media_path = ?, lyric_path = ? WHERE id = ?");
    for (const song of rows) {
      const mediaPath = relocate(song.media_path);
      const lyricPath = relocate(song.lyric_path);
      if (mediaPath !== song.media_path || lyricPath !== song.lyric_path) update.run(mediaPath, lyricPath, song.id);
    }
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '未知歌手',
        language TEXT NOT NULL DEFAULT '其他',
        category TEXT NOT NULL DEFAULT '本地曲库',
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        media_path TEXT,
        lyric_path TEXT,
        media_type TEXT NOT NULL DEFAULT 'audio',
        metadata_source TEXT NOT NULL DEFAULT 'manual',
        scraped_at TEXT,
        album TEXT NOT NULL DEFAULT '',
        release_year TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        metadata_id TEXT,
        match_score REAL,
        scrape_status TEXT NOT NULL DEFAULT 'local',
        scrape_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS songs_media_path_unique ON songs(media_path) WHERE media_path IS NOT NULL;
      CREATE TABLE IF NOT EXISTS queue_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playback_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'paused',
        position_seconds REAL NOT NULL DEFAULT 0,
        volume INTEGER NOT NULL DEFAULT 80,
        muted INTEGER NOT NULL DEFAULT 0,
        vocal_mode TEXT NOT NULL DEFAULT 'accompaniment',
        pitch INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS score_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        singer_name TEXT NOT NULL,
        score INTEGER NOT NULL,
        pitch_score INTEGER NOT NULL,
        rhythm_score INTEGER NOT NULL,
        stability_score INTEGER NOT NULL,
        completion INTEGER NOT NULL,
        max_combo INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO playback_state (id, updated_at) VALUES (1, '${now()}');
    `);
    const columns = new Set(this.db.prepare("PRAGMA table_info(songs)").all().map((column) => column.name));
    if (!columns.has("media_type")) this.db.exec("ALTER TABLE songs ADD COLUMN media_type TEXT NOT NULL DEFAULT 'audio'");
    if (!columns.has("metadata_source")) this.db.exec("ALTER TABLE songs ADD COLUMN metadata_source TEXT NOT NULL DEFAULT 'manual'");
    if (!columns.has("scraped_at")) this.db.exec("ALTER TABLE songs ADD COLUMN scraped_at TEXT");
    if (!columns.has("album")) this.db.exec("ALTER TABLE songs ADD COLUMN album TEXT NOT NULL DEFAULT ''");
    if (!columns.has("release_year")) this.db.exec("ALTER TABLE songs ADD COLUMN release_year TEXT NOT NULL DEFAULT ''");
    if (!columns.has("cover_url")) this.db.exec("ALTER TABLE songs ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''");
    if (!columns.has("metadata_id")) this.db.exec("ALTER TABLE songs ADD COLUMN metadata_id TEXT");
    if (!columns.has("match_score")) this.db.exec("ALTER TABLE songs ADD COLUMN match_score REAL");
    if (!columns.has("scrape_status")) this.db.exec("ALTER TABLE songs ADD COLUMN scrape_status TEXT NOT NULL DEFAULT 'local'");
    if (!columns.has("scrape_note")) this.db.exec("ALTER TABLE songs ADD COLUMN scrape_note TEXT NOT NULL DEFAULT ''");
  }

  seed() {
    const demoPath = join(this.mediaDir, "system-check.wav");
    const lyricPath = join(this.mediaDir, "system-check.lrc");
    const scorePath = join(this.mediaDir, "system-check.score.json");
    createDemoWave(demoPath);
    if (!existsSync(lyricPath)) writeFileSync(lyricPath, "[00:00.00]OpenKTV 系统试音\n[00:03.00]播放器与声音输出正常\n[00:06.00]现在可以导入你的本地曲库\n[00:09.00]准备好，开始唱吧\n");
    if (!existsSync(scorePath)) writeFileSync(scorePath, JSON.stringify({
      version: 1,
      title: "系统试音评分谱",
      notes: Array.from({ length: 8 }, (_, index) => ({
        start: index * 1.5,
        end: index * 1.5 + 1.35,
        midi: [60, 64, 67, 72][index % 4],
      })),
    }, null, 2));
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM songs").get().count;
    if (count > 0) return;
    const insert = this.db.prepare("INSERT INTO songs (title, artist, language, category, duration_seconds, media_path, lyric_path, media_type, metadata_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("系统试音", "OpenKTV", "其他", "系统", 12, demoPath, lyricPath, "audio", "system", now());
    const demos = [
      ["晚风来信", "林屿", "国语", "流行"], ["沿海公路", "沈星", "国语", "轻快"],
      ["玻璃晴朗", "Nine Days", "粤语", "经典"], ["心跳失真", "NOVA", "国语", "摇滚"],
    ];
    for (const song of demos) insert.run(song[0], song[1], song[2], song[3], 0, null, null, "audio", "demo", now());
    this.db.prepare("UPDATE playback_state SET current_song_id = 1 WHERE id = 1").run();
  }

  normalizeMediaPath(input) {
    if (!input) return null;
    const path = resolve(isAbsolute(input) ? input : join(this.mediaDir, input));
    const rel = relative(this.mediaDir, path);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("媒体文件必须位于配置的媒体目录中");
    return path;
  }

  listSongs({ query = "", language = "" } = {}) {
    const q = `%${query.trim()}%`;
    return this.db.prepare(`
      SELECT id, title, artist, language, category, duration_seconds AS durationSeconds,
             media_path AS mediaPath, lyric_path AS lyricPath, media_type AS mediaType,
             metadata_source AS metadataSource, scraped_at AS scrapedAt,
             album, release_year AS releaseYear, cover_url AS coverUrl,
             metadata_id AS metadataId, match_score AS matchScore,
             scrape_status AS scrapeStatus, scrape_note AS scrapeNote,
             CASE WHEN lyric_path IS NOT NULL THEN 1 ELSE 0 END AS hasLyrics,
             CASE WHEN media_path IS NOT NULL THEN 1 ELSE 0 END AS playable
      FROM songs
      WHERE (? = '' OR title LIKE ? OR artist LIKE ?)
        AND (? = '' OR language = ? OR category = ?)
      ORDER BY playable DESC, id DESC
    `).all(query.trim(), q, q, language, language, language).map((song) => ({
      ...song,
      playable: Boolean(song.mediaPath && existsSync(song.mediaPath)),
      hasLyrics: Boolean(song.lyricPath && existsSync(song.lyricPath)),
      lyricFormat: lyricFormatForPath(song.lyricPath),
      hasScore: Boolean(this.scoringForSong(song.id)),
    }));
  }

  getSong(id) {
    return this.db.prepare("SELECT * FROM songs WHERE id = ?").get(id);
  }

  scoringForSong(id) {
    const song = this.getSong(id);
    if (!song?.media_path) return null;
    const path = song.media_path.replace(/\.[^.]+$/, ".score.json");
    return existsSync(path) ? path : null;
  }

  recordScore(songId, input) {
    if (!this.getSong(songId)) throw new Error("歌曲不存在");
    const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const singerName = String(input.singerName || "欢唱者").trim().slice(0, 30) || "欢唱者";
    const result = this.db.prepare(`INSERT INTO score_results
      (song_id, singer_name, score, pitch_score, rhythm_score, stability_score, completion, max_combo, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      songId, singerName, clamp(input.score), clamp(input.pitchScore), clamp(input.rhythmScore),
      clamp(input.stabilityScore), clamp(input.completion), Math.max(0, Math.round(Number(input.maxCombo) || 0)), now(),
    );
    return this.db.prepare(`SELECT id, song_id AS songId, singer_name AS singerName, score,
      pitch_score AS pitchScore, rhythm_score AS rhythmScore, stability_score AS stabilityScore,
      completion, max_combo AS maxCombo, created_at AS createdAt FROM score_results WHERE id = ?`).get(Number(result.lastInsertRowid));
  }

  scoreResults(songId, { limit = 20, leaderboard = false } = {}) {
    const order = leaderboard ? "score DESC, created_at ASC" : "created_at DESC";
    return this.db.prepare(`SELECT id, song_id AS songId, singer_name AS singerName, score,
      pitch_score AS pitchScore, rhythm_score AS rhythmScore, stability_score AS stabilityScore,
      completion, max_combo AS maxCombo, created_at AS createdAt
      FROM score_results WHERE song_id = ? ORDER BY ${order} LIMIT ?`).all(songId, Math.max(1, Math.min(100, Number(limit) || 20)));
  }

  createSong(input) {
    if (!input.title?.trim()) throw new Error("歌名不能为空");
    const mediaPath = this.normalizeMediaPath(input.mediaPath);
    if (mediaPath && !existsSync(mediaPath)) throw new Error("媒体文件不存在");
    const lyricPath = input.lyricPath ? this.normalizeMediaPath(input.lyricPath) : (mediaPath ? findLyricSidecar(mediaPath) : null);
    if (lyricPath && !existsSync(lyricPath)) throw new Error("歌词文件不存在");
    if (lyricPath && !lyricFormatForPath(lyricPath)) throw new Error("不支持的歌词格式");
    const result = this.db.prepare("INSERT INTO songs (title, artist, language, category, duration_seconds, media_path, lyric_path, media_type, metadata_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)").run(
      input.title.trim(), input.artist?.trim() || "未知歌手", input.language?.trim() || "其他", input.category?.trim() || "本地曲库", Number(input.durationSeconds) || 0, mediaPath, lyricPath, mediaPath ? mediaType(mediaPath) : "audio", now(),
    );
    const id = Number(result.lastInsertRowid);
    if (mediaPath) this.scrapeMetadata(id);
    return this.listSongs().find((song) => song.id === id);
  }

  updateSong(id, input) {
    const song = this.getSong(id);
    if (!song) throw new Error("歌曲不存在");
    const title = String(input.title ?? song.title).trim();
    if (!title) throw new Error("歌名不能为空");
    const releaseYear = String(input.releaseYear ?? song.release_year ?? "").trim();
    if (releaseYear && !/^\d{4}$/.test(releaseYear)) throw new Error("发行年份必须是四位数字");
    this.db.prepare(`
      UPDATE songs SET title = ?, artist = ?, album = ?, release_year = ?, language = ?, category = ?,
        cover_url = ?, metadata_source = 'manual-edit', scraped_at = ? WHERE id = ?
    `).run(
      title, String(input.artist ?? song.artist).trim() || "未知歌手",
      String(input.album ?? song.album ?? "").trim(), releaseYear,
      String(input.language ?? song.language).trim() || "其他",
      String(input.category ?? song.category).trim() || "本地曲库",
      String(input.coverUrl ?? song.cover_url ?? "").trim(), now(), id,
    );
    return this.listSongs().find((item) => item.id === id);
  }

  organizeSong(id) {
    const song = this.getSong(id);
    if (!song) throw new Error("歌曲不存在");
    if (!song.media_path || !existsSync(song.media_path)) return { status: "skipped", reason: "歌曲没有可用媒体文件", song: this.listSongs().find((item) => item.id === id) };
    if (song.metadata_source === "system") return { status: "skipped", reason: "系统试音文件保持固定位置", song: this.listSongs().find((item) => item.id === id) };

    const sourceMedia = this.normalizeMediaPath(song.media_path);
    const artist = safePathSegment(song.artist, "未知歌手");
    const album = safePathSegment(song.album, "未知专辑");
    const title = safePathSegment(song.title, "未命名歌曲");
    const targetDirectory = join(this.mediaDir, artist, album);
    const targetMedia = join(targetDirectory, `${title}${extname(sourceMedia).toLowerCase()}`);
    const sourceStem = sourceMedia.slice(0, -extname(sourceMedia).length);
    const sourceStemName = basename(sourceStem);
    const operations = [{ source: sourceMedia, target: targetMedia }];

    for (const entry of readdirSync(dirname(sourceMedia), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(`${sourceStemName}.`)) continue;
      const source = join(dirname(sourceMedia), entry.name);
      if (!lyricFormatForPath(source) && entry.name !== `${sourceStemName}.score.json`) continue;
      operations.push({ source, target: join(targetDirectory, `${title}${entry.name.slice(sourceStemName.length)}`) });
    }
    if (song.lyric_path && existsSync(song.lyric_path) && !operations.some((item) => item.source === song.lyric_path)) {
      const lyricName = basename(song.lyric_path).toLowerCase();
      const suffix = lyricName.endsWith(".qm.qrc") ? ".qm.qrc" : extname(song.lyric_path);
      operations.push({ source: song.lyric_path, target: join(targetDirectory, `${title}${suffix}`) });
    }

    const pending = operations.filter((item) => resolve(item.source) !== resolve(item.target));
    if (!pending.length) return { status: "skipped", reason: "已经符合目录规则", song: this.listSongs().find((item) => item.id === id) };
    for (const operation of pending) {
      if (existsSync(operation.target)) throw new Error(`目标文件已存在：${relative(this.mediaDir, operation.target)}`);
    }

    mkdirSync(targetDirectory, { recursive: true });
    const moved = [];
    try {
      for (const operation of pending) {
        renameSync(operation.source, operation.target);
        moved.push(operation);
      }
      const targetLyric = song.lyric_path
        ? operations.find((item) => item.source === song.lyric_path)?.target || song.lyric_path
        : findLyricSidecar(targetMedia);
      this.db.prepare("UPDATE songs SET media_path = ?, lyric_path = ? WHERE id = ?").run(targetMedia, targetLyric, id);
    } catch (error) {
      for (const operation of [...moved].reverse()) {
        if (existsSync(operation.target) && !existsSync(operation.source)) renameSync(operation.target, operation.source);
      }
      throw error;
    }
    return {
      status: "moved", from: relative(this.mediaDir, sourceMedia), to: relative(this.mediaDir, targetMedia),
      movedFiles: pending.length, song: this.listSongs().find((item) => item.id === id),
    };
  }

  organizeLibrary() {
    const rows = this.db.prepare("SELECT id FROM songs WHERE media_path IS NOT NULL ORDER BY id").all();
    const results = rows.map(({ id }) => {
      try { return { id, ...this.organizeSong(id) }; }
      catch (error) { return { id, status: "failed", error: error instanceof Error ? error.message : "文件整理失败" }; }
    });
    return {
      processed: results.length,
      moved: results.filter((item) => item.status === "moved").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      failed: results.filter((item) => item.status === "failed").length,
      results,
    };
  }

  deleteSong(id) {
    const result = this.db.prepare("DELETE FROM songs WHERE id = ?").run(id);
    this.compactQueue();
    return result.changes > 0;
  }

  scanMedia() {
    const insert = this.db.prepare("INSERT OR IGNORE INTO songs (title, artist, album, language, category, media_path, lyric_path, media_type, metadata_source, created_at) VALUES (?, ?, ?, '其他', '本地扫描', ?, ?, ?, 'filename', ?)");
    let added = 0;
    const files = scanFiles(this.mediaDir);
    for (const path of files) {
      const guessed = metadataFromFilename(path, this.mediaDir);
      const lyricPath = findLyricSidecar(path);
      const result = insert.run(guessed.title, guessed.artist, guessed.album || "", path, lyricPath, mediaType(path), now());
      added += result.changes;
    }
    const missing = this.db.prepare("SELECT media_path FROM songs WHERE media_path IS NOT NULL").all()
      .filter((song) => !existsSync(song.media_path)).length;
    return { scanned: files.length, added, missing };
  }

  scrapeMetadata(songId = null) {
    const rows = songId ? [this.getSong(songId)].filter(Boolean) : this.db.prepare("SELECT * FROM songs WHERE media_path IS NOT NULL").all();
    const update = this.db.prepare(`
      UPDATE songs SET title = ?, artist = ?, album = ?, release_year = ?, language = ?, category = ?, duration_seconds = ?,
        lyric_path = ?, media_type = ?, metadata_source = ?, scraped_at = ?, scrape_status = 'local', scrape_note = '' WHERE id = ?
    `);
    let updated = 0;
    for (const song of rows) {
      const path = this.normalizeMediaPath(song.media_path);
      if (!path || !existsSync(path)) continue;
      const guessed = metadataFromFilename(path, this.mediaDir);
      const embedded = this.probeMedia(path) || {};
      const filenameManaged = song.metadata_source === "filename";
      const title = cleanName(embedded.title) || (filenameManaged ? guessed.title : song.title) || guessed.title;
      const artist = cleanName(embedded.artist) || (filenameManaged || song.artist === "未知歌手" ? guessed.artist : song.artist) || guessed.artist;
      const album = cleanName(embedded.album) || song.album || guessed.album || "";
      const releaseYear = String(embedded.year || song.release_year || "").match(/\d{4}/)?.[0] || "";
      const language = cleanName(embedded.language) || (song.language === "其他" ? "其他" : song.language);
      const category = cleanName(embedded.category) || (song.category === "本地扫描" ? (mediaType(path) === "mv" ? "MV" : "本地曲库") : song.category);
      const durationSeconds = Number(embedded.durationSeconds) || song.duration_seconds || 0;
      const lyricPath = findLyricSidecar(path) || song.lyric_path;
      const source = embedded.title || embedded.artist || embedded.durationSeconds ? "embedded" : (filenameManaged ? "filename" : song.metadata_source);
      update.run(title, artist, album, releaseYear, language, category, durationSeconds, lyricPath, mediaType(path), source, now(), song.id);
      updated += 1;
    }
    return { scanned: rows.length, updated };
  }

  songsForOnlineScrape({ limit = 10, onlyIncomplete = true } = {}) {
    const where = onlyIncomplete ? "WHERE media_path IS NOT NULL AND (scrape_status != 'matched' OR metadata_id IS NULL)" : "WHERE media_path IS NOT NULL";
    return this.db.prepare(`
      SELECT id, title, artist, album, release_year AS releaseYear, duration_seconds AS durationSeconds, media_path AS mediaPath,
        lyric_path AS lyricPath, media_type AS mediaType, metadata_source AS metadataSource, metadata_id AS metadataId, scrape_status AS scrapeStatus
      FROM songs ${where} ORDER BY CASE scrape_status WHEN 'review' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END, id LIMIT ?
    `).all(limit);
  }

  countOnlineScrapePending() {
    return Number(this.db.prepare("SELECT COUNT(*) AS count FROM songs WHERE media_path IS NOT NULL AND (scrape_status != 'matched' OR metadata_id IS NULL)").get().count);
  }

  recordOnlineScrape(id, result, { overwrite = false, saveLyrics = true } = {}) {
    const song = this.getSong(id);
    if (!song) throw new Error("歌曲不存在");
    const candidate = result.candidate;
    if (result.status !== "matched" || !candidate) {
      const note = result.status === "review" && candidate ? `候选：${candidate.artist} - ${candidate.title}` : "没有找到可信候选";
      this.db.prepare("UPDATE songs SET scrape_status = ?, match_score = ?, scrape_note = ?, scraped_at = ? WHERE id = ?").run(result.status, candidate?.score?.total ?? null, note, now(), id);
      return;
    }
    let lyricPath = song.lyric_path;
    const incomingLyricsFormat = candidate.lyricsFormat === "qrc" ? "qrc" : "lrc";
    const upgradesLyrics = incomingLyricsFormat === "qrc" && lyricFormatForPath(lyricPath) !== "qrc";
    if (saveLyrics && candidate.syncedLyrics && song.media_path && (overwrite || !lyricPath || upgradesLyrics)) {
      lyricPath = song.media_path.replace(/\.[^.]+$/, `.${incomingLyricsFormat}`);
      writeFileSync(lyricPath, `${candidate.syncedLyrics.trim()}\n`, "utf8");
    }
    const preserveManual = song.metadata_source === "manual-edit" && !overwrite;
    const category = preserveManual && song.category && !["本地曲库", "本地扫描"].includes(song.category)
      ? song.category : candidate.category || song.category;
    const title = preserveManual ? song.title : overwrite || song.metadata_source === "filename" || song.artist === "未知歌手" ? candidate.title : song.title;
    const artist = preserveManual ? song.artist : overwrite || song.metadata_source === "filename" || song.artist === "未知歌手" ? candidate.artist : song.artist;
    this.db.prepare(`
      UPDATE songs SET title = ?, artist = ?, album = ?, release_year = ?, language = ?, category = ?, cover_url = ?,
        duration_seconds = ?, lyric_path = ?, metadata_source = ?, metadata_id = ?, match_score = ?,
        scrape_status = 'matched', scrape_note = ?, scraped_at = ? WHERE id = ?
    `).run(
      title, artist, preserveManual && song.album ? song.album : candidate.album || song.album || "",
      preserveManual && song.release_year ? song.release_year : candidate.year || song.release_year || "",
      preserveManual && song.language && song.language !== "其他" ? song.language : candidate.language || song.language || "其他", category,
      preserveManual && song.cover_url ? song.cover_url : candidate.coverUrl || song.cover_url || "",
      song.media_type === "mv" && song.duration_seconds ? song.duration_seconds : candidate.durationSeconds || song.duration_seconds || 0,
      lyricPath,
      preserveManual ? "manual-edit" : candidate.provider || result.pluginId || "online", candidate.providerId, candidate.score.total, candidate.lyricsError || "", now(), id,
    );
  }

  recordScrapeFailure(id, message) {
    this.db.prepare("UPDATE songs SET scrape_status = 'failed', scrape_note = ?, scraped_at = ? WHERE id = ?").run(String(message).slice(0, 300), now(), id);
  }

  getSnapshot() {
    const playback = this.db.prepare(`
      SELECT p.status, p.position_seconds AS positionSeconds, p.volume, p.muted,
             p.vocal_mode AS vocalMode, p.pitch, p.updated_at AS updatedAt,
             s.id AS songId, s.title, s.artist, s.duration_seconds AS durationSeconds,
             s.media_type AS mediaType,
             CASE WHEN s.media_path IS NOT NULL THEN 1 ELSE 0 END AS playable
      FROM playback_state p LEFT JOIN songs s ON s.id = p.current_song_id WHERE p.id = 1
    `).get();
    const queue = this.db.prepare(`
      SELECT q.id AS queueId, q.position, s.id, s.title, s.artist, s.language, s.media_type AS mediaType,
             s.duration_seconds AS durationSeconds, CASE WHEN s.media_path IS NOT NULL THEN 1 ELSE 0 END AS playable
      FROM queue_items q JOIN songs s ON s.id = q.song_id ORDER BY q.position, q.id
    `).all().map((item) => ({ ...item, playable: Boolean(item.playable) }));
    return { playback: { ...playback, muted: Boolean(playback.muted), playable: Boolean(playback.playable) }, queue };
  }

  enqueue(songId, priority = false) {
    if (!this.getSong(songId)) throw new Error("歌曲不存在");
    if (priority) this.db.prepare("UPDATE queue_items SET position = position + 1").run();
    const position = priority ? 1 : Number(this.db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM queue_items").get().next);
    this.db.prepare("INSERT INTO queue_items (song_id, position, created_at) VALUES (?, ?, ?)").run(songId, position, now());
    return this.getSnapshot();
  }

  compactQueue() {
    const items = this.db.prepare("SELECT id FROM queue_items ORDER BY position, id").all();
    const update = this.db.prepare("UPDATE queue_items SET position = ? WHERE id = ?");
    items.forEach((item, index) => update.run(index + 1, item.id));
  }

  moveQueueItem(queueId, action) {
    const items = this.db.prepare("SELECT id FROM queue_items ORDER BY position, id").all();
    const index = items.findIndex((item) => item.id === queueId);
    if (index < 0) throw new Error("队列项目不存在");
    let target = action === "top" ? 0 : action === "up" ? index - 1 : action === "down" ? index + 1 : index;
    target = Math.max(0, Math.min(items.length - 1, target));
    const [item] = items.splice(index, 1);
    items.splice(target, 0, item);
    const update = this.db.prepare("UPDATE queue_items SET position = ? WHERE id = ?");
    items.forEach((entry, position) => update.run(position + 1, entry.id));
    return this.getSnapshot();
  }

  removeQueueItem(queueId) {
    this.db.prepare("DELETE FROM queue_items WHERE id = ?").run(queueId);
    this.compactQueue();
    return this.getSnapshot();
  }

  updatePlayback(input) {
    const current = this.getSnapshot().playback;
    const allowedStatus = new Set(["playing", "paused"]);
    const status = allowedStatus.has(input.status) ? input.status : current.status;
    const volume = Math.max(0, Math.min(100, Number(input.volume ?? current.volume)));
    const muted = input.muted === undefined ? current.muted : Boolean(input.muted);
    const position = Math.max(0, Number(input.positionSeconds ?? current.positionSeconds) || 0);
    const vocalMode = input.vocalMode === "original" ? "original" : input.vocalMode === "accompaniment" ? "accompaniment" : current.vocalMode;
    const pitch = Math.max(-6, Math.min(6, Number(input.pitch ?? current.pitch) || 0));
    this.db.prepare("UPDATE playback_state SET status = ?, position_seconds = ?, volume = ?, muted = ?, vocal_mode = ?, pitch = ?, updated_at = ? WHERE id = 1").run(status, position, volume, muted ? 1 : 0, vocalMode, pitch, now());
    return this.getSnapshot();
  }

  playSong(songId) {
    if (!this.getSong(songId)) throw new Error("歌曲不存在");
    this.db.prepare("UPDATE playback_state SET current_song_id = ?, status = 'playing', position_seconds = 0, updated_at = ? WHERE id = 1").run(songId, now());
    return this.getSnapshot();
  }

  nextSong() {
    const next = this.db.prepare("SELECT id, song_id FROM queue_items ORDER BY position, id LIMIT 1").get();
    if (!next) {
      this.db.prepare("UPDATE playback_state SET status = 'paused', position_seconds = 0, updated_at = ? WHERE id = 1").run(now());
      return this.getSnapshot();
    }
    this.db.prepare("DELETE FROM queue_items WHERE id = ?").run(next.id);
    this.compactQueue();
    return this.playSong(next.song_id);
  }

  mediaForSong(id) {
    const song = this.getSong(id);
    if (!song?.media_path) return null;
    const path = this.normalizeMediaPath(song.media_path);
    return existsSync(path) && statSync(path).isFile() ? path : null;
  }

  lyricsForSong(id) {
    const song = this.getSong(id);
    if (!song?.lyric_path || !existsSync(song.lyric_path)) return null;
    return song.lyric_path;
  }

  close() {
    this.db.close();
  }
}
