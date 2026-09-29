"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectPitch, frequencyToMidi, octaveFlexibleCents, pitchLabel } from "@/lib/pitch-detection";
import type { ScoringNote, ScoringProfile } from "@/lib/ktv-api";

type ScoreStatus = "idle" | "requesting" | "listening" | "finished" | "denied" | "unsupported";

export type KaraokeScoreState = {
  status: ScoreStatus;
  score: number;
  pitchScore: number;
  rhythmScore: number;
  stabilityScore: number;
  completion: number;
  combo: number;
  maxCombo: number;
  detectedPitch: string;
  detectedMidi: number | null;
  targetPitch: string;
  activeSinger: string;
  judgement: string;
  error: string;
};

const initialState: KaraokeScoreState = {
  status: "idle", score: 0, pitchScore: 0, rhythmScore: 0, stabilityScore: 0, completion: 0, combo: 0, maxCombo: 0,
  detectedPitch: "--", detectedMidi: null, targetPitch: "--", activeSinger: "合唱", judgement: "准备开唱", error: "",
};

function targetAt(notes: ScoringNote[], position: number) {
  let low = 0;
  let high = notes.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const note = notes[middle];
    if (position < note.start) high = middle - 1;
    else if (position > note.end) low = middle + 1;
    else return note;
  }
  return null;
}

function judgement(score: number, voiced: boolean) {
  if (!voiced) return "等待歌声";
  if (score >= 92) return "完美";
  if (score >= 78) return "很棒";
  if (score >= 60) return "不错";
  return "继续加油";
}

export function useKaraokeScore(profile: ScoringProfile | null, songId: number | null, position: number, { deviceId, enabled = true }: { deviceId?: string; enabled?: boolean } = {}) {
  const [storedState, setStoredState] = useState<KaraokeScoreState & { songId: number | null }>({ ...initialState, songId });
  const [storedPitchSamples, setStoredPitchSamples] = useState<{ songId: number | null; samples: Array<{ time: number; midi: number }> }>({ songId, samples: [] });
  const positionRef = useRef(position);
  const enabledRef = useRef(enabled);
  const runtimeRef = useRef<{ stream: MediaStream; context: AudioContext; frame: number } | null>(null);
  const totalsRef = useRef({ expected: 0, voiced: 0, pitch: 0, rhythm: 0, onsets: 0, stability: 0, stabilityFrames: 0, combo: 0, maxCombo: 0, noteKey: "", noteHeard: false, lastMidi: null as number | null });
  const state = storedState.songId === songId ? storedState : initialState;
  const pitchSamples = storedPitchSamples.songId === songId ? storedPitchSamples.samples : [];
  const updateState = useCallback((update: KaraokeScoreState | ((current: KaraokeScoreState) => KaraokeScoreState)) => {
    setStoredState((previous) => {
      const current = previous.songId === songId ? previous : { ...initialState, songId };
      const next = typeof update === "function" ? update(current) : update;
      return { ...next, songId };
    });
  }, [songId]);

  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const stopRuntime = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    window.cancelAnimationFrame(runtime.frame);
    runtime.stream.getTracks().forEach((track) => track.stop());
    void runtime.context.close();
    runtimeRef.current = null;
  }, []);

  const finish = useCallback(() => {
    stopRuntime();
    updateState((current) => current.status === "listening" ? { ...current, status: "finished", judgement: current.score >= 90 ? "金曲表现" : current.score >= 75 ? "演唱出色" : "再唱一次会更好" } : current);
  }, [stopRuntime, updateState]);

  useEffect(() => {
    stopRuntime();
    totalsRef.current = { expected: 0, voiced: 0, pitch: 0, rhythm: 0, onsets: 0, stability: 0, stabilityFrames: 0, combo: 0, maxCombo: 0, noteKey: "", noteHeard: false, lastMidi: null };
    return stopRuntime;
  }, [songId, stopRuntime]);

  const start = useCallback(async () => {
    if (!profile || runtimeRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      updateState({ ...initialState, status: "unsupported", error: "当前浏览器不支持麦克风实时评分" });
      return;
    }
    updateState((current) => ({ ...current, status: "requesting", error: "" }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: { ideal: 0.01 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
        video: false,
      });
      const context = new AudioContext({ latencyHint: "interactive" });
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const reportedInputLatency = Number(stream.getAudioTracks()[0]?.getSettings().latency) || 0;
      const analysisCenterLatency = analyser.fftSize / context.sampleRate / 2;
      const captureLatency = Math.max(0.035, Math.min(0.16, reportedInputLatency + context.baseLatency + analysisCenterLatency + 0.022));
      totalsRef.current = { expected: 0, voiced: 0, pitch: 0, rhythm: 0, onsets: 0, stability: 0, stabilityFrames: 0, combo: 0, maxCombo: 0, noteKey: "", noteHeard: false, lastMidi: null };
      let previousSample = 0;
      const runtime = { stream, context, frame: 0 };
      runtimeRef.current = runtime;
      updateState({ ...initialState, status: "listening", judgement: "正在聆听" });

      const update = (time: number) => {
        if (runtimeRef.current !== runtime) return;
        runtime.frame = window.requestAnimationFrame(update);
        if (time - previousSample < 45) return;
        previousSample = time;
        if (!enabledRef.current) return;
        const scoringPosition = Math.max(0, positionRef.current - captureLatency);
        const target = targetAt(profile.notes, scoringPosition);
        if (!target) {
          updateState((current) => ({ ...current, detectedPitch: "--", detectedMidi: null, targetPitch: "--", activeSinger: "间奏", judgement: "等待下一句" }));
          return;
        }
        analyser.getFloatTimeDomainData(samples);
        const frequency = detectPitch(samples, context.sampleRate);
        const totals = totalsRef.current;
        const noteKey = `${target.start}:${target.end}:${target.midi}:${target.singer || "both"}`;
        if (totals.noteKey !== noteKey) {
          totals.noteKey = noteKey;
          totals.noteHeard = false;
          totals.lastMidi = null;
          totals.onsets += 1;
        }
        totals.expected += 1;
        let frameScore = 0;
        if (frequency) {
          const midi = frequencyToMidi(frequency);
          setStoredPitchSamples((current) => {
            const samples = current.songId === songId ? current.samples : [];
            const freshSamples = samples.at(-1)?.time && samples.at(-1)!.time > scoringPosition + 0.5
              ? []
              : samples.filter((sample) => sample.time >= scoringPosition - 2);
            const next = [...freshSamples, { time: scoringPosition, midi }];
            return { songId, samples: next.length > 120 ? next.slice(-120) : next };
          });
          const cents = octaveFlexibleCents(midi, target.midi);
          frameScore = Math.max(0, Math.min(100, 100 - Math.max(0, cents - 18) * 0.82));
          totals.voiced += 1;
          totals.pitch += frameScore;
          if (!totals.noteHeard) {
            totals.noteHeard = true;
            totals.rhythm += Math.max(0, 100 - Math.abs(scoringPosition - target.start) * 180);
          }
          if (totals.lastMidi != null) {
            const movement = octaveFlexibleCents(midi, totals.lastMidi);
            totals.stability += Math.max(0, 100 - movement * 1.6);
            totals.stabilityFrames += 1;
          }
          totals.lastMidi = midi;
          totals.combo = frameScore >= 76 ? totals.combo + 1 : 0;
          totals.maxCombo = Math.max(totals.maxCombo, totals.combo);
          const pitchScore = totals.pitch / totals.voiced;
          const rhythmScore = totals.rhythm / totals.onsets;
          const stabilityScore = totals.stabilityFrames ? totals.stability / totals.stabilityFrames : 100;
          const completion = totals.voiced / totals.expected * 100;
          updateState({
            status: "listening",
            score: Math.round(pitchScore * 0.6 + rhythmScore * 0.2 + stabilityScore * 0.1 + completion * 0.1),
            pitchScore: Math.round(pitchScore),
            rhythmScore: Math.round(rhythmScore),
            stabilityScore: Math.round(stabilityScore),
            completion: Math.round(completion),
            combo: totals.combo,
            maxCombo: totals.maxCombo,
            detectedPitch: pitchLabel(midi),
            detectedMidi: midi,
            targetPitch: pitchLabel(target.midi),
            activeSinger: target.singer === "a" ? "A 段" : target.singer === "b" ? "B 段" : "合唱",
            judgement: judgement(frameScore, true),
            error: "",
          });
        } else {
          totals.combo = 0;
          const pitchScore = totals.voiced ? totals.pitch / totals.voiced : 0;
          const rhythmScore = totals.onsets ? totals.rhythm / totals.onsets : 0;
          const stabilityScore = totals.stabilityFrames ? totals.stability / totals.stabilityFrames : 0;
          const completion = totals.voiced / totals.expected * 100;
          updateState((current) => ({
            ...current,
            score: Math.round(pitchScore * 0.6 + rhythmScore * 0.2 + stabilityScore * 0.1 + completion * 0.1),
            pitchScore: Math.round(pitchScore),
            rhythmScore: Math.round(rhythmScore),
            stabilityScore: Math.round(stabilityScore),
            completion: Math.round(completion),
            combo: 0,
            detectedPitch: "--",
            detectedMidi: null,
            targetPitch: pitchLabel(target.midi),
            activeSinger: target.singer === "a" ? "A 段" : target.singer === "b" ? "B 段" : "合唱",
            judgement: judgement(0, false),
          }));
        }
      };
      runtime.frame = window.requestAnimationFrame(update);
    } catch (error) {
      stopRuntime();
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      updateState({ ...initialState, status: denied ? "denied" : "unsupported", error: denied ? "麦克风权限被拒绝，请在浏览器设置中允许后重试" : "无法启动麦克风评分" });
    }
  }, [deviceId, profile, songId, stopRuntime, updateState]);

  return { state, pitchSamples, start, finish, stop: finish };
}
