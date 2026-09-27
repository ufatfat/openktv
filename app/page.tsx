"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, CircleAlert, Clock3, ListMusic, Mic2, MonitorPlay, Music2, Pause, Play, Plus, Search, Settings, SkipForward, Sparkles, Trash2, Volume2, VolumeX, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKtv } from "@/hooks/use-ktv";

type WebMcpTool = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
declare global { interface Document { readonly modelContext?: { registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => void | Promise<void> } } }

const categories = ["全部", "国语", "粤语", "英语", "日语", "系统"];
const tones = ["violet", "cyan", "orange", "pink", "blue", "green", "rose", "amber"];
const duration = (seconds?: number | null) => seconds ? `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : "--:--";

export default function Home() {
  const ktv = useKtv();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [queueOpen, setQueueOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const filtered = useMemo(() => ktv.songs, [ktv.songs]);

  useEffect(() => {
    const timer = window.setTimeout(() => void ktv.loadSongs(query, category === "全部" ? "" : category), 180);
    return () => window.clearTimeout(timer);
  }, [query, category, ktv.loadSongs]);

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
        return { songs: ktv.songs.filter((song) => `${song.title}${song.artist}`.toLowerCase().includes(q)).map(({ id, title, artist, playable }) => ({ id, title, artist, playable })) };
      },
    });
    register({
      name: "add_song_to_queue", title: "加入已点歌单", description: "通过歌曲 ID 将本地曲库歌曲加入全局队列。",
      inputSchema: { type: "object", properties: { songId: { type: "integer", minimum: 1 } }, required: ["songId"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const songId = typeof input === "object" && input && "songId" in input ? Number(input.songId) : NaN;
        if (!ktv.songs.some((song) => song.id === songId)) throw new Error("歌曲不存在");
        return ktv.enqueue(songId).then(() => ({ status: "queued", songId }));
      },
    });
    return () => lifecycle.abort();
  }, [ktv.songs, ktv.enqueue]);

  const playback = ktv.snapshot.playback;
  const add = async (id: number, title: string, priority = false) => {
    await ktv.enqueue(id, priority);
    setNotice(`《${title}》已${priority ? "置顶" : "加入歌单"}`);
  };

  return (
    <main className="min-h-screen bg-[#080a10] text-white">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="relative z-20 flex min-h-[72px] items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-7">
        <div className="flex items-center gap-3"><div className="brand-mark"><Mic2 className="size-5" /></div><div><p className="text-[17px] font-bold tracking-tight">OpenKTV</p><p className="text-xs text-white/38">单实例 · 全局歌单</p></div></div>
        <nav className="hidden items-center gap-1 md:flex"><Link className="nav-link nav-link-active" href="/"><ListMusic />点歌台</Link><Link className="nav-link" href="/player"><MonitorPlay />大屏播放</Link><Link className="nav-link" href="/admin"><Settings />曲库管理</Link></nav>
        <div className={`status-pill ${ktv.connected ? "status-online" : "status-offline"}`}><span />{ktv.connected ? "后端已连接" : "等待后端"}</div>
        <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setQueueOpen(true)}><ListMusic /> {ktv.snapshot.queue.length}</Button>
      </header>

      {ktv.error && <div className="relative z-20 mx-4 mt-4 flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100 sm:mx-7"><CircleAlert className="size-4" />{ktv.error}。请确认本地后端已启动。</div>}

      <div className="relative z-10 grid min-h-[calc(100vh-72px)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_370px]">
        <section className="min-w-0 px-4 py-6 sm:px-7 lg:px-9">
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-fuchsia-300"><Sparkles className="size-4" /> 本地曲库</div><h1 className="text-3xl font-black tracking-[-0.04em] sm:text-4xl">点一首，把气氛唱热</h1></div>
            <label className="relative block w-full xl:w-[360px]"><span className="sr-only">搜索歌名或歌手</span><Search className="absolute left-4 top-1/2 z-10 size-5 -translate-y-1/2 text-white/35" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌名、歌手" className="h-12 rounded-2xl border-white/10 bg-white/[0.055] pl-12 pr-10 text-base text-white shadow-none placeholder:text-white/30 focus-visible:border-fuchsia-300/50 focus-visible:ring-fuchsia-400/15" />{query && <button aria-label="清空搜索" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/45 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>}</label>
          </div>
          <nav aria-label="歌曲分类" className="scrollbar-none mb-6 flex gap-2 overflow-x-auto pb-1">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition ${category === item ? "bg-white text-black" : "border border-white/8 bg-white/[0.035] text-white/55 hover:bg-white/8 hover:text-white"}`}>{item}</button>)}</nav>
          <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-bold"><Music2 className="size-5 text-cyan-300" /> 可点歌曲</h2><span className="text-sm text-white/38">{filtered.length} 首</span></div>

          {filtered.length ? <div className="song-grid">{filtered.map((song, index) => (
            <article key={song.id} className="song-card group">
              <button className={`cover cover-${tones[song.id % tones.length]}`} onClick={() => song.playable && void ktv.playSong(song.id)} aria-label={`播放 ${song.title}`} disabled={!song.playable}><span className="cover-lines" /><span className="cover-index">{String(index + 1).padStart(2, "0")}</span><span className="cover-play"><Play className="size-5 fill-current" /></span></button>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate font-bold">{song.title}</h3>{song.playable ? <span className="media-ready">可播放</span> : <span className="media-missing">缺少媒体</span>}</div><p className="mt-1 truncate text-sm text-white/42">{song.artist} · {song.language} · {duration(song.durationSeconds)}</p></div>
              <Button title="置顶" onClick={() => void add(song.id, song.title, true)} size="icon" variant="ghost" className="rounded-xl text-white/35 hover:bg-white/8 hover:text-cyan-200"><Zap /><span className="sr-only">置顶</span></Button>
              <Button onClick={() => void add(song.id, song.title)} size="icon" className="rounded-xl bg-white/9 text-white hover:bg-fuchsia-500"><Plus /><span className="sr-only">加入歌单</span></Button>
            </article>
          ))}</div> : <div className="flex min-h-56 flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.025] text-center"><Search className="mb-3 size-8 text-white/25" /><p className="font-semibold">没有找到这首歌</p><p className="mt-1 text-sm text-white/40">换个歌名或到曲库管理执行扫描</p></div>}
        </section>

        <aside className={`queue-panel ${queueOpen ? "queue-panel-open" : ""}`}>
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-fuchsia-300/75">Global queue</p><h2 className="mt-1 text-xl font-bold">已点歌单 <span className="text-white/32">{ktv.snapshot.queue.length}</span></h2></div><Button size="icon" variant="ghost" className="text-white hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setQueueOpen(false)}><X /><span className="sr-only">关闭歌单</span></Button></div>
          <div className="mt-6 flex-1 space-y-2 overflow-y-auto pr-1">{ktv.snapshot.queue.length ? ktv.snapshot.queue.map((song, index) => (
            <div key={song.queueId} className="queue-item"><span className="w-5 text-center text-xs font-bold text-white/25">{index + 1}</span><div className={`mini-cover cover-${tones[song.id % tones.length]}`}><Music2 className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{song.title}</p><p className="mt-0.5 truncate text-xs text-white/36">{song.artist}</p></div><div className="queue-actions"><button aria-label="上移" disabled={index === 0} onClick={() => void ktv.move(song.queueId, "up")}><ChevronUp /></button><button aria-label="下移" disabled={index === ktv.snapshot.queue.length - 1} onClick={() => void ktv.move(song.queueId, "down")}><ChevronDown /></button><button aria-label="移除" onClick={() => void ktv.remove(song.queueId)}><Trash2 /></button></div></div>
          )) : <div className="py-12 text-center text-sm text-white/38"><ListMusic className="mx-auto mb-3 size-8 opacity-50" />歌单还是空的</div>}</div>
          <Link href="/player" className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-400/10 p-3 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-400/15"><MonitorPlay className="size-4" />打开大屏播放</Link>
        </aside>
        {queueOpen && <button aria-label="关闭歌单遮罩" onClick={() => setQueueOpen(false)} className="fixed inset-0 z-30 bg-black/70 lg:hidden" />}
      </div>

      <section className="player" aria-label="播放控制"><div className={`player-art cover-${tones[(playback.songId || 0) % tones.length]}`}><Mic2 className="size-6" /></div><div className="min-w-0 sm:w-52"><div className="flex items-center gap-2"><span className="playing-dot" /><p className="truncate text-sm font-bold">{playback.title || "等待点歌"}</p></div><p className="mt-0.5 truncate text-xs text-white/38">{playback.artist || "OpenKTV"}</p></div><div className="hidden min-w-0 flex-1 px-4 text-center text-sm text-white/50 md:block">{playback.playable ? "媒体已就绪，前往大屏播放" : "当前歌曲缺少本地媒体"}</div><div className="ml-auto flex items-center gap-1 sm:gap-2"><Button variant="ghost" size="icon" onClick={() => void ktv.playback({ muted: !playback.muted })} className="hidden rounded-full text-white/55 hover:bg-white/10 hover:text-white sm:inline-flex">{playback.muted ? <VolumeX /> : <Volume2 />}<span className="sr-only">静音</span></Button><Button size="icon-lg" onClick={() => void ktv.playback({ status: playback.status === "playing" ? "paused" : "playing" })} className="rounded-full bg-white text-black hover:bg-fuchsia-200">{playback.status === "playing" ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}<span className="sr-only">播放或暂停</span></Button><Button variant="ghost" size="icon" onClick={() => void ktv.next()} className="rounded-full text-white hover:bg-white/10 hover:text-white"><SkipForward /><span className="sr-only">下一首</span></Button><div className="hidden items-center gap-1 rounded-lg bg-white/5 px-2.5 py-2 text-xs text-white/45 sm:flex"><Clock3 className="size-3.5" /> {ktv.snapshot.queue.length * 4} 分钟</div></div></section>
      {notice && <div role="status" className="toast">{notice}</div>}
    </main>
  );
}
