import assert from "node:assert/strict";
import test from "node:test";
import { parseLrc, parseScoringProfile } from "./app.mjs";

test("parses ordinary LRC for line-level karaoke timing", () => {
  assert.deepEqual(parseLrc("[00:01.50]第一句\n[00:04.250]第二句"), [
    { time: 1.5, text: "第一句" },
    { time: 4.25, text: "第二句" },
  ]);
});

test("preserves enhanced LRC word timing for progressive highlighting", () => {
  assert.deepEqual(parseLrc("[00:10.00]<00:10.00>你<00:10.40>好 <00:10.80>世界"), [{
    time: 10,
    text: "你好 世界",
    segments: [
      { time: 10, text: "你" },
      { time: 10.4, text: "好 " },
      { time: 10.8, text: "世界" },
    ],
  }]);
});

test("validates and sorts karaoke scoring profiles", () => {
  assert.deepEqual(parseScoringProfile(JSON.stringify({ version: 1, title: "demo", notes: [
    { start: 2, end: 3, midi: 64 },
    { start: 0, end: 1, midi: 60, lyric: "唱" },
    { start: 4, end: 3, midi: 70 },
  ] })), {
    version: 1,
    title: "demo",
    notes: [
      { start: 0, end: 1, midi: 60, lyric: "唱" },
      { start: 2, end: 3, midi: 64 },
    ],
  });
});

test("preserves safe scoring analysis metadata", () => {
  const profile = parseScoringProfile(JSON.stringify({
    version: 1,
    generated: true,
    analysis: { audioSource: "vocals", separatorId: "demucs", cachedStem: true, guidedByLyrics: true, lyricWindows: 42, warning: "复核" },
    notes: [{ start: 1, end: 2, midi: 60, lyric: "唱" }],
  }));
  assert.deepEqual(profile.analysis, {
    audioSource: "vocals", separatorId: "demucs", cachedStem: true, guidedByLyrics: true, lyricWindows: 42, warning: "复核",
  });
});
