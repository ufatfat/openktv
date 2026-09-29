"use client";

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { LyricsDisplayPluginModule, LyricsDisplayProps } from "./types";

export type LyricsDisplayPluginLoader = () => Promise<LyricsDisplayPluginModule>;

const loaders = new Map<string, LyricsDisplayPluginLoader>([
  ["traditional", () => import("./traditional")],
]);
const components = new Map<string, LazyExoticComponent<ComponentType<LyricsDisplayProps>>>();

export function registerLyricsDisplayPlugin(id: string, loader: LyricsDisplayPluginLoader) {
  if (!id.trim() || loaders.has(id)) throw new Error(`歌词显示插件重复注册：${id}`);
  loaders.set(id, loader);
}

export function loadLyricsDisplayPlugin(id: string) {
  return (loaders.get(id) || loaders.get("traditional"))!();
}

export function getLyricsDisplayPlugin(id: string) {
  const resolvedId = loaders.has(id) ? id : "traditional";
  let component = components.get(resolvedId);
  if (!component) {
    component = lazy(loaders.get(resolvedId)!);
    components.set(resolvedId, component);
  }
  return component;
}

export function lyricsDisplayPluginIds() {
  return [...loaders.keys()];
}
