import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function cacheKey(mediaPath, pluginId) {
  const stat = statSync(mediaPath);
  return createHash("sha256")
    .update(`${mediaPath}\0${stat.size}\0${stat.mtimeMs}\0${pluginId}`)
    .digest("hex")
    .slice(0, 24);
}

export class StemSeparatorRegistry {
  constructor(plugins = [], { cacheDir } = {}) {
    this.plugins = new Map();
    this.cacheDir = cacheDir;
    plugins.forEach((plugin) => this.register(plugin));
  }

  register(plugin) {
    if (!plugin?.id || !plugin?.name || typeof plugin.separate !== "function" || typeof plugin.availability !== "function") {
      throw new Error("人声分离插件定义无效");
    }
    if (this.plugins.has(plugin.id)) throw new Error(`人声分离插件重复注册：${plugin.id}`);
    this.plugins.set(plugin.id, Object.freeze({ ...plugin }));
    return this;
  }

  manifest() {
    return [...this.plugins.values()].map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description || "",
      mode: plugin.mode || "automatic",
      ...plugin.availability(),
    }));
  }

  select(pluginId) {
    if (pluginId) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) throw new Error(`人声分离插件不存在：${pluginId}`);
      return plugin;
    }
    return [...this.plugins.values()].find((candidate) => candidate.availability().available) || null;
  }

  async separate(mediaPath, { pluginId } = {}) {
    const plugin = this.select(pluginId);
    if (!plugin) {
      return { path: mediaPath, separated: false, pluginId: null, warning: "没有可用的人声分离插件，已回退到原始音轨" };
    }
    const availability = plugin.availability();
    if (!availability.available) {
      return { path: mediaPath, separated: false, pluginId: plugin.id, warning: `${plugin.name} 未就绪：${availability.reason}；已回退到原始音轨` };
    }
    if (!this.cacheDir) throw new Error("人声分离缓存目录未配置");
    mkdirSync(this.cacheDir, { recursive: true });
    const key = cacheKey(mediaPath, plugin.id);
    const outputPath = join(this.cacheDir, `${key}.vocals.wav`);
    const metadataPath = join(this.cacheDir, `${key}.json`);
    if (existsSync(outputPath) && statSync(outputPath).size > 44) {
      let metadata = {};
      try { metadata = JSON.parse(readFileSync(metadataPath, "utf8")); } catch { /* old cache entry */ }
      return { path: outputPath, separated: true, pluginId: plugin.id, cached: true, ...metadata };
    }
    const temporaryOutput = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      const result = await plugin.separate({ mediaPath, outputPath: temporaryOutput, cacheDir: this.cacheDir });
      if (!existsSync(temporaryOutput) || statSync(temporaryOutput).size <= 44) throw new Error(`${plugin.name} 没有生成有效的人声音轨`);
      renameSync(temporaryOutput, outputPath);
      const metadata = { generatedAt: new Date().toISOString(), ...(result || {}) };
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      return { path: outputPath, separated: true, pluginId: plugin.id, cached: false, ...metadata };
    } finally {
      rmSync(temporaryOutput, { force: true });
    }
  }
}
