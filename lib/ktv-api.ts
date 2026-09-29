export type Song = {
  id: number;
  title: string;
  artist: string;
  language: string;
  category: string;
  durationSeconds: number;
  playable: boolean;
  mediaType: "mv" | "audio";
  hasLyrics: boolean;
  lyricFormat: "lrc" | "krc" | "qrc" | "ttml" | "subtitle" | "ass" | null;
  hasScore: boolean;
  metadataSource: string;
  scrapedAt?: string | null;
  album: string;
  releaseYear: string;
  coverUrl: string;
  metadataId?: string | null;
  matchScore?: number | null;
  scrapeStatus: "local" | "matched" | "review" | "not_found" | "failed";
  scrapeNote: string;
};

export type QueueItem = Song & { queueId: number; position: number };

export type Playback = {
  songId: number | null;
  title: string | null;
  artist: string | null;
  durationSeconds: number | null;
  playable: boolean;
  mediaType: "mv" | "audio" | null;
  status: "playing" | "paused";
  positionSeconds: number;
  volume: number;
  muted: boolean;
  vocalMode: "original" | "accompaniment";
  pitch: number;
  updatedAt: string;
};

export type Snapshot = { playback: Playback; queue: QueueItem[] };

export type LyricSegment = { time: number; end?: number; text: string };
export type LyricLine = { time: number; end?: number; text: string; segments?: LyricSegment[] };
export type LyricDocument = {
  format: string | null;
  formatName: string | null;
  displayPlugin: string;
  lines: LyricLine[];
};
export type LyricPluginManifest = { id: string; name: string; extensions: string[]; displayPlugin: string };
export type MediaConverterPluginManifest = { id: string; name: string; extensions: string[]; outputs: string[]; available: boolean; reason: string };
export type MetadataScraperPluginManifest = { id: string; name: string; providers: string[]; mediaTypes: ("audio" | "mv")[]; capabilities: string[]; available: boolean; reason: string };
export type StemSeparatorPluginManifest = { id: string; name: string; description: string; mode: "automatic" | "desktop-bridge"; available: boolean; reason: string };
export type MediaConversionResult = {
  discovered: number;
  converted: number;
  skipped: number;
  failed: number;
  unavailable: number;
  added: number;
  scraped: number;
  songs: Song[];
};
export type SongEdit = Pick<Song, "title" | "artist" | "album" | "releaseYear" | "language" | "category" | "coverUrl"> & { organize?: boolean };
export type OrganizationResult = { status: "moved" | "skipped"; reason?: string; from?: string; to?: string; movedFiles?: number; song: Song };
export type ScoringNote = { start: number; end: number; midi: number; lyric?: string; singer?: "a" | "b" | "both" };
export type ScoringProfile = {
  version: 1;
  title?: string;
  generated?: boolean;
  analysis?: {
    audioSource: "original" | "vocals";
    separatorId: string | null;
    cachedStem: boolean;
    guidedByLyrics: boolean;
    lyricWindows: number;
    warning?: string;
  };
  notes: ScoringNote[];
};
export type ScoreResult = {
  id: number;
  songId: number;
  singerName: string;
  score: number;
  pitchScore: number;
  rhythmScore: number;
  stabilityScore: number;
  completion: number;
  maxCombo: number;
  createdAt: string;
};

export function apiBase() {
  if (typeof window === "undefined") return "http://127.0.0.1:8091";
  const configured = window.localStorage.getItem("openktv-api");
  return configured || `${window.location.protocol}//${window.location.hostname}:8091`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload as T;
}

export const ktvApi = {
  songs: (query = "", language = "") => request<{ songs: Song[] }>(`/api/songs?q=${encodeURIComponent(query)}&language=${encodeURIComponent(language)}`),
  state: () => request<Snapshot>("/api/state"),
  enqueue: (songId: number, priority = false) => request<Snapshot>("/api/queue", { method: "POST", body: JSON.stringify({ songId, priority }) }),
  move: (queueId: number, action: "up" | "down" | "top") => request<Snapshot>(`/api/queue/${queueId}`, { method: "PATCH", body: JSON.stringify({ action }) }),
  remove: (queueId: number) => request<Snapshot>(`/api/queue/${queueId}`, { method: "DELETE" }),
  playback: (changes: Partial<Playback>) => request<Snapshot>("/api/playback", { method: "PATCH", body: JSON.stringify(changes) }),
  playSong: (songId: number) => request<Snapshot>("/api/playback/play", { method: "POST", body: JSON.stringify({ songId }) }),
  next: () => request<Snapshot>("/api/playback/next", { method: "POST" }),
  scan: () => request<{ scanned: number; added: number; missing: number; scraped: number; songs: Song[] }>("/api/songs/scan", { method: "POST" }),
  scrape: () => request<{ scanned: number; updated: number; songs: Song[] }>("/api/songs/scrape", { method: "POST" }),
  scrapeOnline: (options: { limit?: number; onlyIncomplete?: boolean; fetchLyrics?: boolean; overwrite?: boolean; pluginId?: string } = {}) => request<{ processed: number; matched: number; review: number; notFound: number; failed: number; sourceWarnings: number; remaining: number; songs: Song[] }>("/api/songs/scrape/online", { method: "POST", body: JSON.stringify(options) }),
  createSong: (song: { title: string; artist: string; language: string; category: string; mediaPath?: string }) => request<{ song: Song }>("/api/songs", { method: "POST", body: JSON.stringify(song) }),
  updateSong: (id: number, song: SongEdit) => request<{ song: Song; organization: OrganizationResult | null }>(`/api/songs/${id}`, { method: "PATCH", body: JSON.stringify(song) }),
  organizeLibrary: () => request<{ processed: number; moved: number; skipped: number; failed: number; songs: Song[] }>("/api/songs/organize", { method: "POST" }),
  deleteSong: (id: number) => request<{ deleted: boolean }>(`/api/songs/${id}`, { method: "DELETE" }),
  lyrics: (id: number) => request<LyricDocument>(`/api/lyrics/${id}`),
  lyricPlugins: () => request<{ plugins: LyricPluginManifest[] }>("/api/lyrics/plugins"),
  mediaConverters: () => request<{ plugins: MediaConverterPluginManifest[] }>("/api/media/converters"),
  metadataScrapers: () => request<{ plugins: MetadataScraperPluginManifest[] }>("/api/metadata/scrapers"),
  stemSeparators: () => request<{ plugins: StemSeparatorPluginManifest[] }>("/api/stem-separators"),
  convertMedia: (overwrite = false) => request<MediaConversionResult>("/api/media/convert", { method: "POST", body: JSON.stringify({ overwrite }) }),
  scoring: (id: number) => request<{ profile: ScoringProfile | null }>(`/api/scoring/${id}`),
  generateScoring: (id: number, options: { separatorId?: string; useVocalStem?: boolean } = {}) => request<{ profile: ScoringProfile }>(`/api/scoring/${id}/generate`, { method: "POST", body: JSON.stringify(options) }),
  scoreResults: (id: number, leaderboard = false) => request<{ results: ScoreResult[] }>(`/api/scoring/${id}/results?leaderboard=${leaderboard ? "1" : "0"}`),
  saveScore: (id: number, result: Omit<ScoreResult, "id" | "songId" | "createdAt">) => request<{ result: ScoreResult }>(`/api/scoring/${id}/results`, { method: "POST", body: JSON.stringify(result) }),
  mediaUrl: (id: number) => `${apiBase()}/api/media/${id}`,
};

export function socketUrl() {
  return apiBase().replace(/^http/, "ws") + "/ws";
}
