// Sample the original cubic trajectories before interaction. A single native
// animation clock drives these transform/opacity nodes without per-frame Fabric
// commits or worklet setup on the completion frame. 15ms interpolation segments
// preserve the original 36 pieces, colours, sizes and 700–900ms lifetimes.
export const CARE_CONFETTI_DURATION=900;
export const CARE_COMPLETION_INPUT=Array.from({length:121},(_,n)=>n*7.5);
// Exact damped spring used by the original UI-thread card: m=.6, k=300,
// c=8.5, initial scale=.84 and zero velocity. Native interpolation avoids
// lazily compiling a spring/worklet while the reward first appears.
export const CARE_COMPLETION_SCALE=CARE_COMPLETION_INPUT.map(ms=>{
  const t=ms/1000,decay=8.5/(2*.6),frequency=Math.sqrt(300/.6-decay*decay);
  return ms===900?1:1-.16*Math.exp(-decay*t)*(Math.cos(frequency*t)+decay/frequency*Math.sin(frequency*t));
});
export const CARE_CONFETTI=Array.from({length:36},(_,index)=>{
  const angle=index*2.39996,distance=92+index%7*15,duration=700+index%5*50;
  const inputRange=Array.from({length:61},(_,n)=>n*15);
  const progress=inputRange.map(ms=>1-(1-Math.min(1,ms/duration))**3);
  return {width:index%4?8:11,height:index%4?15:10,inputRange,
    opacity:progress.map(t=>t<.7?1:Math.max(0,(1-t)/.3)),
    x:progress.map(t=>Math.cos(angle)*distance*t),
    y:progress.map(t=>Math.sin(angle)*distance*t+44*t*t),
    rotation:progress.map(t=>`${index*31*t}deg`),scale:progress.map(t=>.5+t*.7)};
});
