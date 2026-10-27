/** Wait for the retained Home's React/native mutation commit, not a fixed
 * pair of frames. The two-frame fallback only covers absent/interrupted hosts. */
const waiters = new Map<string, Set<() => void>>();
let committed = '', hosts = 0;
export const homeDesignKey = (owner:string,partner:string|undefined,pair:string|undefined,slots:Record<string,string>) =>
  JSON.stringify([owner,partner??'',pair??'',Object.entries(slots).sort(([a],[b])=>a.localeCompare(b))]);
export function retainHomeDesignHost() { hosts++; return () => { hosts=Math.max(0,hosts-1);if(!hosts)committed=''; }; }
export function markHomeDesignCommitted(key:string) {
  committed=key;waiters.get(key)?.forEach(done=>done());
}
export function waitForHomeDesignCommit(key:string) {
  if(!hosts||key===committed)return Promise.resolve();
  return new Promise<void>(resolve=>{
    let frame:number|undefined,timeout:ReturnType<typeof setTimeout>|undefined,done=false;
    const finish=()=>{
      if(done)return;done=true;
      if(frame!==undefined)cancelAnimationFrame(frame);if(timeout)clearTimeout(timeout);
      const group=waiters.get(key);group?.delete(finish);if(!group?.size)waiters.delete(key);resolve();
    };
    const group=waiters.get(key)??new Set<()=>void>();group.add(finish);waiters.set(key,group);
    frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(finish);});
    timeout=setTimeout(finish,500); // Background/suspension cannot strand a checkout.
  });
}
