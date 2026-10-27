// Reference coordinates shared by the SVG stroke and the UI-thread cursor.
export const DIGGING_PATH = 'M62 47 H366 A60 60 0 0 1 426 107 V158 A60 60 0 0 1 366 218 H116 A60 60 0 0 0 56 278 V329 A60 60 0 0 0 116 389 H418';
export const DIGGING_PATH_WIDTH = 486;
export const DIGGING_PATH_HEIGHT = 440;
export const DIGGING_PATH_LENGTH = 958 + 120 * Math.PI;
export const DIGGING_LEADER_CLEARANCE=90;
export const DIGGING_FOLLOWER_DISTANCE=48;
/** Arc-distance following works through bends; only the leader clears shovel. */
export function diggingCursorFraction(progress:number,following=false){
  'worklet';
  return Math.max(0,Math.min(1,(DIGGING_LEADER_CLEARANCE+Math.max(0,Math.min(1,progress))*(DIGGING_PATH_LENGTH-DIGGING_LEADER_CLEARANCE)-(following?DIGGING_FOLLOWER_DISTANCE:0))/DIGGING_PATH_LENGTH));
}

/** Arc-length parameterization: no per-frame native measurement/bridge calls. */
export function diggingPathPoint(progress: number) {
  'worklet';
  let d = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * DIGGING_PATH_LENGTH;
  const arc = 30 * Math.PI;
  if (d <= 304) return { x: 62 + d, y: 47, facing: 1 };
  d -= 304;
  if (d <= arc) { const a = -Math.PI / 2 + d / 60; return { x: 366 + 60 * Math.cos(a), y: 107 + 60 * Math.sin(a), facing: 1 }; }
  d -= arc;
  if (d <= 51) return { x: 426, y: 107 + d, facing: 1 };
  d -= 51;
  if (d <= arc) { const a = d / 60; return { x: 366 + 60 * Math.cos(a), y: 158 + 60 * Math.sin(a), facing: -1 }; }
  d -= arc;
  if (d <= 250) return { x: 366 - d, y: 218, facing: -1 };
  d -= 250;
  if (d <= arc) { const a = -Math.PI / 2 - d / 60; return { x: 116 + 60 * Math.cos(a), y: 278 + 60 * Math.sin(a), facing: -1 }; }
  d -= arc;
  if (d <= 51) return { x: 56, y: 278 + d, facing: -1 };
  d -= 51;
  if (d <= arc) { const a = Math.PI - d / 60; return { x: 116 + 60 * Math.cos(a), y: 329 + 60 * Math.sin(a), facing: 1 }; }
  d -= arc;
  return { x: Math.min(418, 116 + d), y: 389, facing: 1 };
}

/** 650ms of dirt motion within each 1000ms cycle; no random allocations. */
export function diggingDirtParticle(cycle: number, index: number, facing: number) {
  'worklet';
  const t = (cycle - index * .035) / .65;
  const age = Math.max(0, Math.min(1, t));
  return {
    opacity: t > 0 && t < 1 ? Math.min(1, age * 12) * (1 - age) : 0,
    x: facing * (20 + (34 + index * 7) * age),
    y: -8 - (48 + index * 5) * age + 68 * age * age,
    scale: 1 - age * .5,
  };
}
