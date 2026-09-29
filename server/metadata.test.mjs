import assert from "node:assert/strict";
import test from "node:test";
import { cleanMediaTitle, MusicMetadataScraper, scoreCandidate, similarity } from "./metadata.mjs";

test("normalizes punctuation and scores title, artist and duration", () => {
  assert.ok(similarity("晴天 (Live)", "晴天 Live") > 0.8);
  const score = scoreCandidate(
    { title: "晴天", artist: "周杰伦", album: "叶惠美", durationSeconds: 269 },
    { title: "晴天", artist: "周杰伦", album: "叶惠美", durationSeconds: 270 },
  );
  assert.ok(score.total > 0.95);
});

test("finds a high-confidence MusicBrainz candidate and synced lyrics", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("musicbrainz.org")) return new Response(JSON.stringify({ recordings: [{
      id: "recording-1", title: "晴天", length: 269000, "first-release-date": "2003-07-31",
      "artist-credit": [{ name: "周杰伦" }], releases: [{ title: "叶惠美", "release-group": { id: "release-group-1" } }],
    }] }), { status: 200 });
    return new Response(JSON.stringify({ syncedLyrics: "[00:01.00]故事的小黄花" }), { status: 200 });
  };
  const scraper = new MusicMetadataScraper({ fetchImpl });
  const result = await scraper.scrape({ title: "晴天", artist: "周杰伦", album: "叶惠美", durationSeconds: 269 });
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.providerId, "recording-1");
  assert.equal(result.candidate.year, "2003");
  assert.match(result.candidate.syncedLyrics, /故事的小黄花/);
});

test("cleans MV decorations and tolerates a longer video cut", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url).includes("musicbrainz.org")) return new Response(JSON.stringify({ recordings: [{
      id: "recording-mv", title: "晴天", length: 269000, "first-release-date": "2003-07-31",
      "artist-credit": [{ name: "周杰伦" }], releases: [{ title: "叶惠美" }],
    }] }), { status: 200 });
    return new Response(JSON.stringify({ syncedLyrics: "[00:01.00]故事的小黄花" }), { status: 200 });
  };
  assert.equal(cleanMediaTitle("晴天 (Official Music Video) [4K]", "mv"), "晴天");
  const score = scoreCandidate(
    { title: "晴天 (Official Music Video) [4K]", artist: "周杰伦", mediaType: "mv", durationSeconds: 335 },
    { title: "晴天", artist: "周杰伦", durationSeconds: 269 },
  );
  assert.ok(score.total > 0.9);

  const result = await new MusicMetadataScraper({ fetchImpl }).scrape({
    title: "晴天 (Official Music Video) [4K]", artist: "周杰伦", mediaType: "mv", durationSeconds: 335,
  });
  assert.equal(result.status, "matched");
  assert.match(result.candidate.syncedLyrics, /故事的小黄花/);
  assert.match(requests[0], /recording%3A%22%E6%99%B4%E5%A4%A9%22/);
  assert.doesNotMatch(requests[0], /Official/i);
});

test("keeps weak candidates for review instead of auto-applying", async () => {
  const scraper = new MusicMetadataScraper({ fetchImpl: async () => new Response(JSON.stringify({ recordings: [{
    id: "wrong", title: "完全不同", length: 120000, "artist-credit": [{ name: "其他歌手" }], releases: [{ title: "未知专辑" }],
  }] }), { status: 200 }) });
  const result = await scraper.scrape({ title: "晴天", artist: "周杰伦", album: "叶惠美", durationSeconds: 269 });
  assert.equal(result.status, "not_found");
});
