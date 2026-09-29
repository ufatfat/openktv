"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ktvApi, socketUrl, type Playback, type Snapshot, type Song } from "@/lib/ktv-api";

const emptySnapshot: Snapshot = {
  playback: { songId: null, title: null, artist: null, durationSeconds: 0, playable: false, mediaType: null, status: "paused", positionSeconds: 0, volume: 80, muted: false, vocalMode: "accompaniment", pitch: 0, updatedAt: "" },
  queue: [],
};

export function useKtv() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const retryRef = useRef<number | null>(null);

  const loadSongs = useCallback(async (query = "", language = "") => {
    try {
      const result = await ktvApi.songs(query, language);
      setSongs(result.songs);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法连接后端");
    }
  }, []);

  useEffect(() => {
    void ktvApi.songs().then((result) => { setSongs(result.songs); setError(""); }).catch((cause) => setError(cause instanceof Error ? cause.message : "无法连接后端"));
    void ktvApi.state().then(setSnapshot).catch((cause) => setError(cause instanceof Error ? cause.message : "无法连接后端"));
    let socket: WebSocket | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(socketUrl());
      socket.onopen = () => { setConnected(true); setError(""); };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "snapshot") setSnapshot(message.data);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) retryRef.current = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      socket?.close();
      if (retryRef.current) window.clearTimeout(retryRef.current);
    };
  }, []);

  const run = useCallback(async (operation: Promise<Snapshot>) => {
    try {
      const next = await operation;
      setSnapshot(next);
      setError("");
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
      throw cause;
    }
  }, []);

  const enqueue = useCallback((songId: number, priority = false) => run(ktvApi.enqueue(songId, priority)), [run]);
  const move = useCallback((queueId: number, action: "up" | "down" | "top") => run(ktvApi.move(queueId, action)), [run]);
  const remove = useCallback((queueId: number) => run(ktvApi.remove(queueId)), [run]);
  const playback = useCallback((changes: Partial<Playback>) => run(ktvApi.playback(changes)), [run]);
  const playSong = useCallback((songId: number) => run(ktvApi.playSong(songId)), [run]);
  const next = useCallback(() => run(ktvApi.next()), [run]);

  return {
    songs, snapshot, connected, error, loadSongs,
    enqueue, move, remove, playback, playSong, next,
    refreshSongs: loadSongs,
  };
}
