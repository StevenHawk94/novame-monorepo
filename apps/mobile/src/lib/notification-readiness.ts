/** Display readiness is separate from unread/claimed state. No message bodies,
 * user preferences, or read receipts are persisted by this registry. */
export type NotificationDestination = 'games' | 'journal' | 'letters' | 'moments' | 'visits' | 'adventure' | 'gifts';
export function createNotificationReadiness(now:()=>number=Date.now) {
  type Row={version:string;ready:boolean;flight?:Promise<void>;retryAt:number;failures:number};
  let scope='',generation=0,revision=0;
  const rows=new Map<NotificationDestination,Row>(),listeners=new Set<()=>void>();
  const emit=()=>{revision++;listeners.forEach(fn=>fn());};
  const reset=(next='')=>{if(next===scope&&rows.size===0)return;scope=next;generation++;rows.clear();emit();};
  return {
    reset,
    revision:()=>revision,
    subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
    ready(expected:string,kind:NotificationDestination,version:string){const row=rows.get(kind);return expected===scope&&row?.version===version&&row.ready;},
    prepare(expected:string,kind:NotificationDestination,version:string,work:()=>Promise<void>,current:()=>boolean):Promise<void>{
      if(!current())return Promise.resolve();
      if(scope!==expected)reset(expected);
      const before=rows.get(kind);
      if(before?.version===version){if(before.ready)return Promise.resolve();if(before.flight)return before.flight;if(now()<before.retryAt)return Promise.resolve();}
      const own=generation,row:Row={version,ready:false,retryAt:0,failures:before?.version===version?before.failures:0};
      rows.set(kind,row);emit();
      const task=Promise.resolve().then(work).then(()=>{
        if(own===generation&&scope===expected&&rows.get(kind)===row&&current()){row.ready=true;row.failures=0;emit();}
      }).catch(error=>{
        if(own===generation&&rows.get(kind)===row){
          const advancing=error?.message==='notification_batch_pending';
          row.retryAt=now()+(advancing?1000:Math.min(30_000,1000*2**Math.min(row.failures++,5)));if(advancing)row.failures=0;emit();
        }
      }).finally(()=>{if(row.flight===task)row.flight=undefined;});
      row.flight=task;return task;
    },
  };
}
export const notificationReadiness=createNotificationReadiness();
