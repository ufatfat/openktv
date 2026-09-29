"use client";

import { useMemo, type CSSProperties } from "react";
import type { LyricLine, LyricSegment, ScoringNote } from "@/lib/ktv-api";
import type { LyricsDisplayProps } from "./types";

function progressBetween(position: number, start: number, end: number) {
  return Math.max(0, Math.min(1, (position - start) / Math.max(end - start, 0.12)));
}

function timedSegments(line: LyricLine, endTime: number): LyricSegment[] {
  if (line.segments?.length) return line.segments;
  const characters = Array.from(line.text);
  const duration = Math.max(endTime - line.time, 0.8);
  return characters.map((text, index) => ({ text, time: line.time + duration * index / Math.max(characters.length, 1) }));
}

function pitchAt(notes: ScoringNote[], start: number, end: number) {
  let best: ScoringNote | undefined;
  let bestOverlap = 0;
  for (const note of notes) {
    const overlap = Math.max(0, Math.min(end, note.end) - Math.max(start, note.start));
    if (overlap > bestOverlap) { best = note; bestOverlap = overlap; }
  }
  return best?.midi;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function octavePitchLevel(midi: number) {
  const pitchClass = ((midi % 12) + 12) % 12;
  return Math.max(0, Math.min(1, pitchClass / 11));
}

function sungPitchAt(samples: Array<{ time: number; midi: number }>, start: number, end: number, targetMidi: number) {
  const recentStart = Math.max(start, end - 0.18);
  const deltas = samples.filter((sample) => sample.time >= recentStart && sample.time <= end).map((sample) => {
    const raw = sample.midi - targetMidi;
    return ((raw + 6) % 12 + 12) % 12 - 6;
  });
  return deltas.length ? targetMidi + median(deltas) : null;
}

function KaraokeLine({ line, endTime, position, active, align, scoringNotes, pitchSamples }: {
  line?: LyricLine;
  endTime: number;
  position: number;
  active: boolean;
  align: "left" | "right";
  scoringNotes: ScoringNote[];
  pitchSamples: Array<{ time: number; midi: number }>;
}) {
  if (!line) return <p className={`karaoke-line karaoke-${align}`} aria-hidden="true">&nbsp;</p>;
  const segments = timedSegments(line, endTime);
  const directPitches = segments.map((segment, index) => pitchAt(scoringNotes, segment.time, segment.end ?? segments[index + 1]?.time ?? endTime));
  const segmentPitches = directPitches.map((midi, index) => {
    if (midi != null) return midi;
    let nearest: number | undefined;
    let distance = Number.POSITIVE_INFINITY;
    directPitches.forEach((candidate, candidateIndex) => {
      if (candidate != null && Math.abs(candidateIndex - index) < distance) {
        nearest = candidate;
        distance = Math.abs(candidateIndex - index);
      }
    });
    return nearest;
  });
  return <p className={`karaoke-line karaoke-${align} ${active ? "karaoke-active" : "karaoke-upcoming"}`} aria-label={line.text}>
    <span className="karaoke-line-text" aria-hidden="true">
      {segments.map((segment, index) => {
        const segmentEnd = segment.end ?? segments[index + 1]?.time ?? endTime;
        const progress = active ? progressBetween(position, segment.time, segmentEnd) : 0;
        const midi = segmentPitches[index];
        const pitchLevel = midi == null ? null : octavePitchLevel(Math.round(midi));
        const sungMidi = midi == null ? null : sungPitchAt(pitchSamples, segment.time, Math.min(segmentEnd, position), midi);
        const sungPitchLevel = sungMidi == null ? null : octavePitchLevel(sungMidi);
        return <span className="karaoke-token" key={`${segment.time}-${index}`}>
          {pitchLevel != null && segment.text.trim() && <span
            className="karaoke-pitch"
            title={`标准相对音高 ${Math.round(midi) % 12}${sungMidi == null ? "" : `，演唱 ${(((sungMidi % 12) + 12) % 12).toFixed(1)}`}`}
          >
            <i className="karaoke-pitch-target" style={{ "--pitch-level": pitchLevel } as CSSProperties} />
            {active && sungPitchLevel != null && <i
              className="karaoke-pitch-performance"
              style={{ "--pitch-level": sungPitchLevel, width: `${progress * 100}%` } as CSSProperties}
            />}
          </span>}
          <span className="karaoke-token-base">{segment.text}</span>
          <span className="karaoke-token-fill" style={{ clipPath: `inset(0 ${100 - progress * 100}% 0 0)` }}>{segment.text}</span>
        </span>;
      })}
    </span>
  </p>;
}

export default function TraditionalLyricsDisplay({ lines, position, emptyMessage = "", scoringNotes = [], pitchSamples = [] }: LyricsDisplayProps) {
  const activeIndex = useMemo(() => {
    let index = -1;
    lines.forEach((line, current) => { if (line.time <= position) index = current; });
    return index;
  }, [lines, position]);
  const lineEnd = (index: number) => {
    const line = lines[index];
    return line?.end ?? (line ? Math.max(line.time + 0.8, Math.min(lines[index + 1]?.time ?? line.time + 5, line.time + 12)) : 0);
  };
  const topIndex = activeIndex < 0 ? 0 : activeIndex % 2 === 0 ? activeIndex : activeIndex + 1;
  const bottomIndex = activeIndex < 0 ? -1 : activeIndex % 2 === 0 ? activeIndex + 1 : activeIndex;

  return <div className="lyrics-stack" aria-live="off">
    {lines.length ? <>
      <KaraokeLine line={lines[topIndex]} endTime={lineEnd(topIndex)} position={position} active={topIndex === activeIndex} align="left" scoringNotes={scoringNotes} pitchSamples={pitchSamples} />
      <KaraokeLine line={lines[bottomIndex]} endTime={lineEnd(bottomIndex)} position={position} active={bottomIndex === activeIndex} align="right" scoringNotes={scoringNotes} pitchSamples={pitchSamples} />
    </> : <p className="karaoke-message">{emptyMessage}</p>}
  </div>;
}
