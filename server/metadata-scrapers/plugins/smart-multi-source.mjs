import { applyFetchedLyrics, matchResult, rankCandidates } from "../provider-utils.mjs";

export function createSmartMultiSourcePlugin(providerPlugins) {
  const availableProviders = () => providerPlugins.filter((plugin) => !plugin.availability || plugin.availability().available);
  return {
    id: "smart-multi-source",
    name: "智能多源匹配",
    providers: [...new Set(providerPlugins.flatMap((plugin) => plugin.providers || []))],
    mediaTypes: ["audio", "mv"],
    capabilities: ["metadata", "cover", "synced-lyrics", "multi-source-ranking", "mv-title-cleanup"],
    availability: () => ({ available: availableProviders().length > 0, reason: availableProviders().length ? "" : "没有可用的数据源插件" }),
    async scrape(song, options = {}) {
      const settled = await Promise.allSettled(availableProviders().map(async (plugin) => ({
        plugin,
        candidates: typeof plugin.searchCandidates === "function"
          ? await plugin.searchCandidates(song, options)
          : (await plugin.scrape(song, { ...options, fetchLyrics: false })).candidates,
      })));
      const candidates = settled.flatMap((result) => result.status === "fulfilled"
        ? result.value.candidates.map((candidate) => ({ ...candidate, scraperPluginId: result.value.plugin.id }))
        : []);
      const ranked = rankCandidates(song, candidates);
      const result = matchResult(ranked);
      result.sourcesTried = availableProviders().map((plugin) => plugin.id);
      result.sourceErrors = settled.flatMap((item, index) => item.status === "rejected"
        ? [{ pluginId: availableProviders()[index].id, message: item.reason instanceof Error ? item.reason.message : "数据源请求失败" }]
        : []);
      if (result.status === "matched" && options.fetchLyrics !== false) {
        const source = providerPlugins.find((plugin) => plugin.id === result.candidate.scraperPluginId);
        if (source && typeof source.fetchLyrics === "function") {
          try {
            applyFetchedLyrics(result.candidate, await source.fetchLyrics(result.candidate, options));
          } catch (error) {
            result.candidate.lyricsError = error instanceof Error ? error.message : "歌词获取失败";
          }
        }
      }
      return result;
    },
  };
}
