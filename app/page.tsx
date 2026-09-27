"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock3, Heart, ListMusic, Mic2, Music2, Pause, Play, Plus, Search, SkipForward, Sparkles, Trash2, Users, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Song = { id: number; title: string; artist: string; language: string; mood: string; duration: string; tone: string };

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};

declare global {
  interface Document {
    readonly modelContext?: {
      registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

const songs: Song[] = [
  { id: 1, title: "晚风来信", artist: "林屿", language: "国语", mood: "流行", duration: "04:12", tone: "violet" },
  { id: 2, title: "沿海公路", artist: "沈星", language: "国语", mood: "轻快", duration: "03:48", tone: "cyan" },
  { id: 3, title: "玻璃晴朗", artist: "Nine Days", language: "粤语", mood: "经典", duration: "04:36", tone: "orange" },
  { id: 4, title: "心跳失真", artist: "NOVA", language: "国语", mood: "摇滚", duration: "03:29", tone: "pink" },
  { id: 5, title: "Moon River", artist: "Audrey H.", language: "英语", mood: "经典", duration: "02:46", tone: "blue" },
  { id: 6, title: "城市漂流", artist: "无边乐队", language: "国语", mood: "乐队", duration: "04:01", tone: "green" },
  { id: 7, title: "First Love", artist: "Hikari", language: "日语", mood: "抒情", duration: "04:18", tone: "rose" },
  { id: 8, title: "夏日回声", artist: "岛屿电台", language: "国语", mood: "轻快", duration: "03:34", tone: "amber" },
];

const categories = ["全部", "国语", "粤语", "英语", "日语", "经典"];
const lyrics = ["灯光掠过窗边", "我们把夜晚唱得很慢", "让风替沉默写一封信", "落在此刻的海岸"];

export default function Home() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [queue, setQueue] = useState<Song[]>([songs[1], songs[3], songs[7]]);
  const [current, setCurrent] = useState<Song>(songs[0]);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [liked, setLiked] = useState<number[]>([1]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(38);

  const filteredSongs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return songs.filter((song) => {
      const matchesCategory = category === "全部" || song.language === category || song.mood === category;
      return matchesCategory && (!needle || `${song.title}${song.artist}`.toLowerCase().includes(needle));
    });
  }, [category, query]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setProgress((value) => (value >= 99 ? 0 : value + 0.2)), 1000);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const reportError = (error: unknown) => console.warn("WebMCP tool registration failed", error);

    const registrations = [
      context.registerTool({
        name: "search_songs",
        title: "搜索歌曲",
        description: "按歌名或歌手搜索 OpenKTV 当前可点的歌曲。",
        inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"], additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          const query = typeof input === "object" && input !== null && "query" in input ? String(input.query).trim().toLowerCase() : "";
          if (!query) throw new Error("query 必须是非空字符串");
          return { songs: songs.filter((song) => `${song.title}${song.artist}`.toLowerCase().includes(query)).map(({ id, title, artist, language, duration }) => ({ id, title, artist, language, duration })) };
        },
      }, { signal: lifecycle.signal }),
      context.registerTool({
        name: "add_song_to_queue",
        title: "加入已点歌单",
        description: "通过歌曲 ID 将一首可点歌曲加入当前可见的已点歌单。",
        inputSchema: { type: "object", properties: { songId: { type: "integer", minimum: 1 } }, required: ["songId"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const songId = typeof input === "object" && input !== null && "songId" in input ? Number(input.songId) : NaN;
          const song = songs.find((item) => item.id === songId);
          if (!song) throw new Error("没有找到对应歌曲");
          setQueue((items) => [...items, song]);
          setNotice(`《${song.title}》已加入歌单`);
          return { status: "queued", song: { id: song.id, title: song.title, artist: song.artist } };
        },
      }, { signal: lifecycle.signal }),
    ];
    registrations.forEach((registration) => void Promise.resolve(registration).catch(reportError));
    return () => lifecycle.abort();
  }, []);

  function addToQueue(song: Song) {
    setQueue((items) => [...items, song]);
    setNotice(`《${song.title}》已加入歌单`);
  }

  function playNext() {
    if (!queue.length) return setNotice("歌单已经唱完啦");
    setCurrent(queue[0]);
    setQueue((items) => items.slice(1));
    setProgress(0);
    setPlaying(true);
  }

  function moveSong(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= queue.length) return;
    setQueue((items) => {
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <main className="min-h-screen bg-[#080a10] text-white">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="relative z-20 flex h-[72px] items-center justify-between border-b border-white/8 px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="brand-mark"><Mic2 className="size-5" /></div>
          <div><p className="text-[17px] font-bold tracking-tight">OpenKTV</p><p className="text-xs text-white/38">ROOM 08 · 欢乐进行中</p></div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/8 px-3 py-2 text-sm text-emerald-200 sm:flex"><span className="size-2 rounded-full bg-emerald-300 shadow-[0_0_12px_#6ee7b7]" />音响已连接</div>
        <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setQueueOpen(true)}><ListMusic /> 已点 {queue.length}</Button>
      </header>

      <div className="relative z-10 grid min-h-[calc(100vh-72px)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_370px]">
        <section className="min-w-0 px-4 py-6 sm:px-7 lg:px-9">
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-fuchsia-300"><Sparkles className="size-4" /> 今晚想唱什么？</div><h1 className="text-3xl font-black tracking-[-0.04em] sm:text-4xl">点一首，把气氛唱热</h1></div>
            <label className="relative block w-full xl:w-[360px]">
              <span className="sr-only">搜索歌名或歌手</span><Search className="absolute left-4 top-1/2 z-10 size-5 -translate-y-1/2 text-white/35" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌名、歌手" className="h-12 rounded-2xl border-white/10 bg-white/[0.055] pl-12 pr-10 text-base text-white shadow-none placeholder:text-white/30 focus-visible:border-fuchsia-300/50 focus-visible:ring-fuchsia-400/15" />
              {query && <button aria-label="清空搜索" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/45 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>}
            </label>
          </div>

          <nav aria-label="歌曲分类" className="scrollbar-none mb-6 flex gap-2 overflow-x-auto pb-1">
            {categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition ${category === item ? "bg-white text-black" : "border border-white/8 bg-white/[0.035] text-white/55 hover:bg-white/8 hover:text-white"}`}>{item}</button>)}
          </nav>

          <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-bold"><Music2 className="size-5 text-cyan-300" /> 热门歌单</h2><span className="text-sm text-white/38">{filteredSongs.length} 首可点</span></div>
          {filteredSongs.length ? (
            <div className="song-grid">
              {filteredSongs.map((song, index) => (
                <article key={song.id} className="song-card group">
                  <button className={`cover cover-${song.tone}`} onClick={() => { setCurrent(song); setPlaying(true); setProgress(0); }} aria-label={`播放 ${song.title}`}><span className="cover-lines" /><span className="cover-index">{String(index + 1).padStart(2, "0")}</span><span className="cover-play"><Play className="size-5 fill-current" /></span></button>
                  <div className="min-w-0 flex-1"><h3 className="truncate font-bold">{song.title}</h3><p className="mt-1 truncate text-sm text-white/42">{song.artist} · {song.language}</p></div>
                  <button aria-label={liked.includes(song.id) ? "取消收藏" : "收藏"} onClick={() => setLiked((items) => items.includes(song.id) ? items.filter((id) => id !== song.id) : [...items, song.id])} className={`rounded-xl p-2 transition ${liked.includes(song.id) ? "text-pink-400" : "text-white/25 hover:bg-white/5 hover:text-white"}`}><Heart className={`size-4 ${liked.includes(song.id) ? "fill-current" : ""}`} /></button>
                  <Button onClick={() => addToQueue(song)} size="icon" className="rounded-xl bg-white/9 text-white hover:bg-fuchsia-500"><Plus /><span className="sr-only">加入歌单</span></Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.025] text-center"><Search className="mb-3 size-8 text-white/25" /><p className="font-semibold">没有找到这首歌</p><p className="mt-1 text-sm text-white/40">换个歌名或歌手试试</p></div>
          )}
        </section>

        <aside className={`queue-panel ${queueOpen ? "queue-panel-open" : ""}`}>
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-fuchsia-300/75">Up next</p><h2 className="mt-1 text-xl font-bold">已点歌单 <span className="text-white/32">{queue.length}</span></h2></div><Button size="icon" variant="ghost" className="text-white hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setQueueOpen(false)}><X /><span className="sr-only">关闭歌单</span></Button></div>
          <div className="mt-6 flex-1 space-y-2 overflow-y-auto pr-1">
            {queue.length ? queue.map((song, index) => (
              <div key={`${song.id}-${index}`} className="queue-item">
                <span className="w-5 text-center text-xs font-bold text-white/25">{index + 1}</span><div className={`mini-cover cover-${song.tone}`}><Music2 className="size-4" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{song.title}</p><p className="mt-0.5 truncate text-xs text-white/36">{song.artist}</p></div>
                <div className="queue-actions"><button aria-label="上移" disabled={index === 0} onClick={() => moveSong(index, -1)}><ChevronUp /></button><button aria-label="下移" disabled={index === queue.length - 1} onClick={() => moveSong(index, 1)}><ChevronDown /></button><button aria-label="移除" onClick={() => setQueue((items) => items.filter((_, i) => i !== index))}><Trash2 /></button></div>
              </div>
            )) : <div className="py-12 text-center text-sm text-white/38"><ListMusic className="mx-auto mb-3 size-8 opacity-50" />歌单还是空的</div>}
          </div>
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.035] p-3 text-xs text-white/45"><Users className="size-4 text-cyan-300" /> 3 位朋友正在共同点歌</div>
        </aside>
        {queueOpen && <button aria-label="关闭歌单遮罩" onClick={() => setQueueOpen(false)} className="fixed inset-0 z-30 bg-black/70 lg:hidden" />}
      </div>

      <section className="player" aria-label="正在播放">
        <div className={`player-art cover-${current.tone}`}><Mic2 className="size-6" /></div>
        <div className="min-w-0 sm:w-48"><div className="flex items-center gap-2"><span className="playing-dot" /><p className="truncate text-sm font-bold">{current.title}</p></div><p className="mt-0.5 truncate text-xs text-white/38">{current.artist}</p></div>
        <div className="hidden min-w-0 flex-1 px-4 md:block"><p className="truncate text-center text-sm text-white/72">{lyrics[Math.floor(progress / 25) % lyrics.length]}</p><div className="mt-2 flex items-center gap-3 text-[11px] text-white/32"><span>01:37</span><button aria-label="调整播放进度" className="progress-track" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setProgress(((event.clientX - rect.left) / rect.width) * 100); }}><span style={{ width: `${progress}%` }} /></button><span>{current.duration}</span></div></div>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Button variant="ghost" size="icon" onClick={() => setMuted((value) => !value)} className="hidden rounded-full text-white/55 hover:bg-white/10 hover:text-white sm:inline-flex">{muted ? <VolumeX /> : <Volume2 />}<span className="sr-only">{muted ? "取消静音" : "静音"}</span></Button>
          <Button size="icon-lg" onClick={() => setPlaying((value) => !value)} className="rounded-full bg-white text-black hover:bg-fuchsia-200">{playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}<span className="sr-only">{playing ? "暂停" : "播放"}</span></Button>
          <Button variant="ghost" size="icon" onClick={playNext} className="rounded-full text-white hover:bg-white/10 hover:text-white"><SkipForward /><span className="sr-only">下一首</span></Button>
          <div className="hidden items-center gap-1 rounded-lg bg-white/5 px-2.5 py-2 text-xs text-white/45 sm:flex"><Clock3 className="size-3.5" /> {queue.length * 4} 分钟</div>
        </div>
      </section>
      {notice && <div role="status" className="toast">{notice}</div>}
    </main>
  );
}
