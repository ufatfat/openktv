import { closeSync, existsSync, openSync, readSync, renameSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { decodeQmcFile } from "../vendor/qmc-codec.mjs";

const OUTPUT_EXTENSIONS = new Map([
  [".qmcflac", ".flac"], [".qmflac", ".flac"], [".mflac", ".flac"], [".mflac0", ".flac"], [".bkcflac", ".flac"], [".666c6163", ".flac"],
  [".qmc0", ".mp3"], [".qmc3", ".mp3"], [".bkcmp3", ".mp3"], [".6d7033", ".mp3"],
  [".qmc2", ".ogg"], [".qmcogg", ".ogg"], [".mgg", ".ogg"], [".mgg0", ".ogg"], [".mgg1", ".ogg"], [".mggl", ".ogg"], [".bkcogg", ".ogg"], [".6f6767", ".ogg"],
  [".tkm", ".m4a"], [".mmp4", ".m4a"], [".bkcm4a", ".m4a"], [".6d3461", ".m4a"],
  [".bkcwav", ".wav"], [".776176", ".wav"],
  [".qmc4", ".decoded"], [".qmc6", ".decoded"], [".qmc8", ".decoded"], [".bkcape", ".decoded"], [".bkcwma", ".decoded"],
]);

function replaceExtension(path, extension) {
  return path.slice(0, -extname(path).length) + extension;
}

function detectDecodedMedia(path) {
  const file = openSync(path, "r");
  try {
    const header = Buffer.alloc(16);
    const length = readSync(file, header, 0, header.length, 0);
    if (length < 4) return null;
    if (header.subarray(0, 4).toString("ascii") === "fLaC") return "flac";
    if (header.subarray(0, 4).toString("ascii") === "OggS") return "ogg";
    if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE") return "wav";
    if (header.subarray(4, 8).toString("ascii") === "ftyp") return "m4a";
    if (header.subarray(0, 3).toString("ascii") === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) return "mp3";
    return null;
  } finally {
    closeSync(file);
  }
}

function validateDecodedMedia(path) {
  const container = detectDecodedMedia(path);
  if (!container) return false;
  const expected = path.toLowerCase().match(/\.(flac|ogg|wav|m4a|mp3)(?:\.openktv-\d+\.tmp)?$/)?.[1];
  return !expected || expected === container;
}

export function createQmcDecodeConverter({ decodeFile = decodeQmcFile } = {}) {
  const ekey = process.env.OPENKTV_QMC_EKEY || "";
  const ekeyDbPath = process.env.OPENKTV_QMC_EKEY_DB || "";
  return {
    id: "qmcdecode",
    name: "QMC 跨平台转换",
    extensions: [...OUTPUT_EXTENSIONS.keys()],
    outputs: [".flac", ".mp3", ".ogg", ".m4a", ".wav"],
    validateOutput: validateDecodedMedia,
    availability() {
      return {
        available: true,
        reason: ekeyDbPath || ekey
          ? "已配置外部 EKey；支持 QMC v1/v2、MusicEx、STag、QTag 和 PcV1Legacy"
          : "支持内嵌密钥和 QMC v1；MusicEx/STag 需配置 OPENKTV_QMC_EKEY_DB 或 OPENKTV_QMC_EKEY",
      };
    },
    outputPath(sourcePath) {
      const extension = OUTPUT_EXTENSIONS.get(extname(sourcePath).toLowerCase());
      if (!extension) throw new Error(`QMC 转换插件不支持：${extname(sourcePath) || "未知格式"}`);
      return replaceExtension(sourcePath, extension);
    },
    convertBatch(candidates, { overwrite = false } = {}) {
      return candidates.map(({ sourcePath, outputPath }) => {
        const temporaryOutput = `${outputPath}.openktv-${process.pid}.tmp`;
        try {
          rmSync(temporaryOutput, { force: true });
          const decoded = decodeFile(sourcePath, temporaryOutput, { ekey, ekeyDbPath });
          const container = decoded?.container || detectDecodedMedia(temporaryOutput);
          if (!container || !validateDecodedMedia(temporaryOutput)) throw new Error("解码结果不是有效的目标音频；仅支持 FLAC、MP3、OGG、M4A 或 WAV");
          const finalOutput = outputPath.endsWith(".decoded") ? replaceExtension(outputPath, `.${container}`) : outputPath;
          if (extname(finalOutput).slice(1) !== container) throw new Error(`解码结果为 ${container.toUpperCase()}，与目标扩展名不匹配`);
          if (!overwrite && existsSync(finalOutput)) {
            rmSync(temporaryOutput, { force: true });
            return { pluginId: "qmcdecode", sourcePath, outputPath: finalOutput, status: "skipped" };
          }
          if (overwrite) rmSync(finalOutput, { force: true });
          renameSync(temporaryOutput, finalOutput);
          return { pluginId: "qmcdecode", sourcePath, outputPath: finalOutput, status: "converted" };
        } catch (error) {
          rmSync(temporaryOutput, { force: true });
          return { pluginId: "qmcdecode", sourcePath, outputPath, status: "failed", error: error instanceof Error ? error.message : "QMC 转换失败" };
        }
      });
    },
  };
}
