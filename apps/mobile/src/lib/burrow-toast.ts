type Notice={id:number;message:string;scope:string}|null;
let notice:Notice=null,serial=0,timer:ReturnType<typeof setTimeout>|undefined;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(fn=>fn());
/** One replaceable, non-blocking message. Repeated taps restart its lifetime. */
export function showBurrowToast(message:string,scope=''){
  clearTimeout(timer);notice={id:++serial,message,scope};emit();
  timer=setTimeout(()=>{notice=null;timer=undefined;emit();},2000);
}
export function clearBurrowToast(){clearTimeout(timer);timer=undefined;notice=null;emit();}
export const burrowToast={read:()=>notice,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};}};
