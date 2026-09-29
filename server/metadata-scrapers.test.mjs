import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMetadataScraperRegistry } from "./metadata-scrapers/index.mjs";
import { createAcoustIdPlugin } from "./metadata-scrapers/plugins/acoustid.mjs";
import { createSmartMultiSourcePlugin } from "./metadata-scrapers/plugins/smart-multi-source.mjs";
import { createQqMusicPlugin } from "./metadata-scrapers/plugins/qqmusic.mjs";
import { MetadataScraperRegistry } from "./metadata-scrapers/registry.mjs";

test("registers metadata scraper plugins and exposes their capabilities", () => {
  const registry = createDefaultMetadataScraperRegistry({ fetchImpl: async () => new Response(JSON.stringify({ recordings: [] }), { status: 200 }) });
  const manifest = registry.manifest();
  assert.deepEqual(manifest.map((plugin) => plugin.id), ["smart-multi-source", "musicbrainz-lrclib", "netease", "qqmusic", "migu", "acoustid"]);
  assert.ok(manifest.every((plugin) => plugin.mediaTypes.includes("mv")));
  assert.ok(manifest.slice(0, 4).every((plugin) => plugin.available));
  assert.equal(manifest[4].available, false);
  assert.equal(manifest[5].available, false);
  assert.ok(manifest[0].capabilities.includes("multi-source-ranking"));
});

test("smart scraper combines successful sources and keeps source failures", async () => {
  const good = {
    id: "good", name: "Good", providers: ["good"], mediaTypes: ["audio", "mv"], availability: () => ({ available: true, reason: "" }),
    searchCandidates: async () => [{ provider: "good", providerId: "1", title: "晴天", artist: "周杰伦", album: "叶惠美", durationSeconds: 269 }],
    fetchLyrics: async () => "[00:01.00]故事的小黄花",
  };
  const broken = {
    id: "broken", name: "Broken", providers: ["broken"], mediaTypes: ["audio", "mv"], availability: () => ({ available: true, reason: "" }),
    searchCandidates: async () => { throw new Error("temporary outage"); },
  };
  const result = await createSmartMultiSourcePlugin([good, broken]).scrape(
    { title: "晴天", artist: "周杰伦", album: "叶惠美", durationSeconds: 269, mediaType: "mv" },
    { fetchLyrics: true },
  );
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.provider, "good");
  assert.equal(result.candidate.language, "中文");
  assert.deepEqual(result.sourcesTried, ["good", "broken"]);
  assert.deepEqual(result.sourceErrors, [{ pluginId: "broken", message: "temporary outage" }]);
});

test("QQ Music scraper requests and returns word-timed QRC lyrics", async () => {
  const requests = [];
  const plugin = createQqMusicPlugin({ fetchImpl: async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ req_0: { code: 0, data: {
      qrc: 1,
      lyric: '<Lyric_1 LyricType="1" LyricContent="[1000,1000]故(1000,500)事(1500,500)"/>',
    } } }), { status: 200 });
  } });
  const fetched = await plugin.fetchLyrics({ providerId: "song-mid" });
  assert.equal(fetched.format, "qrc");
  assert.match(fetched.content, /LyricContent/);
  assert.equal(requests[0].body.req_0.param.qrc, 1);
  assert.equal(requests[0].body.req_0.param.crypt, 1);
});

test("QQ Music scraper reuses a stored MID without searching again", async () => {
  const requests = [];
  const plugin = createQqMusicPlugin({ fetchImpl: async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ req_0: { code: 0, data: {
      qrc: 1,
      lyric: '<Lyric_1 LyricType="1" LyricContent="[1000,1000]故(1000,500)事(1500,500)"/>',
    } } }), { status: 200 });
  } });
  const result = await plugin.scrape({
    title: "晴天", artist: "周杰伦", album: "叶惠美", metadataSource: "qqmusic", metadataId: "stored-mid", durationSeconds: 269,
  }, { fetchLyrics: true });
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.providerId, "stored-mid");
  assert.equal(result.candidate.lyricsFormat, "qrc");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.req_0.param.songMID, "stored-mid");
});

test("smart scraper preserves the fetched lyric format", async () => {
  const source = {
    id: "qq-fixture", name: "QQ fixture", providers: ["qqmusic"], mediaTypes: ["audio", "mv"], availability: () => ({ available: true, reason: "" }),
    searchCandidates: async () => [{ provider: "qqmusic", providerId: "1", title: "晴天", artist: "周杰伦", album: "叶惠美", durationSeconds: 269 }],
    fetchLyrics: async () => ({ content: '<Lyric_1 LyricType="1" LyricContent="[1000,1000]晴(1000,500)天(1500,500)"/>', format: "qrc" }),
  };
  const result = await createSmartMultiSourcePlugin([source]).scrape(
    { title: "晴天", artist: "周杰伦", album: "叶惠美", durationSeconds: 269, mediaType: "audio" },
    { fetchLyrics: true },
  );
  assert.equal(result.candidate.lyricsFormat, "qrc");
  assert.match(result.candidate.syncedLyrics, /LyricContent/);
});

test("uses an AcoustID fingerprint to produce normalized candidates", async () => {
  const plugin = createAcoustIdPlugin({
    apiKey: "test-key",
    fingerprintImpl: () => ({ duration: 269, fingerprint: "fingerprint-data" }),
    fetchImpl: async (url) => {
      assert.match(String(url), /client=test-key/);
      return new Response(JSON.stringify({ results: [{ recordings: [{
        id: "recording-id", title: "晴天", artists: [{ name: "周杰伦" }],
        releasegroups: [{ title: "叶惠美", first_release_date: "2003-07-31" }],
      }] }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(plugin.availability().available, true);
  const result = await plugin.scrape({
    title: "晴天", artist: "周杰伦", album: "叶惠美", durationSeconds: 269,
    mediaPath: "/tmp/test.mp4", mediaType: "mv",
  }, { fetchLyrics: false });
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.provider, "acoustid");
  assert.equal(result.candidate.year, "2003");
});

test("selects a requested scraper plugin and reports its id", async () => {
  const registry = new MetadataScraperRegistry([{
    id: "fixture", name: "Fixture", providers: ["test"], mediaTypes: ["mv"], capabilities: ["metadata"],
    scrape: async (song) => ({ status: "matched", candidate: { title: song.title } }),
  }]);
  const result = await registry.scrape({ title: "测试 MV", mediaType: "mv" }, { pluginId: "fixture" });
  assert.equal(result.pluginId, "fixture");
  assert.equal(result.candidate.title, "测试 MV");
  await assert.rejects(() => registry.scrape({ title: "音频", mediaType: "audio" }), /没有支持 audio/);
});

test("rejects duplicate metadata scraper plugins", () => {
  const plugin = { id: "duplicate", name: "Duplicate", mediaTypes: ["audio"], scrape: async () => ({}) };
  assert.throws(() => new MetadataScraperRegistry([plugin, plugin]), /重复注册/);
});
