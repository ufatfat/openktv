import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

const MEDIA_EXTENSIONS = new Set([".mp4", ".webm", ".mp3", ".m4a", ".wav", ".ogg", ".flac"]);

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

export class KtvStore {
  constructor({ dbPath, mediaDir }) {
    this.mediaDir = resolve(mediaDir);
    mkdirSync(dirname(dbPath), { recursive: true });
    mkdirSync(this.mediaDir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
    this.seed();
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
      INSERT OR IGNORE INTO playback_state (id, updated_at) VALUES (1, '${now()}');
    `);
  }

  seed() {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM songs").get().count;
    if (count > 0) return;
    const demoPath = join(this.mediaDir, "system-check.wav");
    const lyricPath = join(this.mediaDir, "system-check.lrc");
    createDemoWave(demoPath);
    if (!existsSync(lyricPath)) writeFileSync(lyricPath, "[00:00.00]OpenKTV 系统试音\n[00:03.00]播放器与声音输出正常\n[00:06.00]现在可以导入你的本地曲库\n[00:09.00]准备好，开始唱吧\n");
    const insert = this.db.prepare("INSERT INTO songs (title, artist, language, category, duration_seconds, media_path, lyric_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("系统试音", "OpenKTV", "其他", "系统", 12, demoPath, lyricPath, now());
    const demos = [
      ["晚风来信", "林屿", "国语", "流行"], ["沿海公路", "沈星", "国语", "轻快"],
      ["玻璃晴朗", "Nine Days", "粤语", "经典"], ["心跳失真", "NOVA", "国语", "摇滚"],
    ];
    for (const song of demos) insert.run(song[0], song[1], song[2], song[3], 0, null, null, now());
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
             media_path AS mediaPath, lyric_path AS lyricPath,
             CASE WHEN media_path IS NOT NULL THEN 1 ELSE 0 END AS playable
      FROM songs
      WHERE (? = '' OR title LIKE ? OR artist LIKE ?)
        AND (? = '' OR language = ? OR category = ?)
      ORDER BY playable DESC, id DESC
    `).all(query.trim(), q, q, language, language, language).map((song) => ({ ...song, playable: Boolean(song.playable) }));
  }

  getSong(id) {
    return this.db.prepare("SELECT * FROM songs WHERE id = ?").get(id);
  }

  createSong(input) {
    if (!input.title?.trim()) throw new Error("歌名不能为空");
    const mediaPath = this.normalizeMediaPath(input.mediaPath);
    if (mediaPath && !existsSync(mediaPath)) throw new Error("媒体文件不存在");
    const lyricCandidate = mediaPath ? mediaPath.replace(/\.[^.]+$/, ".lrc") : null;
    const lyricPath = input.lyricPath ? this.normalizeMediaPath(input.lyricPath) : (lyricCandidate && existsSync(lyricCandidate) ? lyricCandidate : null);
    const result = this.db.prepare("INSERT INTO songs (title, artist, language, category, duration_seconds, media_path, lyric_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      input.title.trim(), input.artist?.trim() || "未知歌手", input.language?.trim() || "其他", input.category?.trim() || "本地曲库", Number(input.durationSeconds) || 0, mediaPath, lyricPath, now(),
    );
    return this.getSong(Number(result.lastInsertRowid));
  }

  deleteSong(id) {
    const result = this.db.prepare("DELETE FROM songs WHERE id = ?").run(id);
    this.compactQueue();
    return result.changes > 0;
  }

  scanMedia() {
    const insert = this.db.prepare("INSERT OR IGNORE INTO songs (title, artist, language, category, media_path, lyric_path, created_at) VALUES (?, '未知歌手', '其他', '本地扫描', ?, ?, ?)");
    let added = 0;
    for (const path of scanFiles(this.mediaDir)) {
      const title = basename(path, extname(path)).replaceAll(/[_-]+/g, " ").trim();
      const lyricPath = path.replace(/\.[^.]+$/, ".lrc");
      const result = insert.run(title, path, existsSync(lyricPath) ? lyricPath : null, now());
      added += result.changes;
    }
    return { scanned: scanFiles(this.mediaDir).length, added };
  }

  getSnapshot() {
    const playback = this.db.prepare(`
      SELECT p.status, p.position_seconds AS positionSeconds, p.volume, p.muted,
             p.vocal_mode AS vocalMode, p.pitch, p.updated_at AS updatedAt,
             s.id AS songId, s.title, s.artist, s.duration_seconds AS durationSeconds,
             CASE WHEN s.media_path IS NOT NULL THEN 1 ELSE 0 END AS playable
      FROM playback_state p LEFT JOIN songs s ON s.id = p.current_song_id WHERE p.id = 1
    `).get();
    const queue = this.db.prepare(`
      SELECT q.id AS queueId, q.position, s.id, s.title, s.artist, s.language,
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
