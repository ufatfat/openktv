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
  metadataSource: "manual" | "filename" | "embedded" | "musicbrainz" | "system" | "demo";
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
  scan: () => request<{ scanned: number; added: number; scraped: number; songs: Song[] }>("/api/songs/scan", { method: "POST" }),
  scrape: () => request<{ scanned: number; updated: number; songs: Song[] }>("/api/songs/scrape", { method: "POST" }),
  scrapeOnline: (options: { limit?: number; onlyIncomplete?: boolean; fetchLyrics?: boolean; overwrite?: boolean } = {}) => request<{ processed: number; matched: number; review: number; notFound: number; failed: number; remaining: number; songs: Song[] }>("/api/songs/scrape/online", { method: "POST", body: JSON.stringify(options) }),
  createSong: (song: { title: string; artist: string; language: string; category: string; mediaPath?: string }) => request<{ song: Song }>("/api/songs", { method: "POST", body: JSON.stringify(song) }),
  deleteSong: (id: number) => request<{ deleted: boolean }>(`/api/songs/${id}`, { method: "DELETE" }),
  lyrics: (id: number) => request<{ lines: Array<{ time: number; text: string }> }>(`/api/lyrics/${id}`),
  mediaUrl: (id: number) => `${apiBase()}/api/media/${id}`,
};

export function socketUrl() {
  return apiBase().replace(/^http/, "ws") + "/ws";
}
