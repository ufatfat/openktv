import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { KtvStore } from "./store.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "openktv-"));
  const store = new KtvStore({ dbPath: join(root, "test.db"), mediaDir: join(root, "media") });
  return { store, cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
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
