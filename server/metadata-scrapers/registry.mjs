export class MetadataScraperRegistry {
  constructor(plugins = []) {
    this.plugins = new Map();
    plugins.forEach((plugin) => this.register(plugin));
  }

  register(plugin) {
    if (!plugin?.id || !plugin?.name || typeof plugin.scrape !== "function" || !plugin.mediaTypes?.length) {
      throw new Error("元数据刮削插件定义无效");
    }
    if (this.plugins.has(plugin.id)) throw new Error(`元数据刮削插件重复注册：${plugin.id}`);
    this.plugins.set(plugin.id, plugin);
    return this;
  }

  get(pluginId) {
    return pluginId ? this.plugins.get(pluginId) : null;
  }

  manifest() {
    return [...this.plugins.values()].map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      providers: plugin.providers || [],
      mediaTypes: plugin.mediaTypes,
      capabilities: plugin.capabilities || [],
      ...(typeof plugin.availability === "function" ? plugin.availability() : { available: true, reason: "" }),
    }));
  }

  select(song, pluginId) {
    if (pluginId) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) throw new Error(`元数据刮削插件不存在：${pluginId}`);
      if (!plugin.mediaTypes.includes(song.mediaType || "audio")) throw new Error(`插件 ${plugin.name} 不支持 ${song.mediaType || "audio"}`);
      return plugin;
    }
    return [...this.plugins.values()].find((plugin) => {
      if (!plugin.mediaTypes.includes(song.mediaType || "audio")) return false;
      return typeof plugin.availability !== "function" || plugin.availability().available;
    }) || null;
  }

  async scrape(song, options = {}) {
    const plugin = this.select(song, options.pluginId);
    if (!plugin) throw new Error(`没有支持 ${song.mediaType || "audio"} 的元数据刮削插件`);
    const availability = typeof plugin.availability === "function" ? plugin.availability() : { available: true, reason: "" };
    if (!availability.available) throw new Error(availability.reason || `插件 ${plugin.name} 当前不可用`);
    const result = await plugin.scrape(song, options);
    return { ...result, pluginId: plugin.id };
  }
}
