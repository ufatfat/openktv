import { MusicMetadataScraper } from "../../metadata.mjs";
import { rankCandidates } from "../provider-utils.mjs";

export function createMusicBrainzLrclibPlugin(options = {}) {
  const scraper = new MusicMetadataScraper(options);
  const plugin = {
    id: "musicbrainz-lrclib",
    name: "MusicBrainz + LRCLIB",
    providers: ["MusicBrainz", "LRCLIB", "Cover Art Archive"],
    mediaTypes: ["audio", "mv"],
    capabilities: ["metadata", "cover", "synced-lyrics", "mv-title-cleanup"],
    availability: () => ({ available: true, reason: "" }),
    searchCandidates: async (song) => rankCandidates(song, await scraper.searchMusicBrainz(song)),
    fetchLyrics: (candidate) => scraper.fetchLyrics(candidate),
    scrape: (song, scrapeOptions) => scraper.scrape(song, scrapeOptions),
  };
  return plugin;
}
