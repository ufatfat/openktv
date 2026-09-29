import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StemSeparatorRegistry } from "./registry.mjs";
import { createLogicProSeparator } from "./plugins/logic-pro.mjs";

test("falls back to the original media when no separator is available", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openktv-stems-"));
  try {
    const mediaPath = join(directory, "song.wav");
    writeFileSync(mediaPath, "source");
    const registry = new StemSeparatorRegistry([], { cacheDir: join(directory, "cache") });
    const result = await registry.separate(mediaPath);
    assert.equal(result.path, mediaPath);
    assert.equal(result.separated, false);
    assert.match(result.warning, /回退到原始音轨/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("caches a generated vocal stem", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openktv-stems-"));
  let calls = 0;
  try {
    const mediaPath = join(directory, "song.wav");
    writeFileSync(mediaPath, "source");
    const registry = new StemSeparatorRegistry([{
      id: "fixture", name: "Fixture", availability: () => ({ available: true, reason: "" }),
      async separate({ outputPath }) { calls += 1; writeFileSync(outputPath, Buffer.alloc(128)); return { model: "fixture-v1" }; },
    }], { cacheDir: join(directory, "cache") });
    const first = await registry.separate(mediaPath);
    const second = await registry.separate(mediaPath);
    assert.equal(first.separated, true);
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
    assert.equal(readFileSync(second.path).length, 128);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("reports why the Logic Pro bridge is not ready", () => {
  const plugin = createLogicProSeparator({ command: "", logicApp: "/Applications/Logic Pro.app" });
  const availability = plugin.availability();
  assert.equal(typeof availability.available, "boolean");
  if (!availability.available) assert.ok(availability.reason.length > 0);
});
