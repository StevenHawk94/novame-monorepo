type Session={userId:string;token:string};
type Connection={close:()=>void|Promise<void>};
type Dependencies={
  session:()=>Promise<Session|null>;
  connect:(session:Session,onChange:(pair:boolean)=>void,onStatus:(healthy:boolean)=>void)=>Promise<Connection>;
  refresh:()=>Promise<boolean>;
  invalidatePair:()=>void;
};
/** Coalesced invalidations plus bounded failure backoff. No healthy polling. */
export function createBurrowSync(deps:Dependencies) {
  let active=false,generation=0,connectionGeneration=0,connection:Connection|null=null;
  const close=(value:Connection|null)=>{try{void Promise.resolve(value?.close()).catch(()=>{});}catch{}};
  let timer:ReturnType<typeof setTimeout>|undefined,reconnect:ReturnType<typeof setTimeout>|undefined;
  let running=false,dirty=false,retry=0,connectRetry=0;
  function request(delay=400) {
    if(!active)return;
    dirty=true;
    if(delay===0&&timer){clearTimeout(timer);timer=undefined;}
    if(running||timer)return;
    timer=setTimeout(()=>{timer=undefined;void refresh();},delay);
  }
  async function refresh() {
    if(!active||running)return;
    const mine=generation;running=true;dirty=false;
    let ok=false;try{ok=await deps.refresh();}catch{}
    running=false;
    if(!active||mine!==generation){if(active&&dirty)request(0);return;}
    if(ok){retry=0;if(dirty)request();}
    else {dirty=true;request(Math.min(60_000,2_000*2**Math.min(retry++,5)));}
  }
  async function connect() {
    if(!active)return;
    const mine=generation,connectionId=++connectionGeneration;
    const current=()=>active&&mine===generation&&connectionId===connectionGeneration;
    const scheduleReconnect=()=>{
      if(!current()||reconnect)return;
      reconnect=setTimeout(()=>{reconnect=undefined;connectionGeneration++;close(connection);connection=null;void connect();},Math.min(60_000,2_000*2**Math.min(connectRetry++,5)));
    };
    try {
      const session=await deps.session();if(!current())return;
      if(!session){scheduleReconnect();return;}
      const next=await deps.connect(session,pair=>{
        if(!current())return;
        if(pair)deps.invalidatePair();
        request(pair?0:400);
      },healthy=>{
        if(!current())return;
        if(healthy){connectRetry=0;clearTimeout(reconnect);reconnect=undefined;request(0);}
        else scheduleReconnect();
      });
      if(!current()){close(next);return;}
      connection=next;
    } catch {scheduleReconnect();}
  }
  function stop() {
    active=false;generation++;connectionGeneration++;dirty=false;clearTimeout(timer);clearTimeout(reconnect);timer=reconnect=undefined;
    close(connection);connection=null;
  }
  return {request,stop,start(){stop();active=true;retry=connectRetry=0;request(0);void connect();}};
}
