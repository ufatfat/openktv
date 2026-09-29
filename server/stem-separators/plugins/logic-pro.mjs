import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";

function executableAvailable(command) {
  if (!command) return false;
  if (command.includes("/")) {
    try { accessSync(command, constants.X_OK); return true; } catch { return false; }
  }
  return spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", command]).status === 0;
}

function runBridge(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Logic Pro 桥接失败（${code}）：${stderr.trim() || "未知错误"}`)));
  });
}

export function createLogicProSeparator({
  command = process.env.OPENKTV_LOGIC_STEM_COMMAND || "",
  logicApp = process.env.OPENKTV_LOGIC_APP || "/Applications/Logic Pro.app",
} = {}) {
  return {
    id: "logic-pro",
    name: "Logic Pro Stem Splitter",
    description: "macOS 可选增强；通过本地辅助功能桥接程序调用 Logic Pro 并导出人声 WAV",
    mode: "desktop-bridge",
    availability() {
      if (process.platform !== "darwin") return { available: false, reason: "仅支持 macOS" };
      if (process.arch !== "arm64") return { available: false, reason: "Stem Splitter 需要 Apple Silicon" };
      if (!existsSync(logicApp)) return { available: false, reason: "未安装 Logic Pro" };
      if (!command) return { available: false, reason: "Logic Pro 没有公开自动化 API；请配置 OPENKTV_LOGIC_STEM_COMMAND 桥接程序" };
      if (!executableAvailable(command)) return { available: false, reason: `桥接程序不可执行：${command}` };
      return { available: true, reason: "" };
    },
    async separate({ mediaPath, outputPath }) {
      await runBridge(command, ["--input", mediaPath, "--output", outputPath, "--logic-app", logicApp]);
      return { logicApp, bridge: command };
    },
  };
}
