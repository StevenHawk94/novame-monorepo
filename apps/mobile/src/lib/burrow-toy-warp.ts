/** Transparent source pixels available for local pulls past the old silhouette. */
export const TOY_TEXTURE_PADDING = 80;
export const TOY_SQUEEZE_WIDTH = .5;
export const TOY_SQUEEZE_STRETCH = 1.08;
export const TOY_PUNCH_HEAD_SCALE = .8;
export const TOY_TAP_SLOP = 8;

export const TOY_WARP_SKSL = `
  uniform shader image;
  uniform float2 center;
  uniform float2 pull;
  uniform float radius;
  uniform float action;
  uniform float impact;
  uniform float2 bodyCenter;
  uniform float headBottom;
  uniform float headBlend;
  half4 main(float2 point) {
    float distanceFromTouch = distance(point, center);
    float influence = 1.0 - smoothstep(0.0, radius, distanceFromTouch);
    float2 samplePoint = point - pull * influence;
    float amount = clamp(impact, 0.0, 1.0);
    if (action > 0.5 && action < 1.5) {
      // Inverse texture mapping: dividing by .5 renders the WHOLE toy at
      // half width. Never use the last drag's radius for button animations.
      samplePoint.x = bodyCenter.x + (samplePoint.x - bodyCenter.x) / (1.0 - ${1 - TOY_SQUEEZE_WIDTH} * amount);
      samplePoint.y = bodyCenter.y + (samplePoint.y - bodyCenter.y) / (1.0 + ${TOY_SQUEEZE_STRETCH - 1} * amount);
    } else if (action > 1.5) {
      // Compress the head toward the neck, with a soft seam into the torso.
      // Head geometry follows each costume, not hard-coded screen pixels.
      float headInfluence = 1.0 - smoothstep(headBottom - headBlend, headBottom, point.y);
      samplePoint.y = headBottom + (samplePoint.y - headBottom) / (1.0 - ${1 - TOY_PUNCH_HEAD_SCALE} * amount * headInfluence);
    }
    return image.eval(samplePoint);
  }
`;

/** Reference geometry used to test the inverse shader at different scales. */
export function toyActionSamplePoint(x: number, y: number, action: 'squeeze' | 'punch', impact: number,
  bodyCenter: { x: number; y: number }, headBottom: number, headBlend: number) {
  const amount = Math.max(0, Math.min(1, impact));
  if (action === 'squeeze') return {
    x: bodyCenter.x + (x - bodyCenter.x) / (1 - (1 - TOY_SQUEEZE_WIDTH) * amount),
    y: bodyCenter.y + (y - bodyCenter.y) / (1 + (TOY_SQUEEZE_STRETCH - 1) * amount),
  };
  const influence = y >= headBottom ? 0 : y <= headBottom - headBlend ? 1
    : toyInfluence(y - (headBottom - headBlend), headBlend);
  return { x, y: headBottom + (y - headBottom) / (1 - (1 - TOY_PUNCH_HEAD_SCALE) * amount * influence) };
}

export function toyPullLimit(headWidth: number) { return headWidth * .15; }

export function clampToyPull(dx: number, dy: number, headWidth: number) {
  const limit = toyPullLimit(headWidth);
  const length = Math.hypot(dx, dy);
  const factor = length > limit ? limit / length : 1;
  return { x: dx * factor, y: dy * factor };
}

/** Matches the shader's smoothstep falloff: exactly zero outside the circle. */
export function toyInfluence(distance: number, radius: number) {
  if (distance >= radius) return 0;
  if (distance <= 0) return 1;
  const t = distance / radius;
  return 1 - t * t * (3 - 2 * t);
}
