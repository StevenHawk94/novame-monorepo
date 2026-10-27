import { ADVENTURE_FREE_DURATION_MS } from './adventure-duration';
import {teamProgress,type AdventureTeam} from './cooperative-adventure';
/** Display-only clock. Never write its predictions into Bootstrap, arrival,
 * notifications or reward commands. The durable Start intent supplies the
 * initial dates; a confirmed server deadline gently corrects this one clock. */
type Input = { identity: string; adventureId: string; pending: boolean;
  startedAt: string; endsAt: string; now: number; clockNow: number;team?:AdventureTeam|null };
type Phase = { at: number; from: number; to: number; correctionMs: number };
export type AdventureProgressMotion = { target: number; duration: number; afterwards: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const PENDING_REMAINING_MS = 1000;

export function createAdventurePresentationClock() {
  let state: { identity: string; realId?: string; duration: number; pending: boolean;
    authoritative: string; serverDeadlineClock?: number; phase: Phase; revision: number; lastClock: number;teamTiming?:string;teamEnd?:number;lastProgress?:number } | undefined;
  let lifetime = 0;
  function remainingAt(phase: Phase, now: number) {
    const elapsed = Math.max(0, now - phase.at);
    return elapsed < phase.correctionMs
      ? phase.from + (phase.to - phase.from) * elapsed / phase.correctionMs
      : phase.to - (elapsed - phase.correctionMs);
  }
  return {
    read(input: Input) {
      const start = Date.parse(input.startedAt), end = Date.parse(input.endsAt);
      const duration = Number.isFinite(end - start) && end > start ? end - start : ADVENTURE_FREE_DURATION_MS;
      const team=input.team,teamEnd=team?Date.parse(team.endsAt):end;
      const teamSpan=team?teamEnd-Date.parse(team.progressAt):duration;
      const maximum=Number.isFinite(teamSpan)&&teamSpan>=0?Math.min(duration,teamSpan):duration;
      // A command receipt may carry newer dates than the last bootstrap clock.
      // Bound by the actual frozen segment, then advance on the monotonic
      // clock; neither Free nor Plus may start at their duration + clock skew.
      const rawRemaining = Number.isFinite(teamEnd) && Number.isFinite(input.now)
        ? Math.min(maximum,Math.max(0, teamEnd - input.now)) : maximum;
      // Compare clock offsets BEFORE the duration cap. Otherwise a stale
      // pre-start estimate crossing the cap looks like a fresh clock update
      // every second and repeatedly slows an otherwise correct countdown.
      const deadlineClock = input.clockNow + (Number.isFinite(teamEnd) && Number.isFinite(input.now)
        ? Math.max(0,teamEnd-input.now) : maximum);
      const realId = input.adventureId.startsWith('pending:') ? undefined : input.adventureId;
      const authoritative = `${input.startedAt}:${input.endsAt}`;
      if (!state || state.identity !== input.identity || (realId && state.realId && realId !== state.realId)) {
        lifetime++;
        // A newly corrected server clock can put an optimistic start slightly
        // in the future. Never create a pre-start pause from that estimate.
        const initialRemaining = rawRemaining;
        state = { identity: input.identity, realId, duration, pending: input.pending, authoritative,
          serverDeadlineClock: input.pending ? undefined : deadlineClock,
          phase: { at: input.clockNow, from: initialRemaining, to: initialRemaining, correctionMs: 0 },
          revision: 0, lastClock: input.clockNow };
      }
      const clock = Math.max(state.lastClock, input.clockNow);
      state.lastClock = clock;
      if (realId) state.realId = realId; // Pending IDs are aliases, not another trip.
      const floor = Math.min(PENDING_REMAINING_MS, state.duration);
      const current = Math.max(state.pending ? floor : 0, remainingAt(state.phase, clock));
      const timing=team?`${team.id}:${team.progressAt}:${team.progressFraction}:${team.endsAt}`:undefined;
      const accelerated=!!timing&&!!state.teamTiming&&timing!==state.teamTiming&&teamEnd<(state.teamEnd??teamEnd);
      if(accelerated){
        // An actual join immediately shortens the remaining segment. Its
        // progress anchor, not (now-start)/(new end-start), preserves position.
        state.phase={at:clock,from:rawRemaining,to:rawRemaining,correctionMs:0};
        state.authoritative=authoritative;state.serverDeadlineClock=deadlineClock;state.pending=false;state.revision++;
      }else if (!input.pending && (state.pending || authoritative !== state.authoritative
        || Math.abs(deadlineClock - (state.serverDeadlineClock ?? deadlineClock)) > 1500)) {
        // Catch up or slow down without adding seconds back to the visible
        // counter or moving the cursor backwards. Small drift is absorbed over
        // at least a second; larger drift uses <= half-speed correction. Both
        // counter and path converge to the SAME actual server deadline.
        const correctionMs = Math.min(rawRemaining, Math.max(1000, 2 * Math.abs(rawRemaining - current)));
        state.phase = { at: clock, from: current, to: Math.max(0, rawRemaining - correctionMs), correctionMs };
        state.authoritative = authoritative;
        state.serverDeadlineClock = deadlineClock;
        state.pending = false;
        state.revision++;
      }
      if(timing){state.teamTiming=timing;state.teamEnd=teamEnd;}
      const remaining = Math.min(maximum,Math.max(state.pending ? floor : 0, remainingAt(state.phase, clock)));
      const frozenDuration=state.duration;
      const progressFor=(left:number)=>team?teamProgress(team,teamEnd-left):clamp(1-left/frozenDuration);
      const progress = Math.max(state.lastProgress??0,progressFor(remaining));
      state.lastProgress=progress;
      const correctionLeft = Math.max(0, state.phase.at + state.phase.correctionMs - clock);
      const motion: AdventureProgressMotion = state.pending
        ? { target: progressFor(floor), duration: Math.max(0, remaining - floor), afterwards: 0 }
        : correctionLeft > 0
          ? { target: Math.max(progress,progressFor(state.phase.to)), duration: correctionLeft, afterwards: state.phase.to }
          : { target: 1, duration: remaining, afterwards: 0 };
      return { progress, remaining, motion, lifetime, timeline: `${lifetime}:${state.revision}` };
    },
  };
}
