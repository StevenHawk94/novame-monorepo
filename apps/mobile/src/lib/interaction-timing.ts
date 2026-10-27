/** Bounded, local-only diagnostics. No params, content, user IDs or telemetry. */
type Phase = 'handler' | 'dispatch' | 'commit' | 'transitionStart' | 'transitionEnd';
type Sample = { sequence: number; touch: number; target: string; releaseAt: number | null; phases: Partial<Record<Phase, number>> };
let releaseAt: number | null = null, sequence = 0, touch = 0;
const samples: Sample[] = [];
export function recordTouchStart() { touch++;releaseAt=null; }
// This is JS event receipt time, not a claim of native/physical touch latency.
export function recordTouchRelease() {
  releaseAt = Date.now();const sample=samples[samples.length-1];
  if(sample?.touch===touch)sample.releaseAt=releaseAt;
}
export function beginInteractionTiming(target: string) {
  const now = Date.now();
  samples.push({ sequence: ++sequence, touch, target: target.split('?')[0],
    releaseAt: releaseAt !== null && now - releaseAt < 1000 ? releaseAt : null, phases: { handler: now } });
  if (samples.length > 64) samples.shift();
}
export function markInteractionTiming(phase: Phase) {
  const sample = samples[samples.length - 1];
  if (sample && Date.now() - sample.phases.handler! < 15_000 && sample.phases[phase] === undefined)
    sample.phases[phase] = Date.now();
}
export function getInteractionTimings() { return samples.map(row => ({ ...row, phases: { ...row.phases } })); }
