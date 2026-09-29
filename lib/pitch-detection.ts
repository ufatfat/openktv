export function detectPitch(buffer: Float32Array, sampleRate: number) {
  let energy = 0;
  for (const sample of buffer) energy += sample * sample;
  if (Math.sqrt(energy / buffer.length) < 0.018) return null;

  const minOffset = Math.floor(sampleRate / 1000);
  const maxOffset = Math.min(Math.floor(sampleRate / 70), Math.floor(buffer.length / 2));
  let bestCorrelation = 0;
  const correlations: number[] = [];
  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    let product = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < buffer.length - offset; index += 1) {
      const left = buffer[index];
      const right = buffer[index + offset];
      product += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const correlation = product / Math.sqrt(leftEnergy * rightEnergy || 1);
    correlations[offset] = correlation;
    bestCorrelation = Math.max(bestCorrelation, correlation);
  }
  if (bestCorrelation < 0.72) return null;
  const threshold = Math.max(0.72, bestCorrelation * 0.96);
  for (let offset = minOffset + 1; offset < maxOffset; offset += 1) {
    if (correlations[offset] >= threshold && correlations[offset] >= correlations[offset - 1] && correlations[offset] >= correlations[offset + 1]) return sampleRate / offset;
  }
  return null;
}

export function frequencyToMidi(frequency: number) {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function octaveFlexibleCents(detectedMidi: number, targetMidi: number) {
  const semitones = ((detectedMidi - targetMidi + 6) % 12 + 12) % 12 - 6;
  return Math.abs(semitones * 100);
}

export function pitchLabel(midi: number) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const rounded = Math.round(midi);
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}
