import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("scans MV files and scrapes embedded metadata with sidecar lyrics", () => {
  const { store, mediaDir, cleanup } = fixture({
    probeMedia: (path) => path.endsWith(".mp4") ? { title: "晴天", artist: "周杰伦", language: "国语", category: "流行", durationSeconds: 269 } : {},
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
    assert.equal(song.mediaType, "mv");
    assert.equal(song.hasLyrics, true);
    assert.equal(song.durationSeconds, 269);
    assert.equal(song.metadataSource, "embedded");
    assert.equal(systemSong.title, "系统试音");
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
