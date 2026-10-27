/** Public, payload-free adapter for the ONE owner of the authenticated Burrow
 * transport. Feature consumers never subscribe/close that shared channel. */
const listeners=new Set<{user:string;run:()=>void}>();
export function subscribePlushieTouchSignal(user:string,run:()=>void){const item={user,run};listeners.add(item);return()=>{listeners.delete(item);};}
export function notifyPlushieTouchSignal(user:string){for(const item of listeners)if(item.user===user)try{item.run();}catch{}}
