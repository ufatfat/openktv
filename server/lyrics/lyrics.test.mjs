import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { parseAss } from "./plugins/ass.mjs";
import { KRC_XOR_KEY, parseKrc } from "./plugins/krc.mjs";
import { parseLrc } from "./plugins/lrc.mjs";
import { decodeQrc, parseQrc } from "./plugins/qrc.mjs";
import { parseSubtitle } from "./plugins/subtitle.mjs";
import { parseTtml } from "./plugins/ttml.mjs";
import { lyricRegistry } from "./registry.mjs";

function encodeKrc(value) {
  const compressed = deflateSync(Buffer.from(value));
  const encrypted = Buffer.allocUnsafe(compressed.length);
  for (let index = 0; index < compressed.length; index += 1) encrypted[index] = compressed[index] ^ KRC_XOR_KEY[index % KRC_XOR_KEY.length];
  return Buffer.concat([Buffer.from("krc1"), encrypted]);
}

test("registers the built-in lyric format plugins", () => {
  assert.deepEqual(lyricRegistry.manifest().map((plugin) => plugin.id), ["krc", "qrc", "ttml", "lrc", "ass", "subtitle"]);
});

test("parses standard and enhanced LRC with offsets", () => {
  assert.deepEqual(parseLrc("[offset:100]\n[00:01.00]<00:01.00>你<00:01.40>好"), [{
    time: 1.1, text: "你好", segments: [{ time: 1.1, text: "你" }, { time: 1.5, text: "好" }],
  }]);
});

test("decodes binary KRC and preserves per-word duration", () => {
  const lines = parseKrc(encodeKrc("[1000,1000]<0,400,0>你<400,600,0>好"));
  assert.deepEqual(lines, [{
    time: 1, end: 2, text: "你好", segments: [{ time: 1, end: 1.4, text: "你" }, { time: 1.4, end: 2, text: "好" }],
  }]);
});

test("parses QRC XML with absolute per-word timings", () => {
  const xml = '<QrcInfos><LyricInfo><Lyric_1 LyricType="1" LyricContent="[1000,1000]你(1000,400)好(1400,600)"/></LyricInfo></QrcInfos>';
  assert.deepEqual(parseQrc(xml), [{
    time: 1, end: 2, text: "你好", segments: [{ time: 1, end: 1.4, text: "你" }, { time: 1.4, end: 2, text: "好" }],
  }]);
});

test("decrypts encrypted QQ Music QRC payloads", () => {
  const encrypted = Buffer.from("ee7befb746f93831d42dcdf2e21f0d5d977de00c85449a7ceda273406896fa7a6b5070273a7bec21e7029c6a4b69d345caf1b85103143c15f8d5bef7599e0cfdda157a88574326dcd5467c5fe17f597f1b779d697c2731e14be30d978ef80138", "hex");
  assert.match(decodeQrc(encrypted), /LyricContent=/);
  assert.equal(parseQrc(encrypted)[0].text, "你好");
});

test("recognizes the multi-suffix qm.qrc sidecar", () => {
  assert.equal(lyricRegistry.pluginForPath("demo.qm.qrc").id, "qrc");
});

test("parses TTML span timing into lyric segments", () => {
  const lines = parseTtml('<tt><body><p begin="1s" end="3s"><span begin="1s" end="2s">你</span><span begin="2s" end="3s">好</span></p></body></tt>');
  assert.deepEqual(lines, [{
    time: 1, end: 3, text: "你好", segments: [{ time: 1, end: 2, text: "你" }, { time: 2, end: 3, text: "好" }],
  }]);
});

test("parses SRT and WebVTT cue timing", () => {
  assert.deepEqual(parseSubtitle("1\n00:00:01,000 --> 00:00:03,500\n第一句"), [{ time: 1, end: 3.5, text: "第一句" }]);
  assert.deepEqual(parseSubtitle("WEBVTT\n\n00:02.000 --> 00:04.000\n第二句"), [{ time: 2, end: 4, text: "第二句" }]);
});

test("parses ASS karaoke tags as timed segments", () => {
  const source = "[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\kf40}你{\\kf60}好";
  assert.deepEqual(parseAss(source), [{
    time: 1, end: 2, text: "你好", segments: [{ time: 1, end: 1.4, text: "你" }, { time: 1.4, end: 2, text: "好" }],
  }]);
});
