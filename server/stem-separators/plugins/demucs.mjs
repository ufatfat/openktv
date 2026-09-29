import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const LOCAL_DEMUCS = resolve(process.cwd(), "data/tools/demucs-venv/bin/demucs");

function commandAvailable(command) {
  if (command.includes("/")) return existsSync(command);
  return spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", command]).status === 0;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Demucs 分离失败（${code}）：${stderr.trim() || "未知错误"}`)));
  });
}

function findVocals(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findVocals(path);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === "vocals.wav" && statSync(path).size > 44) return path;
  }
  return null;
}

export function createDemucsSeparator({ command = process.env.OPENKTV_DEMUCS_COMMAND || (existsSync(LOCAL_DEMUCS) ? LOCAL_DEMUCS : "demucs"), model = process.env.OPENKTV_DEMUCS_MODEL || "htdemucs" } = {}) {
  return {
    id: "demucs",
    name: "Demucs 自动人声分离",
    description: "跨平台后台分离，默认使用 htdemucs 两轨模式",
    mode: "automatic",
    availability: () => commandAvailable(command)
      ? { available: true, reason: "" }
      : { available: false, reason: "未找到 demucs；安装后或通过 OPENKTV_DEMUCS_COMMAND 指定可执行文件" },
    async separate({ mediaPath, outputPath, cacheDir }) {
      const workDir = join(cacheDir, `.demucs-${process.pid}-${Date.now()}-${basename(mediaPath).replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      mkdirSync(workDir, { recursive: true });
      try {
        await run(command, ["--two-stems", "vocals", "-n", model, "--out", workDir, mediaPath]);
        const vocals = findVocals(workDir);
        if (!vocals) throw new Error("Demucs 输出中没有 vocals.wav");
        renameSync(vocals, outputPath);
        return { model };
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
  };
}
