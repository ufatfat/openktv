"use client";

import { Suspense, createElement } from "react";
import { getLyricsDisplayPlugin } from "./registry";
import type { LyricsDisplayProps } from "./types";

export function LyricsDisplayHost({ pluginId, ...props }: LyricsDisplayProps & { pluginId: string }) {
  return <Suspense fallback={<div className="lyrics-stack"><p className="karaoke-message">加载歌词显示插件…</p></div>}>
    {createElement(getLyricsDisplayPlugin(pluginId), props)}
  </Suspense>;
}
