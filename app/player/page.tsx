"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ListMusic, Mic2, Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKtv } from "@/hooks/use-ktv";
import { ktvApi } from "@/lib/ktv-api";

type LyricLine = { time: number; text: string };

export default function PlayerPage() {
  const ktv = useKtv();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const lastSyncRef = useRef(0);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [position, setPosition] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);
  const playback = ktv.snapshot.playback;

  useEffect(() => {
    if (!playback.songId) { setLyrics([]); return; }
    void ktvApi.lyrics(playback.songId).then((result) => setLyrics(result.lines)).catch(() => setLyrics([]));
    const media = mediaRef.current;
    if (media && playback.playable) {
      media.src = ktvApi.mediaUrl(playback.songId);
      media.load();
      setPosition(0);
    }
  }, [playback.songId, playback.playable]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = playback.volume / 100;
    media.muted = playback.muted;
    if (playback.status === "playing" && playback.playable) {
      void media.play().then(() => setNeedsGesture(false)).catch(() => setNeedsGesture(true));
    } else media.pause();
  }, [playback.status, playback.volume, playback.muted, playback.playable]);

  const activeIndex = useMemo(() => {
    let index = -1;
    lyrics.forEach((line, current) => { if (line.time <= position) index = current; });
    return index;
  }, [lyrics, position]);

  const syncPosition = (value: number) => {
    setPosition(value);
    if (Date.now() - lastSyncRef.current > 2000) {
      lastSyncRef.current = Date.now();
      void ktv.playback({ positionSeconds: value });
    }
  };

  return (
    <main className="stage-page">
      <video ref={mediaRef} className="stage-media" playsInline onTimeUpdate={(event) => syncPosition(event.currentTarget.currentTime)} onEnded={() => void ktv.next()} />
      <div className="stage-vignette" />
      <header className="stage-header"><a href="/" className="stage-back"><ArrowLeft />返回点歌台</a><div className={`status-pill ${ktv.connected ? "status-online" : "status-offline"}`}><span />{ktv.connected ? "实时同步" : "连接中"}</div></header>
      <section className="stage-content">
        {!playback.songId ? <div className="stage-empty"><Mic2 /><h1>等待点歌</h1><p>在点歌台加入歌曲后，这里会自动开始播放。</p></div> : <>
          <div className="stage-song"><p>NOW SINGING</p><h1>{playback.title}</h1><span>{playback.artist}</span></div>
          <div className="lyrics-stack">
            <p className="lyric-before">{lyrics[activeIndex - 1]?.text || " "}</p>
            <p className="lyric-active">{lyrics[activeIndex]?.text || (playback.playable ? "音乐即将开始" : "当前歌曲缺少媒体文件")}</p>
            <p className="lyric-after">{lyrics[activeIndex + 1]?.text || " "}</p>
          </div>
        </>}
      </section>

      {needsGesture && <button className="autoplay-gate" onClick={() => void mediaRef.current?.play().then(() => setNeedsGesture(false))}><Play className="fill-current" />点击开始播放</button>}

      <footer className="stage-controls">
        <div className="stage-now"><div className="brand-mark"><Mic2 /></div><div><strong>{playback.title || "OpenKTV"}</strong><span>{playback.artist || "等待点歌"}</span></div></div>
        <div className="stage-buttons"><Button variant="ghost" size="icon" onClick={() => { if (mediaRef.current) mediaRef.current.currentTime = 0; }} className="text-white hover:bg-white/10 hover:text-white"><RotateCcw /><span className="sr-only">重唱</span></Button><Button size="icon-lg" onClick={() => void ktv.playback({ status: playback.status === "playing" ? "paused" : "playing" })} className="rounded-full bg-white text-black hover:bg-fuchsia-200">{playback.status === "playing" ? <Pause className="fill-current" /> : <Play className="fill-current" />}</Button><Button variant="ghost" size="icon" onClick={() => void ktv.next()} className="text-white hover:bg-white/10 hover:text-white"><SkipForward /><span className="sr-only">下一首</span></Button></div>
        <div className="stage-volume"><Button variant="ghost" size="icon" onClick={() => void ktv.playback({ muted: !playback.muted })} className="text-white hover:bg-white/10 hover:text-white">{playback.muted ? <VolumeX /> : <Volume2 />}</Button><input aria-label="音量" type="range" min="0" max="100" value={playback.volume} onChange={(event) => void ktv.playback({ volume: Number(event.target.value) })} /><span>{playback.volume}</span></div>
        <div className="stage-next"><ListMusic /><span>下一首</span><strong>{ktv.snapshot.queue[0]?.title || "暂无"}</strong></div>
      </footer>
    </main>
  );
}
