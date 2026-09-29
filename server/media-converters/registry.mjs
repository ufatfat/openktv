import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

function walk(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

export class MediaConverterRegistry {
  constructor(plugins = []) {
    this.plugins = new Map();
    this.extensions = new Map();
    plugins.forEach((plugin) => this.register(plugin));
  }

  register(plugin) {
    if (!plugin?.id || !plugin?.name || !plugin.extensions?.length || typeof plugin.outputPath !== "function" || typeof plugin.convertBatch !== "function") {
      throw new Error("媒体转换插件定义无效");
    }
    if (this.plugins.has(plugin.id)) throw new Error(`媒体转换插件重复注册：${plugin.id}`);
    this.plugins.set(plugin.id, plugin);
    for (const extension of plugin.extensions) {
      const normalized = extension.toLowerCase();
      if (this.extensions.has(normalized)) throw new Error(`媒体转换扩展名重复注册：${normalized}`);
      this.extensions.set(normalized, plugin.id);
    }
    return this;
  }

  pluginForPath(path) {
    const id = this.extensions.get(extname(path).toLowerCase());
    return id ? this.plugins.get(id) : null;
  }

  manifest() {
    return [...this.plugins.values()].map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      extensions: plugin.extensions,
      outputs: plugin.outputs,
      ...plugin.availability(),
    }));
  }

  discover(root) {
    return walk(root).flatMap((sourcePath) => {
      const plugin = this.pluginForPath(sourcePath);
      return plugin ? [{ plugin, sourcePath, outputPath: plugin.outputPath(sourcePath) }] : [];
    });
  }

  convertDirectory(root, { overwrite = false } = {}) {
    const discovered = this.discover(root);
    const results = [];
    for (const plugin of this.plugins.values()) {
      const candidates = discovered.filter((item) => item.plugin.id === plugin.id);
      if (!candidates.length) continue;
      const availability = plugin.availability();
      if (!availability.available) {
        results.push(...candidates.map(({ sourcePath, outputPath }) => ({
          pluginId: plugin.id, sourcePath, outputPath, status: "unavailable", error: availability.reason,
        })));
        continue;
      }
      const pending = [];
      for (const candidate of candidates) {
        if (!overwrite && existsSync(candidate.outputPath)) {
          if (typeof plugin.validateOutput === "function" && !plugin.validateOutput(candidate.outputPath)) {
            results.push({ pluginId: plugin.id, sourcePath: candidate.sourcePath, outputPath: candidate.outputPath, status: "failed", error: "已有目标文件不是有效的目标音频，未覆盖该文件" });
          } else {
            results.push({ pluginId: plugin.id, sourcePath: candidate.sourcePath, outputPath: candidate.outputPath, status: "skipped" });
          }
        } else {
          pending.push(candidate);
        }
      }
      if (!pending.length) continue;
      try {
        results.push(...plugin.convertBatch(pending, { overwrite }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "媒体转换失败";
        results.push(...pending.map(({ sourcePath, outputPath }) => ({
          pluginId: plugin.id, sourcePath, outputPath, status: "failed", error: message,
        })));
      }
    }
    const count = (status) => results.filter((item) => item.status === status).length;
    return {
      discovered: discovered.length,
      converted: count("converted"),
      skipped: count("skipped"),
      failed: count("failed"),
      unavailable: count("unavailable"),
      results,
    };
  }
}
