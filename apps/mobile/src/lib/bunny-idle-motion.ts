import rig from './bunny-rig.json';
import motion from './bunny-motion.json';

export { rig as BUNNY_RIG, motion as BUNNY_MOTION };
export type BunnyLayer = 'head' | 'body' | 'earLeft' | 'earRight' | 'tail';
export type Point = { x: number; y: number };
function smoothstep(a: number, b: number, x: number) {
  'worklet';
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}
export function evaluateBunnyMotion(seconds: number, staticPose = false) {
  'worklet';
  const t = ((seconds * motion.breathing.speed % motion.cycleSeconds) + motion.cycleSeconds) % motion.cycleSeconds;
  const active = motion.breathingPhaseSeconds, rest = motion.cycleSeconds - active;
  const breath = !staticPose && t < active ? (1 - Math.cos(t * 2 * Math.PI / active)) / 2 : 0;
  // One breathing phase drives all parts: tallest pose has tight ears;
  // shortest pose has open ears. The accessibility pose stays undeformed.
  const opening = staticPose ? 0 : 1 - breath;
  const s = Math.max(0, Math.min(1, (t - active) / rest));
  // Squared envelope brings both position and velocity to zero at the
  // rest boundaries, so the tail never snaps or moves during breathing.
  const shake = !staticPose && t >= active
    ? Math.sin(s * 2 * Math.PI * motion.tail.shakeOscillations) * Math.sin(s * Math.PI) ** 2 : 0;
  return { liftSourcePx: motion.breathing.maxLiftSourcePx * breath,
    chestExpansion: motion.breathing.chestExpansionRatio * breath,
    earLeftDegrees: -motion.ears.openingDegreesPerEar * opening,
    earRightDegrees: motion.ears.openingDegreesPerEar * opening,
    tailDegrees: motion.tail.rotationAmplitudeDegrees * shake,
    tailTranslationSourcePx: motion.tail.translationAmplitudeSourcePx * shake, breath, opening, shake };
}
export function transformBunnyPoint(layer: BunnyLayer, point: Point, state: ReturnType<typeof evaluateBunnyMotion>): Point {
  'worklet';
  const { x, y } = point;
  if (layer === 'head' || layer === 'body') {
    const f = rig.breathingField;
    const weight = 1 - smoothstep(f.verticalFadeStartY, f.verticalFadeEndY, y);
    const chest = smoothstep(f.chestFadeInStartY, f.chestFadeInEndY, y) * (1 - smoothstep(f.chestFadeOutStartY, f.chestFadeOutEndY, y));
    return { x: x + (x - f.centerX) * state.chestExpansion * chest, y: y - state.liftSourcePx * weight };
  }
  const pivot = rig.pivots[layer];
  const angle = (layer === 'tail' ? state.tailDegrees : layer === 'earLeft' ? state.earLeftDegrees : state.earRightDegrees) * Math.PI / 180;
  const dx = x - pivot.x, dy = y - pivot.y;
  return { x: pivot.x + Math.cos(angle) * dx - Math.sin(angle) * dy + (layer === 'tail' ? state.tailTranslationSourcePx : 0),
    y: pivot.y + Math.sin(angle) * dx + Math.cos(angle) * dy - (layer === 'tail' ? 0 : state.liftSourcePx) };
}
export function bunnyViewport(width: number, height: number) {
  'worklet';
  const v = rig.referenceViewport, scale = Math.min(width / v.width, height / v.height);
  return { scale, x: (width - v.width * scale) / 2 + v.sourceOffsetX * scale,
    y: (height - v.height * scale) / 2 + v.sourceOffsetY * scale };
}
// Shared source-coordinate mesh. At Home's actual scale this is within 0.1pt
// of the 100 × 112 reference mesh; keep the comparison covered by tests.
export function bunnyMesh(columns = 48, rows = 80) {
  const textures: Point[] = [], indices: number[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++)
    textures.push({ x: x * rig.sourceCanvas.width / columns, y: y * rig.sourceCanvas.height / rows });
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const a = y * (columns + 1) + x, b = a + 1, c = a + columns + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  return { textures, indices };
}
/** The field depends only on source coordinates, never on time or outfit.
 * Compute it once on JS rather than repeating three smoothsteps per vertex
 * on the UI thread for every display frame. Keep the approved mesh unchanged. */
export function bunnyMeshWeights(points: Point[]) {
  const f = rig.breathingField;
  return points.map(({x,y}) => ({
    chestX: (x - f.centerX) * smoothstep(f.chestFadeInStartY, f.chestFadeInEndY, y)
      * (1 - smoothstep(f.chestFadeOutStartY, f.chestFadeOutEndY, y)),
    lift: 1 - smoothstep(f.verticalFadeStartY, f.verticalFadeEndY, y),
  }));
}
/** Remove only redundant rows in CONSTANT deformation fields. The omitted
 * cells are exactly affine for every phase (including source UVs), so merging
 * them changes neither the breathing field nor the existing triangulated warp.
 * Keep the original 48 columns and every nonconstant field row; no downsampling
 * of curves, outfits or display frames and no additional texture memory. */
export function bunnyRenderMesh() {
  const columns = 48, rows = 80;
  const ys = Array.from({length: rows + 1}, (_, i) => i * rig.sourceCanvas.height / rows);
  const fields = bunnyMeshWeights(ys.map(y => ({x: rig.breathingField.centerX + 1, y})));
  const retained = ys.filter((_, i) => i === 0 || i === rows
    || fields[i - 1].lift !== fields[i].lift || fields[i].lift !== fields[i + 1].lift
    || fields[i - 1].chestX !== fields[i].chestX || fields[i].chestX !== fields[i + 1].chestX);
  const textures = retained.flatMap(y => Array.from({length: columns + 1}, (_, x) => ({x: x * rig.sourceCanvas.width / columns, y})));
  const indices: number[] = [];
  for (let y = 0; y < retained.length - 1; y++) for (let x = 0; x < columns; x++) {
    const a = y * (columns + 1) + x, b = a + 1, c = a + columns + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  return {textures, indices};
}
export function deformBunnyMesh(points: Point[], weights: ReturnType<typeof bunnyMeshWeights>, lift: number, expansion: number): Point[] {
  'worklet';
  if (lift === 0 && expansion === 0) return points;
  const vertices: Point[] = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[i], w = weights[i];
    vertices[i] = {x: p.x + w.chestX * expansion, y: p.y - w.lift * lift};
  }
  return vertices;
}
// One common anchor for ALL outfits; never resize clothing variants separately.
export function homeBunnyBox(scale: number) {
  const fit = 205 / (1083 - 75), v = rig.referenceViewport;
  return { position: 'absolute' as const, left: (125 - (75 + v.sourceOffsetX) * fit) * scale,
    top: (1410 - (1258 + v.sourceOffsetY) * fit) * scale,
    width: v.width * fit * scale, height: v.height * fit * scale };
}
