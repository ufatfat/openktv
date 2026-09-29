"use client";

import { useEffect, useRef, useState } from "react";
import { Mic2 } from "lucide-react";
import { useKtv } from "@/hooks/use-ktv";
import { useKaraokeScore } from "@/hooks/use-karaoke-score";
import { ktvApi, type LyricDocument, type ScoringProfile } from "@/lib/ktv-api";
import { LyricsDisplayHost } from "@/plugins/lyrics-display/host";

export default function PlayerPage() {
  const ktv = useKtv();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const lastSyncRef = useRef(0);
  const lastMediaErrorRef = useRef("");
  const [lyricResult, setLyricResult] = useState<(LyricDocument & { songId: number }) | null>(null);
  const [scoringResult, setScoringResult] = useState<{ songId: number; profile: ScoringProfile | null } | null>(null);
  const [position, setPosition] = useState(0);
  const playback = ktv.snapshot.playback;
  const lyricDocument = lyricResult?.songId === playback.songId ? lyricResult : null;
  const lyrics = lyricDocument?.lines || [];
  const scoringProfile = scoringResult?.songId === playback.songId ? scoringResult.profile : null;
  const scoringNotes = scoringProfile?.notes || [];
  const { state: scoreState, pitchSamples, start: startScore } = useKaraokeScore(scoringProfile, playback.songId, position, { enabled: playback.status === "playing" });

  useEffect(() => {
    if (!scoringProfile || !playback.songId || playback.status !== "playing" || scoreState.status !== "idle") return;
    void startScore();
  }, [playback.songId, playback.status, scoreState.status, scoringProfile, startScore]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!playback.songId || !playback.playable) {
      if (media) {
        media.pause();
        media.removeAttribute("src");
        media.load();
        delete media.dataset.songId;
      }
      return;
    }
    const songId = playback.songId;
    let cancelled = false;
    void ktvApi.lyrics(songId)
      .then((result) => { if (!cancelled) setLyricResult({ songId, ...result }); })
      .catch(() => { if (!cancelled) setLyricResult({ songId, format: null, formatName: null, displayPlugin: "traditional", lines: [] }); });
    void ktvApi.scoring(songId)
      .then((result) => { if (!cancelled) setScoringResult({ songId, profile: result.profile }); })
      .catch(() => { if (!cancelled) setScoringResult({ songId, profile: null }); });
    if (media && media.dataset.songId !== String(songId)) {
      media.dataset.songId = String(songId);
      media.src = ktvApi.mediaUrl(songId);
      media.load();
    }
    return () => { cancelled = true; };
  }, [playback.songId, playback.playable]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = playback.volume / 100;
    media.muted = playback.muted;
    let disposed = false;
    let playPending = false;
    const reportError = (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (lastMediaErrorRef.current === message) return;
      lastMediaErrorRef.current = message;
      console.error(`[OpenKTV] 无法播放歌曲 ${playback.songId ?? "unknown"}: ${message}`);
    };
    const requestPlayback = async () => {
      if (disposed || playPending || !media.paused || playback.status !== "playing" || !playback.playable) return;
      playPending = true;
      try {
        await media.play();
        lastMediaErrorRef.current = "";
      } catch (error) {
        reportError(error);
      } finally {
        playPending = false;
      }
    };
    const reportMediaElementError = () => {
      const error = media.error;
      reportError(error ? `MediaError ${error.code}: ${error.message || "媒体加载失败"}` : "媒体加载失败");
    };
    const resumeAfterGesture = () => { void requestPlayback(); };
    const resumeWhenReady = () => { void requestPlayback(); };
    media.addEventListener("canplay", resumeWhenReady);
    media.addEventListener("error", reportMediaElementError);
    window.addEventListener("pointerdown", resumeAfterGesture);
    window.addEventListener("keydown", resumeAfterGesture);
    if (playback.status === "playing" && playback.playable) void requestPlayback();
    else {
      media.pause();
    }
    return () => {
      disposed = true;
      media.removeEventListener("canplay", resumeWhenReady);
      media.removeEventListener("error", reportMediaElementError);
      window.removeEventListener("pointerdown", resumeAfterGesture);
      window.removeEventListener("keydown", resumeAfterGesture);
    };
  }, [playback.songId, playback.status, playback.volume, playback.muted, playback.playable]);

  useEffect(() => {
    if (playback.status !== "playing" || !playback.playable) return;
    let frame = 0;
    let lastUpdate = 0;
    const update = (time: number) => {
      if (time - lastUpdate >= 33 && mediaRef.current) {
        lastUpdate = time;
        setPosition(mediaRef.current.currentTime);
      }
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [playback.songId, playback.status, playback.playable]);

  const syncPosition = (value: number) => {
    if (Date.now() - lastSyncRef.current > 2000) {
      lastSyncRef.current = Date.now();
      void ktv.playback({ positionSeconds: value }).catch(() => undefined);
    }
  };

  return (
    <main className={`stage-page stage-clean ${playback.mediaType === "mv" ? "stage-has-mv" : "stage-audio"}`}>
      <video
        ref={mediaRef}
        className="stage-media"
        preload="auto"
        playsInline
        onLoadedMetadata={(event) => {
          const start = Math.min(playback.positionSeconds || 0, event.currentTarget.duration || 0);
          event.currentTarget.currentTime = start;
          setPosition(start);
        }}
        onTimeUpdate={(event) => syncPosition(event.currentTarget.currentTime)}
        onEnded={() => void ktv.next().catch(() => undefined)}
      />
      {lyrics.length > 0 && <>
        <div className="stage-vignette" />
        <section className="stage-content" aria-label="同步歌词">
          <LyricsDisplayHost pluginId={lyricDocument?.displayPlugin || "traditional"} lines={lyrics} position={position} scoringNotes={scoringNotes} pitchSamples={pitchSamples} />
        </section>
      </>}
      {!playback.songId && <section className="stage-content" aria-label="等待点歌"><div className="stage-empty"><Mic2 /><h1>等待点歌</h1></div></section>}
    </main>
  );
}
