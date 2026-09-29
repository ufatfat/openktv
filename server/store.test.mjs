import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { KtvStore } from "./store.mjs";

function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "openktv-"));
  const mediaDir = join(root, "media");
  const store = new KtvStore({ dbPath: join(root, "test.db"), mediaDir, ...options });
  return { store, mediaDir, cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("persists songs and a global queue", () => {
  const { store, cleanup } = fixture();
  try {
    const songs = store.listSongs();
    assert.ok(songs.length >= 1);
    assert.equal(songs.find((song) => song.title === "系统试音").hasScore, true);
    const snapshot = store.enqueue(songs[0].id);
    assert.equal(snapshot.queue.length, 1);
    assert.equal(snapshot.queue[0].id, songs[0].id);
  } finally { cleanup(); }
});

test("moves queue items and advances playback", () => {
  const { store, cleanup } = fixture();
  try {
    const songs = store.listSongs();
    store.enqueue(songs[0].id);
    store.enqueue(songs[1].id);
    const before = store.getSnapshot();
    store.moveQueueItem(before.queue[1].queueId, "top");
    const after = store.nextSong();
    assert.equal(after.playback.songId, songs[1].id);
    assert.equal(after.queue.length, 1);
  } finally { cleanup(); }
});

test("clamps playback controls", () => {
  const { store, cleanup } = fixture();
  try {
    const snapshot = store.updatePlayback({ volume: 150, pitch: -9, status: "playing" });
    assert.equal(snapshot.playback.volume, 100);
    assert.equal(snapshot.playback.pitch, -6);
    assert.equal(snapshot.playback.status, "playing");
  } finally { cleanup(); }
});

test("stores score history and orders the leaderboard", () => {
  const { store, cleanup } = fixture();
  try {
    const song = store.listSongs()[0];
    store.recordScore(song.id, { singerName: "Alice", score: 82, pitchScore: 80, rhythmScore: 84, stabilityScore: 78, completion: 90, maxCombo: 12 });
    store.recordScore(song.id, { singerName: "Bob", score: 95, pitchScore: 96, rhythmScore: 92, stabilityScore: 94, completion: 98, maxCombo: 20 });
    const leaderboard = store.scoreResults(song.id, { leaderboard: true });
    assert.equal(leaderboard[0].singerName, "Bob");
    assert.equal(leaderboard[0].score, 95);
    assert.equal(leaderboard[1].singerName, "Alice");
  } finally { cleanup(); }
});

test("scans MV files and scrapes embedded metadata with sidecar lyrics", () => {
  const { store, mediaDir, cleanup } = fixture({
    probeMedia: (path) => path.endsWith(".mp4") ? { title: "晴天", artist: "周杰伦", album: "叶惠美", year: "2003-07-31", language: "国语", category: "流行", durationSeconds: 269 } : {},
  });
  try {
    const artistDir = join(mediaDir, "周杰伦");
    mkdirSync(artistDir, { recursive: true });
    writeFileSync(join(artistDir, "周杰伦 - 晴天 [MV].mp4"), "video-fixture");
    writeFileSync(join(artistDir, "周杰伦 - 晴天 [MV].lrc"), "[00:01.00]故事的小黄花");
    const scan = store.scanMedia();
    const scrape = store.scrapeMetadata();
    const song = store.listSongs().find((item) => item.title === "晴天");
    const systemSong = store.listSongs().find((item) => item.category === "系统");
    assert.equal(scan.added, 1);
    assert.ok(scrape.updated >= 1);
    assert.equal(song.artist, "周杰伦");
    assert.equal(song.album, "叶惠美");
    assert.equal(song.releaseYear, "2003");
    assert.equal(song.mediaType, "mv");
    assert.equal(song.hasLyrics, true);
    assert.equal(song.durationSeconds, 269);
    assert.equal(song.metadataSource, "embedded");
    assert.equal(systemSong.title, "系统试音");
  } finally { cleanup(); }
});

test("refreshes media availability when a scanned file disappears and returns", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    const mediaPath = join(mediaDir, "refresh-test.mp3");
    writeFileSync(mediaPath, "audio-fixture");
    const initial = store.scanMedia();
    assert.equal(initial.added, 1);
    assert.equal(initial.missing, 0);
    const songId = store.listSongs().find((song) => song.mediaPath === mediaPath).id;

    rmSync(mediaPath);
    const missing = store.scanMedia();
    assert.equal(missing.missing, 1);
    assert.equal(store.listSongs().find((song) => song.id === songId).playable, false);

    writeFileSync(mediaPath, "audio-fixture-restored");
    const restored = store.scanMedia();
    assert.equal(restored.added, 0);
    assert.equal(restored.missing, 0);
    assert.equal(store.listSongs().find((song) => song.id === songId).playable, true);
  } finally { cleanup(); }
});

test("discovers richer lyric sidecars through the plugin registry", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    writeFileSync(join(mediaDir, "plugin-song.mp4"), "video-fixture");
    writeFileSync(join(mediaDir, "plugin-song.lrc"), "[00:01.00]普通歌词");
    writeFileSync(join(mediaDir, "plugin-song.krc"), "[1000,1000]<0,1000,0>逐字歌词");
    store.scanMedia();
    const song = store.listSongs().find((item) => item.mediaPath?.endsWith("plugin-song.mp4"));
    assert.equal(song.lyricPath, join(mediaDir, "plugin-song.krc"));
    assert.equal(song.lyricFormat, "krc");
  } finally { cleanup(); }
});

test("discovers a QQ Music qm.qrc sidecar", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    writeFileSync(join(mediaDir, "qq-song.mp4"), "video-fixture");
    writeFileSync(join(mediaDir, "qq-song.qm.qrc"), '<Lyric_1 LyricType="1" LyricContent="[1000,1000]你(1000,1000)"/>');
    store.scanMedia();
    const song = store.listSongs().find((item) => item.mediaPath?.endsWith("qq-song.mp4"));
    assert.equal(song.lyricPath, join(mediaDir, "qq-song.qm.qrc"));
    assert.equal(song.lyricFormat, "qrc");
  } finally { cleanup(); }
});

test("edits song metadata and organizes media sidecars by artist album and title", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    const sourceMedia = join(mediaDir, "source-video.mp4");
    const sourceLyrics = join(mediaDir, "source-video.krc");
    const sourceScore = join(mediaDir, "source-video.score.json");
    writeFileSync(sourceMedia, "video-fixture");
    writeFileSync(sourceLyrics, "[1000,1000]<0,1000,0>故事的小黄花");
    writeFileSync(sourceScore, JSON.stringify({ version: 1, notes: [] }));
    const song = store.createSong({ title: "待整理", artist: "未知歌手", mediaPath: "source-video.mp4" });

    const edited = store.updateSong(song.id, {
      title: "晴天", artist: "周杰伦", album: "叶惠美", releaseYear: "2003",
      language: "国语", category: "流行", coverUrl: "https://example.test/sunny.jpg",
    });
    assert.equal(edited.metadataSource, "manual-edit");
    assert.equal(edited.album, "叶惠美");

    const organized = store.organizeSong(song.id);
    const targetMedia = join(mediaDir, "周杰伦", "叶惠美", "晴天.mp4");
    assert.equal(organized.status, "moved");
    assert.equal(organized.movedFiles, 3);
    assert.equal(existsSync(sourceMedia), false);
    assert.equal(existsSync(targetMedia), true);
    assert.equal(existsSync(join(mediaDir, "周杰伦", "叶惠美", "晴天.krc")), true);
    assert.equal(existsSync(join(mediaDir, "周杰伦", "叶惠美", "晴天.score.json")), true);
    const updated = store.listSongs().find((item) => item.id === song.id);
    assert.equal(updated.mediaPath, targetMedia);
    assert.equal(updated.hasLyrics, true);
    assert.equal(updated.hasScore, true);
  } finally { cleanup(); }
});

test("does not overwrite an existing file while organizing a song", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    const sourceMedia = join(mediaDir, "collision.mp3");
    const targetDir = join(mediaDir, "歌手", "专辑");
    const targetMedia = join(targetDir, "歌曲.mp3");
    writeFileSync(sourceMedia, "source");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetMedia, "existing");
    const song = store.createSong({ title: "待整理", artist: "未知歌手", mediaPath: "collision.mp3" });
    store.updateSong(song.id, { title: "歌曲", artist: "歌手", album: "专辑" });

    assert.throws(() => store.organizeSong(song.id), /目标文件已存在/);
    assert.equal(readFileSync(sourceMedia, "utf8"), "source");
    assert.equal(readFileSync(targetMedia, "utf8"), "existing");
  } finally { cleanup(); }
});

test("reads artist album and title from the organized directory hierarchy", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    const albumDir = join(mediaDir, "陈奕迅", "黑白灰");
    mkdirSync(albumDir, { recursive: true });
    writeFileSync(join(albumDir, "十年.mp3"), "audio-fixture");
    store.scanMedia();
    const song = store.listSongs().find((item) => item.title === "十年");
    assert.equal(song.artist, "陈奕迅");
    assert.equal(song.album, "黑白灰");
  } finally { cleanup(); }
});

test("automatically scrapes a manually added MV", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({ title: "夜曲", artist: "周杰伦", durationSeconds: 226 }) });
  try {
    writeFileSync(join(mediaDir, "night.mp4"), "video-fixture");
    const song = store.createSong({ title: "待刮削", mediaPath: "night.mp4" });
    assert.equal(song.title, "夜曲");
    assert.equal(song.artist, "周杰伦");
    assert.equal(song.mediaType, "mv");
    assert.equal(song.durationSeconds, 226);
    assert.equal(song.metadataSource, "embedded");
  } finally { cleanup(); }
});

test("parses compact artist-title MV filenames and removes video decorations", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    writeFileSync(join(mediaDir, "陈奕迅-忘记歌词 (Official MV) [4K].mp4"), "video-fixture");
    store.scanMedia();
    store.scrapeMetadata();
    const song = store.listSongs().find((item) => item.mediaType === "mv" && item.artist === "陈奕迅");
    assert.equal(song.title, "忘记歌词");
    assert.equal(song.metadataSource, "filename");
  } finally { cleanup(); }
});

test("repairs media paths after the project directory is moved", () => {
  const root = mkdtempSync(join(tmpdir(), "openktv-moved-"));
  const mediaDir = join(root, "data", "media");
  const dbPath = join(root, "openktv.db");
  let store = new KtvStore({ dbPath, mediaDir });
  try {
    store.db.prepare("UPDATE songs SET media_path = ?, lyric_path = ? WHERE title = '系统试音'").run(
      "/old/project/app/data/media/system-check.wav",
      "/old/project/app/data/media/system-check.lrc",
    );
    store.close();
    store = new KtvStore({ dbPath, mediaDir });
    const song = store.listSongs().find((item) => item.title === "系统试音");
    assert.equal(song.mediaPath, join(mediaDir, "system-check.wav"));
    assert.equal(song.lyricPath, join(mediaDir, "system-check.lrc"));
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("applies trusted online metadata and saves synchronized lyrics", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    writeFileSync(join(mediaDir, "Jay - Sunny.mp4"), "video-fixture");
    const song = store.createSong({ title: "晴天", artist: "周杰伦", mediaPath: "Jay - Sunny.mp4" });
    store.recordOnlineScrape(song.id, { status: "matched", pluginId: "fixture-scraper", candidate: {
      providerId: "mbid-1", title: "晴天", artist: "周杰伦", album: "叶惠美", year: "2003",
      category: "流行", durationSeconds: 269, coverUrl: "https://example.test/cover.jpg",
      syncedLyrics: "[00:01.00]故事的小黄花", language: "中文", score: { total: 0.98 },
    } }, { saveLyrics: true });
    const updated = store.listSongs().find((item) => item.id === song.id);
    assert.equal(updated.scrapeStatus, "matched");
    assert.equal(updated.album, "叶惠美");
    assert.equal(updated.releaseYear, "2003");
    assert.equal(updated.matchScore, 0.98);
    assert.equal(updated.hasLyrics, true);
    assert.equal(updated.durationSeconds, 269);
    assert.equal(updated.metadataSource, "fixture-scraper");
    assert.equal(updated.language, "中文");
  } finally { cleanup(); }
});

test("preserves manually edited metadata during later online scraping", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    writeFileSync(join(mediaDir, "manual.mp3"), "audio-fixture");
    const song = store.createSong({ title: "原始歌名", artist: "原始歌手", mediaPath: "manual.mp3" });
    store.updateSong(song.id, { title: "手工歌名", artist: "手工歌手", album: "手工专辑", releaseYear: "2026", language: "国语", category: "收藏", coverUrl: "manual-cover" });
    store.recordOnlineScrape(song.id, { status: "matched", pluginId: "fixture-scraper", candidate: {
      providerId: "remote-id", title: "远端歌名", artist: "远端歌手", album: "远端专辑", year: "2000",
      language: "英语", category: "摇滚", coverUrl: "remote-cover", durationSeconds: 180, score: { total: 0.99 },
    } });
    const updated = store.listSongs().find((item) => item.id === song.id);
    assert.equal(updated.title, "手工歌名");
    assert.equal(updated.artist, "手工歌手");
    assert.equal(updated.album, "手工专辑");
    assert.equal(updated.releaseYear, "2026");
    assert.equal(updated.metadataSource, "manual-edit");
    assert.equal(updated.scrapeStatus, "matched");
  } finally { cleanup(); }
});

test("upgrades an existing LRC sidecar to QRC when online scraping finds word timing", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({}) });
  try {
    writeFileSync(join(mediaDir, "qrc-upgrade.mp3"), "audio-fixture");
    writeFileSync(join(mediaDir, "qrc-upgrade.lrc"), "[00:01.00]故事");
    const song = store.createSong({ title: "晴天", artist: "周杰伦", mediaPath: "qrc-upgrade.mp3" });
    store.recordOnlineScrape(song.id, { status: "matched", pluginId: "qqmusic", candidate: {
      provider: "qqmusic", providerId: "song-mid", title: "晴天", artist: "周杰伦",
      syncedLyrics: '<Lyric_1 LyricType="1" LyricContent="[1000,1000]故(1000,500)事(1500,500)"/>',
      lyricsFormat: "qrc", score: { total: 0.99 },
    } }, { saveLyrics: true });
    const updated = store.listSongs().find((item) => item.id === song.id);
    assert.equal(updated.lyricPath, join(mediaDir, "qrc-upgrade.qrc"));
    assert.equal(updated.lyricFormat, "qrc");
    assert.equal(existsSync(join(mediaDir, "qrc-upgrade.lrc")), true);
  } finally { cleanup(); }
});

test("passes MV type to online scraping and preserves the real video duration", () => {
  const { store, mediaDir, cleanup } = fixture({ probeMedia: () => ({ durationSeconds: 335 }) });
  try {
    writeFileSync(join(mediaDir, "晴天 (Official Music Video).mp4"), "video-fixture");
    const song = store.createSong({ title: "晴天 (Official Music Video)", artist: "周杰伦", mediaPath: "晴天 (Official Music Video).mp4" });
    const pending = store.songsForOnlineScrape({ onlyIncomplete: false }).find((item) => item.id === song.id);
    assert.equal(pending.mediaType, "mv");
    store.recordOnlineScrape(song.id, { status: "matched", candidate: {
      providerId: "mbid-mv", title: "晴天", artist: "周杰伦", album: "叶惠美", year: "2003",
      durationSeconds: 269, score: { total: 0.96 },
    } });
    assert.equal(store.listSongs().find((item) => item.id === song.id).durationSeconds, 335);
  } finally { cleanup(); }
});
