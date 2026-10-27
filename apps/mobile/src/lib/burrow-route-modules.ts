/** Evaluate first-use route modules in separate idle slices. This does NOT
 * mount screens, request permissions, start media, acknowledge messages or
 * run screen effects. Retained tabs already prepare the actual main views. */
const routes=[
  ()=>require('../../app/(main)/room-interaction'),
  ()=>require('../../app/(main)/game-room'),
  ()=>require('../../app/(main)/surprise-room'),
  ()=>require('../components/burrow/couple-journal-screen'),
  ()=>require('../../app/(main)/music-player'),
  ()=>require('../../app/(main)/menu'),
  ()=>require('../../app/(main)/gift-library'),
];
const warmed=new Set<number>();
export function burrowRouteModuleJobs(current:()=>boolean){
  return routes.map((load,index)=>({delayMs:120+index*180,run:()=>{
    if(!current()||warmed.has(index))return;
    load();warmed.add(index);
  }}));
}
