import type { ComponentType } from "react";
import type { LyricLine, ScoringNote } from "@/lib/ktv-api";

export type LyricsDisplayProps = {
  lines: LyricLine[];
  position: number;
  emptyMessage?: string;
  scoringNotes?: ScoringNote[];
  pitchSamples?: Array<{ time: number; midi: number }>;
};

export type LyricsDisplayPluginModule = {
  default: ComponentType<LyricsDisplayProps>;
};
