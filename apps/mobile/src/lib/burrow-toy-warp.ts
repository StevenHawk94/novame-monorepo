/** Transparent source pixels available for local pulls past the old silhouette. */
export const TOY_TEXTURE_PADDING = 80;

export const TOY_WARP_SKSL = `
  uniform shader image;
  uniform float2 center;
  uniform float2 pull;
  uniform float radius;
  uniform float action;
  uniform float impact;
  uniform float2 bodyCenter;
  half4 main(float2 point) {
    float distanceFromTouch = distance(point, center);
    float influence = 1.0 - smoothstep(0.0, radius, distanceFromTouch);
    float2 samplePoint = point - pull * influence;
    float bodyInfluence = 1.0 - smoothstep(0.0, radius * 1.65, distance(point, bodyCenter));
    if (action > 0.5 && action < 1.5) {
      samplePoint.x = bodyCenter.x + (samplePoint.x - bodyCenter.x) * (1.0 + 0.18 * impact * bodyInfluence);
      samplePoint.y = bodyCenter.y + (samplePoint.y - bodyCenter.y) * (1.0 - 0.10 * impact * bodyInfluence);
    } else if (action > 1.5) {
      samplePoint.y += 18.0 * impact * bodyInfluence;
      samplePoint.x -= 8.0 * impact * bodyInfluence;
    }
    return image.eval(samplePoint);
  }
`;

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
