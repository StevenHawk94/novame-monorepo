// Display-only distance. Server timestamps and settlement remain authoritative;
// no generated logs or predicted reward types are needed for the waiting page.
export function adventureTrail(startedAt:string,endsAt:string,serverNow:number) {
  const start=Date.parse(startedAt),end=Date.parse(endsAt);
  const progress=Number.isFinite(start)&&Number.isFinite(end)&&end>start&&Number.isFinite(serverNow)
    ?Math.min(1,Math.max(0,(serverNow-start)/(end-start))):0;
  return { progress, meters:Math.floor(progress*1000) };
}
