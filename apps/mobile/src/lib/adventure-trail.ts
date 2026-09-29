// Narrative waypoints only: they do not predict or award inventory/friends.
// Distances and copy can be replaced independently of settlement rules.
const WAYPOINTS = [
  { at: 0, copy: 'Your bunny packed today’s little story.' },
  { at: .15, copy: 'Soft earth gave way to a winding passage.' },
  { at: .35, copy: 'Your bunny paused beside some patterned stones.' },
  { at: .6, copy: 'A warm breeze came from farther down the tunnel.' },
  { at: .85, copy: 'Your bunny followed a tiny glimmer toward home.' },
  { at: 1, copy: 'The journey is complete. Your discovery awaits confirmation.' },
];
export function adventureTrail(startedAt:string,endsAt:string,serverNow:number) {
  const start=Date.parse(startedAt),end=Date.parse(endsAt);
  const progress=Number.isFinite(start)&&Number.isFinite(end)&&end>start&&Number.isFinite(serverNow)
    ?Math.min(1,Math.max(0,(serverNow-start)/(end-start))):0;
  return { progress, meters:Math.floor(progress*1000),
    nextMeters:Math.round((WAYPOINTS.find(point=>point.at>progress)?.at??1)*1000),
    logs:WAYPOINTS.filter(point=>point.at<=progress).map(point=>({meters:Math.round(point.at*1000),copy:point.copy})),
  };
}
