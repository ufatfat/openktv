import assert from "node:assert/strict";
import test from "node:test";
import { extractGuidedNotesFromPcm, extractNotesFromPcm, lyricWindows } from "./scoring.mjs";

test("extracts stable melody notes from PCM", () => {
  const rate = 8000;
  const pcm = new Float32Array(rate * 2);
  for (let index = 0; index < pcm.length; index += 1) {
    const frequency = index < rate ? 440 : 523.25;
    pcm[index] = Math.sin(2 * Math.PI * frequency * index / rate) * 0.25;
  }
  const notes = extractNotesFromPcm(pcm, rate);
  assert.ok(notes.length >= 2);
  assert.ok(notes.some((note) => Math.abs(note.midi - 69) <= 1));
  assert.ok(notes.some((note) => Math.abs(note.midi - 72) <= 1));
});

test("uses QRC word windows to label extracted pitch", () => {
  const rate = 8000;
  const pcm = new Float32Array(rate * 2);
  for (let index = 0; index < pcm.length; index += 1) {
    const frequency = index < rate ? 440 : 523.25;
    pcm[index] = Math.sin(2 * Math.PI * frequency * index / rate) * 0.3;
  }
  const windows = lyricWindows([{ time: 0, end: 2, text: "你好", segments: [
    { time: 0.1, end: 0.9, text: "你" },
    { time: 1.1, end: 1.9, text: "好" },
  ] }]);
  const notes = extractGuidedNotesFromPcm(pcm, rate, windows);
  assert.deepEqual(notes.map((note) => note.lyric), ["你", "好"]);
  assert.ok(Math.abs(notes[0].midi - 69) <= 1);
  assert.ok(Math.abs(notes[1].midi - 72) <= 1);
});

test("does not treat line-timed LRC as word guidance", () => {
  assert.deepEqual(lyricWindows([{ time: 1, text: "只有行时间" }]), []);
});
