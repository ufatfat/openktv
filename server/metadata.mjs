const DEFAULT_USER_AGENT = "OpenKTV/0.1 (local metadata scraper)";

function normalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:feat|ft)\.?\b.*$/i, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(value) {
  const text = normalize(value);
  if (text.length < 2) return text ? [text] : [];
  return Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2));
}

export function similarity(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.86;
  const first = bigrams(a);
  const second = [...bigrams(b)];
  let overlap = 0;
  for (const item of first) {
    const index = second.indexOf(item);
    if (index >= 0) { overlap += 1; second.splice(index, 1); }
  }
  return (2 * overlap) / (first.length + second.length);
}

export function scoreCandidate(song, candidate) {
  const title = similarity(song.title, candidate.title);
  const artist = song.artist && song.artist !== "未知歌手" ? similarity(song.artist, candidate.artist) : 0.72;
  const album = song.album ? similarity(song.album, candidate.album) : 0.65;
  const localDuration = Number(song.durationSeconds) || 0;
  const remoteDuration = Number(candidate.durationSeconds) || 0;
  const duration = localDuration && remoteDuration ? Math.max(0, 1 - Math.abs(localDuration - remoteDuration) / Math.max(localDuration, remoteDuration, 1)) : 0.65;
  const total = title * 0.55 + artist * 0.25 + album * 0.05 + duration * 0.15;
  return { total: Number(total.toFixed(3)), title, artist, album, duration };
}

function artistCredit(recording) {
  return (recording["artist-credit"] || []).map((credit) => credit.name || credit.artist?.name).filter(Boolean).join(" / ");
}

function firstRelease(recording) {
  return recording.releases?.[0] || {};
}

export class MusicMetadataScraper {
  constructor({ fetchImpl = fetch, userAgent = process.env.MUSICBRAINZ_USER_AGENT || DEFAULT_USER_AGENT } = {}) {
    this.fetch = fetchImpl;
    this.userAgent = userAgent;
    this.lastMusicBrainzCall = 0;
    this.musicBrainzQueue = Promise.resolve();
  }

  async rateLimitMusicBrainz() {
    const previous = this.musicBrainzQueue;
    let release;
    this.musicBrainzQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = Math.max(0, 1050 - (Date.now() - this.lastMusicBrainzCall));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastMusicBrainzCall = Date.now();
    } finally {
      release();
    }
  }

  async searchMusicBrainz(song) {
    await this.rateLimitMusicBrainz();
    const terms = [`recording:"${song.title.replaceAll('"', "")}"`];
    if (song.artist && song.artist !== "未知歌手") terms.push(`artist:"${song.artist.replaceAll('"', "")}"`);
    const url = new URL("https://musicbrainz.org/ws/2/recording/");
    url.searchParams.set("query", terms.join(" AND "));
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "8");
    const response = await this.fetch(url, { headers: { accept: "application/json", "user-agent": this.userAgent }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`MusicBrainz 返回 ${response.status}`);
    const payload = await response.json();
    return (payload.recordings || []).map((recording) => {
      const release = firstRelease(recording);
      const releaseGroupId = release["release-group"]?.id;
      return {
        provider: "musicbrainz",
        providerId: recording.id,
        title: recording.title || "",
        artist: artistCredit(recording),
        album: release.title || "",
        year: (recording["first-release-date"] || release.date || "").slice(0, 4),
        category: recording.genres?.[0]?.name || "",
        durationSeconds: Math.round((Number(recording.length) || 0) / 1000),
        coverUrl: releaseGroupId ? `https://coverartarchive.org/release-group/${releaseGroupId}/front-250` : "",
      };
    });
  }

  async fetchLyrics(candidate) {
    const url = new URL("https://lrclib.net/api/get");
    url.searchParams.set("track_name", candidate.title);
    url.searchParams.set("artist_name", candidate.artist);
    if (candidate.album) url.searchParams.set("album_name", candidate.album);
    if (candidate.durationSeconds) url.searchParams.set("duration", String(candidate.durationSeconds));
    const response = await this.fetch(url, { headers: { accept: "application/json", "user-agent": this.userAgent }, signal: AbortSignal.timeout(10000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LRCLIB 返回 ${response.status}`);
    const payload = await response.json();
    return payload.syncedLyrics || null;
  }

  async scrape(song, { fetchLyrics = true } = {}) {
    const candidates = (await this.searchMusicBrainz(song)).map((candidate) => ({ ...candidate, score: scoreCandidate(song, candidate) })).sort((a, b) => b.score.total - a.score.total);
    const best = candidates[0] || null;
    if (!best) return { status: "not_found", candidate: null, candidates: [] };
    const status = best.score.total >= 0.78 ? "matched" : best.score.total >= 0.58 ? "review" : "not_found";
    if (status === "matched" && fetchLyrics) {
      try { best.syncedLyrics = await this.fetchLyrics(best); }
      catch (error) { best.lyricsError = error instanceof Error ? error.message : "歌词获取失败"; }
    }
    return { status, candidate: best, candidates: candidates.slice(0, 5) };
  }
}
