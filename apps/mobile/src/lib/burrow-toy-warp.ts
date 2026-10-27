/** Transparent source pixels available for local pulls past the old silhouette. */
export const TOY_TEXTURE_PADDING = 140;
export const TOY_SQUEEZE_WIDTH = .7;
export const TOY_SQUEEZE_STRETCH = 1.15;
export const TOY_PUNCH_HEAD_SCALE = .7; // Compatibility name: punch now affects the whole doll.
export const TOY_TAP_SLOP = 8;

export const TOY_WARP_SKSL = `
  uniform shader image;
  uniform float2 bodyBase;
  uniform float2 axes;
  uniform float4 rubs[4];
  uniform float4 pulls[4];
  uniform float pullRadius;
  uniform float pullLimit;
  float influence(float2 p, float2 c, float r) {
    float w=1.0-smoothstep(0.0,r,distance(p,c));
    return w*w;
  }
  half4 main(float2 point) {
    float2 src=bodyBase+(point-bodyBase)/axes;
    float2 rubDelta=float2(0.0);
    float rubWeight=0.0;
    for(int i=0;i<4;i++) {
      float4 r=rubs[i];
      if(abs(r.w)>0.0005) {
        float w=influence(src,r.xy,max(1.0,r.z));
        float amount=1.0/max(0.65,1.0+r.w*w)-1.0;
        rubDelta+=(src-r.xy)*amount;rubWeight+=abs(amount);
      }
    }
    src+=rubDelta*min(1.0,0.38/max(0.001,rubWeight));
    float2 pullDelta=float2(0.0);
    for(int i=0;i<4;i++) {
      float4 p=pulls[i];
      if(abs(p.z)+abs(p.w)>0.001)pullDelta+=p.zw*influence(src,p.xy,pullRadius);
    }
    pullDelta*=min(1.0,pullLimit/max(0.001,length(pullDelta)));
    return image.eval(src-pullDelta);
  }
`;

/** Reference geometry used to test the inverse shader at different scales. */
export function toyActionSamplePoint(x: number, y: number, action: 'squeeze' | 'punch', impact: number,
  bodyCenter: { x: number; y: number }) {
  const amount = Math.max(0, Math.min(1, impact));
  if (action === 'squeeze') return {
    x: bodyCenter.x + (x - bodyCenter.x) / (1 - (1 - TOY_SQUEEZE_WIDTH) * amount),
    y: bodyCenter.y + (y - bodyCenter.y) / (1 + (TOY_SQUEEZE_STRETCH - 1) * amount),
  };
  return { x:bodyCenter.x+(x-bodyCenter.x)/(1+.15*amount),
    y:bodyCenter.y+(y-bodyCenter.y)/(1-.3*amount) };
}

export function toyPullLimit(headWidth: number) { 'worklet'; return headWidth * .18; }

export function clampToyPull(dx: number, dy: number, headWidth: number) {
  'worklet';
  const limit = toyPullLimit(headWidth);
  const length = Math.hypot(dx, dy);
  const factor = length > limit ? limit / length : 1;
  return { x: dx * factor, y: dy * factor };
}

/** Matches the shader's smoothstep falloff: exactly zero outside the circle. */
export function toyInfluence(distance: number, radius: number) {
  'worklet';
  if (distance >= radius) return 0;
  if (distance <= 0) return 1;
  const t = distance / radius;
  const w=1-t*t*(3-2*t);
  return w*w;
}
