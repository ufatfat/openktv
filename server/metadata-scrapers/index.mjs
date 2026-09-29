import { createAcoustIdPlugin } from "./plugins/acoustid.mjs";
import { createMusicBrainzLrclibPlugin } from "./plugins/musicbrainz-lrclib.mjs";
import { createMiguPlugin } from "./plugins/migu.mjs";
import { createNeteasePlugin } from "./plugins/netease.mjs";
import { createQqMusicPlugin } from "./plugins/qqmusic.mjs";
import { createSmartMultiSourcePlugin } from "./plugins/smart-multi-source.mjs";
import { MetadataScraperRegistry } from "./registry.mjs";

export function createDefaultMetadataScraperRegistry(options = {}) {
  const providers = [
    createMusicBrainzLrclibPlugin(options),
    createNeteasePlugin(options),
    createQqMusicPlugin(options),
    createMiguPlugin(options),
    createAcoustIdPlugin(options),
  ];
  return new MetadataScraperRegistry([createSmartMultiSourcePlugin(providers), ...providers]);
}

export const metadataScraperRegistry = createDefaultMetadataScraperRegistry();
