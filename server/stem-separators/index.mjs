import { resolve } from "node:path";
import { createDemucsSeparator } from "./plugins/demucs.mjs";
import { createLogicProSeparator } from "./plugins/logic-pro.mjs";
import { StemSeparatorRegistry } from "./registry.mjs";

export function createDefaultStemSeparatorRegistry(options = {}) {
  return new StemSeparatorRegistry([
    createDemucsSeparator(options.demucs),
    createLogicProSeparator(options.logicPro),
  ], { cacheDir: options.cacheDir || resolve(process.env.STEM_CACHE_DIR || "./data/stems") });
}

export const stemSeparatorRegistry = createDefaultStemSeparatorRegistry();
