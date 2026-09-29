"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowRight, ArrowUpToLine, Captions, CircleAlert, Clock3, Flame, Globe2, ListMusic, Mic2, MonitorPlay, Music2, Pause, Play, Plus, RotateCcw, Search, SkipForward, Sparkles, Trash2, Trophy, UserRound, Video, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentLink } from "@/components/document-link";
import { Input } from "@/components/ui/input";
import { useKtv } from "@/hooks/use-ktv";

type WebMcpTool = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
declare global { interface Document { readonly modelContext?: { registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => void | Promise<void> } } }

const categories = ["全部", "国语", "粤语", "英语", "日语", "系统"];
const duration = (seconds?: number | null) => Number.isFinite(seconds) && Number(seconds) >= 0
  ? `${String(Math.floor(Number(seconds) / 60)).padStart(2, "0")}:${String(Math.floor(Number(seconds) % 60)).padStart(2, "0")}`
  : "--:--";

export default function Home() {
  const ktv = useKtv();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [queueOpen, setQueueOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const categoriesRef = useRef<HTMLElement>(null);
  const songsRef = useRef(ktv.songs);
  const { enqueue, loadSongs } = ktv;

  useEffect(() => { songsRef.current = ktv.songs; }, [ktv.songs]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadSongs(query, category === "全部" ? "" : category), 180);
    return () => window.clearTimeout(timer);
  }, [query, category, loadSongs]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: WebMcpTool) => void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
    register({
      name: "search_songs", title: "搜索歌曲", description: "搜索当前 OpenKTV 本地曲库。",
      inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        const q = typeof input === "object" && input && "query" in input ? String(input.query).toLowerCase() : "";
        if (!q) throw new Error("query 不能为空");
        return { songs: songsRef.current.filter((song) => `${song.title}${song.artist}`.toLowerCase().includes(q)).map(({ id, title, artist, playable }) => ({ id, title, artist, playable })) };
      },
    });
    register({
      name: "add_song_to_queue", title: "加入已点歌单", description: "通过歌曲 ID 将本地曲库歌曲加入全局队列。",
      inputSchema: { type: "object", properties: { songId: { type: "integer", minimum: 1 } }, required: ["songId"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const songId = typeof input === "object" && input && "songId" in input ? Number(input.songId) : NaN;
        if (!songsRef.current.some((song) => song.id === songId)) throw new Error("歌曲不存在");
        return enqueue(songId).then(() => ({ status: "queued", songId }));
      },
    });
    return () => lifecycle.abort();
  }, [enqueue]);

  const playback = ktv.snapshot.playback;
  const progress = playback.durationSeconds ? Math.min(100, Math.max(0, (playback.positionSeconds / playback.durationSeconds) * 100)) : 0;
  const isPlaying = playback.status === "playing";
  const artists = useMemo(() => Array.from(new Map(ktv.songs.map((song) => [song.artist, song])).values()).slice(0, 8), [ktv.songs]);

  const add = async (id: number, title: string, priority = false) => {
    await ktv.enqueue(id, priority);
    setNotice(`《${title}》已${priority ? "优先加入" : "加入歌单"}`);
  };
  const showAll = () => { setQuery(""); setCategory("全部"); };
  const focusSearch = () => { searchRef.current?.focus(); };
  const showLanguages = () => categoriesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <main className="request-page">
      <header className="request-header">
        <div className="request-brand"><div className="brand-mark"><Mic2 /></div><div><strong>OpenKTV</strong><span>点一首，把气氛唱热</span></div></div>
        <label className="request-search"><Search /><Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜歌名、歌手" />{query && <button aria-label="清空搜索" onClick={() => setQuery("")}><X /></button>}</label>
        <nav className="request-nav"><DocumentLink className="request-nav-active" href="/"><Music2 />点歌</DocumentLink><DocumentLink href="/player"><MonitorPlay />大屏播放</DocumentLink></nav>
        <div className={`status-pill ${ktv.connected ? "status-online" : "status-offline"}`}><span />{ktv.connected ? "后端已连接" : "等待后端"}</div>
        <button className="mobile-queue-button" onClick={() => setQueueOpen(true)}><ListMusic />{ktv.snapshot.queue.length}</button>
      </header>

      {ktv.error && <div className="request-error"><CircleAlert />{ktv.error}。请确认本地后端已启动。</div>}

      <div className="request-layout">
        <section className="request-content">
          <div className="request-hero" role="img" aria-label="唱出更好的自己" />

          <div className="discovery-grid" aria-label="点歌方式">
            <button onClick={showAll} style={{ backgroundImage: "url('/assets/ktv-design/discover-hot.png')" }}><span><Flame />热门推荐<small>大家都在唱的歌</small></span><ArrowRight /></button>
            <button onClick={focusSearch} style={{ backgroundImage: "url('/assets/ktv-design/discover-singer.png')" }}><span><UserRound />歌手点歌<small>找你喜欢的歌手</small></span><ArrowRight /></button>
            <button onClick={showAll} style={{ backgroundImage: "url('/assets/ktv-design/discover-ranking.png')" }}><span><Trophy />排行榜<small>热门金曲等你来唱</small></span><ArrowRight /></button>
            <button onClick={showLanguages} style={{ backgroundImage: "url('/assets/ktv-design/discover-language.png')" }}><span><Globe2 />语种<small>中文 / 粤语 / 英语 / 日语</small></span><ArrowRight /></button>
          </div>

          <section className="artist-strip" aria-labelledby="artist-heading">
            <div className="section-heading"><div><Flame /><h2 id="artist-heading">热门歌手</h2></div><span>{artists.length} 位</span></div>
            <div className="artist-list">
              {artists.map((song) => <button key={song.artist} onClick={() => setQuery(song.artist)} className={query === song.artist ? "artist-active" : ""}><img src={song.coverUrl || "/assets/ktv-design/discover-singer.png"} alt="" /><span>{song.artist}</span></button>)}
              {!artists.length && <p>曲库中还没有歌手信息</p>}
            </div>
          </section>

          <nav ref={categoriesRef} aria-label="歌曲分类" className="request-categories">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? "category-active" : ""}>{item}</button>)}</nav>

          <section className="song-browser" aria-labelledby="song-heading">
            <div className="section-heading"><div><Music2 /><h2 id="song-heading">大家都在唱</h2></div><span>{ktv.songs.length} 首</span></div>
            {ktv.songs.length ? <div className="request-song-grid">{ktv.songs.map((song) => (
              <article key={song.id} className="request-song-row">
                <button className="song-cover-button" onClick={() => song.playable && void ktv.playSong(song.id)} disabled={!song.playable} aria-label={`播放 ${song.title}`}><img src={song.coverUrl || "/assets/ktv-design/discover-hot.png"} alt="" /><span><Play /></span></button>
                <div className="request-song-info"><div><h3>{song.title}</h3>{song.mediaType === "mv" && <span className="media-mv"><Video />MV</span>}{song.hasLyrics && <span className="media-lyric"><Captions /></span>}</div><p>{song.artist} · {song.language} · {duration(song.durationSeconds)}</p></div>
                <Button disabled={!song.playable} onClick={() => void add(song.id, song.title)} className="request-song-button"><Plus />点歌</Button>
              </article>
            ))}</div> : <div className="request-empty"><Search /><strong>没有找到歌曲</strong><span>换个歌名、歌手或分类试试</span></div>}
          </section>
        </section>

        <aside className={`request-queue ${queueOpen ? "request-queue-open" : ""}`}>
          <div className="queue-heading"><div><Music2 /><h2>已点 <b>{ktv.snapshot.queue.length}</b> 首</h2></div><button className="queue-close" aria-label="关闭歌单" onClick={() => setQueueOpen(false)}><X /></button></div>
          <div className="request-queue-list">{ktv.snapshot.queue.length ? ktv.snapshot.queue.map((song, index) => (
            <article key={song.queueId} className="request-queue-item">
              <span className="queue-index">{String(index + 1).padStart(2, "0")}</span><img src={song.coverUrl || "/assets/ktv-design/discover-hot.png"} alt="" />
              <div><strong>{song.title}</strong><span>{song.artist}</span></div>
              <button className="queue-top" disabled={index === 0} onClick={() => void ktv.move(song.queueId, "top")}><ArrowUpToLine />置顶</button>
              <button className="queue-delete" onClick={() => void ktv.remove(song.queueId)}><Trash2 />删除</button>
            </article>
          )) : <div className="queue-empty"><ListMusic /><strong>歌单还是空的</strong><span>点几首喜欢的歌吧</span></div>}</div>
          <DocumentLink href="/player" className="queue-screen-link"><MonitorPlay />打开大屏播放</DocumentLink>
        </aside>
        {queueOpen && <button aria-label="关闭歌单遮罩" onClick={() => setQueueOpen(false)} className="queue-backdrop" />}
      </div>

      <section className="player-console" aria-label="播放控制">
        <div className="player-now"><img className="player-art-image" src={ktv.songs.find((song) => song.id === playback.songId)?.coverUrl || "/assets/ktv-design/discover-hot.png"} alt="" /><div className="min-w-0"><div className="flex items-center gap-2"><span className={`playing-dot ${isPlaying ? "" : "playing-dot-paused"}`} /><p className="truncate font-bold">{playback.title || "等待点歌"}</p></div><p className="mt-1 truncate text-xs text-white/38">{playback.artist || "OpenKTV"}</p></div></div>
        <div className="player-transport"><div className="transport-buttons"><button title="重唱" disabled={!playback.songId} onClick={() => void ktv.playback({ positionSeconds: 0, status: "playing" })}><RotateCcw /><span>重唱</span></button><button className="transport-primary" disabled={!playback.songId || !playback.playable} onClick={() => void ktv.playback({ status: isPlaying ? "paused" : "playing" })}>{isPlaying ? <Pause className="fill-current" /> : <Play className="fill-current" />}<span>{isPlaying ? "暂停" : "播放"}</span></button><button title="切歌" disabled={!playback.songId && !ktv.snapshot.queue.length} onClick={() => void ktv.next()}><SkipForward /><span>切歌</span></button></div><div className="player-timeline"><span>{duration(playback.positionSeconds)}</span><input aria-label="播放进度" type="range" min="0" max={Math.max(1, playback.durationSeconds || 0)} step="1" value={Math.min(playback.positionSeconds, playback.durationSeconds || 1)} onChange={(event) => void ktv.playback({ positionSeconds: Number(event.target.value) })} style={{ "--progress": `${progress}%` } as CSSProperties} disabled={!playback.songId} /><span>{duration(playback.durationSeconds)}</span></div></div>
        <div className="player-volume"><button aria-label={playback.muted ? "取消静音" : "静音"} onClick={() => void ktv.playback({ muted: !playback.muted })}>{playback.muted ? <VolumeX /> : playback.volume < 50 ? <Volume1 /> : <Volume2 />}</button><input aria-label="音量" type="range" min="0" max="100" value={playback.muted ? 0 : playback.volume} onChange={(event) => void ktv.playback({ volume: Number(event.target.value), muted: false })} style={{ "--volume": `${playback.muted ? 0 : playback.volume}%` } as CSSProperties} /><span>{playback.muted ? 0 : playback.volume}</span><div className="queue-eta"><Clock3 />{ktv.snapshot.queue.length ? `约 ${ktv.snapshot.queue.length * 4} 分钟` : "歌单为空"}</div></div>
      </section>
      {notice && <div role="status" className="toast"><Sparkles />{notice}</div>}
    </main>
  );
}
