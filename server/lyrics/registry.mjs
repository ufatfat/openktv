import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { assPlugin } from "./plugins/ass.mjs";
import { krcPlugin } from "./plugins/krc.mjs";
import { lrcPlugin } from "./plugins/lrc.mjs";
import { qrcPlugin } from "./plugins/qrc.mjs";
import { subtitlePlugin } from "./plugins/subtitle.mjs";
import { ttmlPlugin } from "./plugins/ttml.mjs";

export class LyricPluginRegistry {
  constructor(plugins = []) {
    this.plugins = new Map();
    this.extensions = new Map();
    plugins.forEach((plugin) => this.register(plugin));
  }

  register(plugin) {
    if (!plugin?.id || typeof plugin.parse !== "function" || !plugin.extensions?.length) throw new Error("歌词插件定义无效");
    if (this.plugins.has(plugin.id)) throw new Error(`歌词插件重复注册：${plugin.id}`);
    this.plugins.set(plugin.id, Object.freeze({ ...plugin }));
    for (const extension of plugin.extensions) this.extensions.set(extension.toLowerCase(), plugin.id);
    return this;
  }

  pluginForPath(path) {
    const normalized = path.toLowerCase();
    const match = [...this.extensions.entries()].sort(([a], [b]) => b.length - a.length).find(([extension]) => normalized.endsWith(extension));
    return this.plugins.get(match?.[1]);
  }

  parseFile(path) {
    const plugin = this.pluginForPath(path);
    if (!plugin) throw new Error(`不支持的歌词格式：${extname(path) || "未知"}`);
    const lines = plugin.parse({ content: readFileSync(path), path });
    return { format: plugin.id, formatName: plugin.name, displayPlugin: plugin.displayPlugin || "traditional", lines };
  }

  manifest() {
    return [...this.plugins.values()].map(({ id, name, extensions, displayPlugin = "traditional" }) => ({ id, name, extensions, displayPlugin }));
  }
}

export const lyricRegistry = new LyricPluginRegistry([krcPlugin, qrcPlugin, ttmlPlugin, lrcPlugin, assPlugin, subtitlePlugin]);
export const LYRIC_EXTENSIONS = Object.freeze([...lyricRegistry.extensions.keys()]);

export function findLyricSidecar(mediaPath) {
  const stem = mediaPath.replace(/\.[^.]+$/, "");
  for (const extension of LYRIC_EXTENSIONS) {
    const candidate = `${stem}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function lyricFormatForPath(path) {
  return path ? lyricRegistry.pluginForPath(path)?.id || null : null;
}
