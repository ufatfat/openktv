import { MediaConverterRegistry } from "./registry.mjs";
import { createQmcDecodeConverter } from "./plugins/qmcdecode.mjs";

export function createDefaultMediaConverterRegistry() {
  return new MediaConverterRegistry([createQmcDecodeConverter()]);
}

export const mediaConverterRegistry = createDefaultMediaConverterRegistry();
