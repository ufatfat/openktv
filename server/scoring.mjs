import { spawnSync } from "node:child_process";

function framePitch(samples, sampleRate) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  if (Math.sqrt(energy / samples.length) < 0.012) return null;
  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.min(Math.floor(sampleRate / 70), Math.floor(samples.length / 2));
  let bestCorrelation = 0;
  const correlations = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let product = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < samples.length - lag; index += 1) {
      const left = samples[index];
      const right = samples[index + lag];
      product += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const correlation = product / Math.sqrt(leftEnergy * rightEnergy || 1);
    correlations[lag] = correlation;
    bestCorrelation = Math.max(bestCorrelation, correlation);
  }
  if (bestCorrelation < 0.68) return null;
  const threshold = Math.max(0.68, bestCorrelation * 0.96);
  let bestLag = -1;
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (correlations[lag] >= threshold && correlations[lag] >= correlations[lag - 1] && correlations[lag] >= correlations[lag + 1]) {
      bestLag = lag;
      break;
    }
  }
  if (bestLag < 0) return null;
  const frequency = sampleRate / bestLag;
  return 69 + 12 * Math.log2(frequency / 440);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function extractNotesFromPcm(pcm, sampleRate = 8000) {
  const frameSize = 1024;
  const hopSize = 800;
  const frames = [];
  for (let offset = 0; offset + frameSize <= pcm.length; offset += hopSize) {
    const midi = framePitch(pcm.subarray(offset, offset + frameSize), sampleRate);
    frames.push({ time: offset / sampleRate, midi });
  }
  const notes = [];
  let group = null;
  const flush = () => {
    if (!group || group.end - group.start < 0.24) return;
    notes.push({ start: Number(group.start.toFixed(2)), end: Number(group.end.toFixed(2)), midi: Math.round(median(group.values)) });
  };
  for (const frame of frames) {
    if (frame.midi == null) {
      flush();
      group = null;
      continue;
    }
    if (!group || Math.abs(frame.midi - median(group.values)) > 1.15 || frame.time - group.end > 0.22) {
      flush();
      group = { start: frame.time, end: frame.time + hopSize / sampleRate, values: [frame.midi] };
    } else {
      group.end = frame.time + hopSize / sampleRate;
      group.values.push(frame.midi);
    }
  }
  flush();
  return notes;
}

function pitchValuesForWindow(pcm, sampleRate, start, end) {
  const frameSize = 1024;
  const hopSize = 320;
  const firstOffset = Math.max(0, Math.floor(start * sampleRate - frameSize / 2));
  const lastOffset = Math.min(pcm.length - frameSize, Math.ceil(end * sampleRate));
  const values = [];
  for (let offset = firstOffset; offset <= lastOffset; offset += hopSize) {
    const center = (offset + frameSize / 2) / sampleRate;
    if (center < start - 0.06 || center > end + 0.06) continue;
    const midi = framePitch(pcm.subarray(offset, offset + frameSize), sampleRate);
    if (midi != null && midi >= 35 && midi <= 90) values.push(midi);
  }
  if (!values.length) return [];
  const center = median(values);
  return values.filter((value) => Math.abs(value - center) <= 2.5);
}

export function lyricWindows(lines = []) {
  return lines.flatMap((line) => Array.isArray(line.segments) && line.segments.length
    ? line.segments.map((segment, index) => ({
      start: Number(segment.time),
      end: Number(segment.end ?? line.segments[index + 1]?.time ?? line.end),
      lyric: String(segment.text || ""),
    }))
    : []).filter((window) => window.lyric.trim() && Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start);
}

export function extractGuidedNotesFromPcm(pcm, sampleRate = 8000, windows = []) {
  const candidates = windows.map((window) => {
    const values = pitchValuesForWindow(pcm, sampleRate, window.start, window.end);
    return { ...window, midi: values.length ? Math.round(median(values)) : null };
  });
  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index];
    if (current.midi != null || current.end - current.start > 0.55) continue;
    const previous = candidates[index - 1];
    const next = candidates[index + 1];
    if (previous?.midi != null && next?.midi != null && Math.abs(previous.midi - next.midi) <= 3) {
      current.midi = Math.round((previous.midi + next.midi) / 2);
    }
  }
  return candidates.filter((item) => item.midi != null).map((item) => ({
    start: Number(item.start.toFixed(3)),
    end: Number(item.end.toFixed(3)),
    midi: item.midi,
    lyric: item.lyric,
  }));
}

function decodePcm(mediaPath) {
  const sampleRate = 8000;
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", mediaPath, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "pipe:1"], {
    encoding: null,
    timeout: 120000,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw new Error(result.error.code === "ENOENT" ? "自动生成评分谱需要安装 ffmpeg" : `音频解码失败：${result.error.message}`);
  if (result.status !== 0 || !result.stdout?.length) throw new Error(`音频解码失败：${result.stderr?.toString("utf8").trim() || "媒体没有可分析的音轨"}`);
  const buffer = result.stdout;
  const pcm = new Float32Array(Math.floor(buffer.length / 2));
  for (let index = 0; index < pcm.length; index += 1) pcm[index] = buffer.readInt16LE(index * 2) / 32768;
  return { pcm, sampleRate };
}

export async function generateScoringProfile(mediaPath, { lyricLines = [], stemSeparators = null, separatorId, guidanceWarning = "" } = {}) {
  let analysisPath = mediaPath;
  let stem = { separated: false, pluginId: null };
  if (stemSeparators) {
    try { stem = await stemSeparators.separate(mediaPath, { pluginId: separatorId }); }
    catch (error) {
      stem = {
        separated: false,
        pluginId: separatorId || null,
        warning: `${error instanceof Error ? error.message : "人声分离失败"}；已回退到原始音轨`,
      };
    }
  }
  analysisPath = stem.path || mediaPath;
  let decoded;
  try { decoded = decodePcm(analysisPath); }
  catch (error) {
    if (!stem.separated) throw error;
    stem = {
      ...stem,
      separated: false,
      warning: `${stem.warning ? `${stem.warning}；` : ""}人声音轨不可解码：${error instanceof Error ? error.message : "未知错误"}；已回退到原始音轨`,
    };
    analysisPath = mediaPath;
    decoded = decodePcm(analysisPath);
  }
  const { pcm, sampleRate } = decoded;
  const windows = lyricWindows(lyricLines);
  const guidedNotes = windows.length ? extractGuidedNotesFromPcm(pcm, sampleRate, windows) : [];
  const notes = guidedNotes.length ? guidedNotes : extractNotesFromPcm(pcm, sampleRate);
  if (!notes.length) throw new Error("没有提取到稳定旋律，请改用人声更清晰的音源或手工导入评分谱");
  return {
    version: 1,
    title: guidedNotes.length ? "QRC 引导的人声旋律（建议复核）" : "自动提取旋律（建议复核）",
    generated: true,
    analysis: {
      audioSource: stem.separated ? "vocals" : "original",
      separatorId: stem.pluginId,
      cachedStem: stem.cached === true,
      guidedByLyrics: guidedNotes.length > 0,
      lyricWindows: windows.length,
      ...([stem.warning, guidanceWarning].filter(Boolean).length ? { warning: [stem.warning, guidanceWarning].filter(Boolean).join("；") } : {}),
    },
    notes,
  };
}
