/** One read per key/revision. An invalidation during I/O requires a trailing
 * read, never delivery of the old snapshot to a newer caller. No writes here. */
export function createGameReadCoordinator(now:()=>number=Date.now) {
  let revision=0;
  const flights=new Map<string,{revision:number;promise:Promise<unknown>}>();
  const recent=new Map<string,{revision:number;at:number;value:unknown}>();
  const read=<T,>(key:string,work:()=>Promise<T>):Promise<T>=>{
    const cached=recent.get(key);
    if(cached?.revision===revision&&now()-cached.at<1000)return Promise.resolve(cached.value as T);
    const before=flights.get(key);
    if(before?.revision===revision)return before.promise as Promise<T>;
    const row={revision,promise:Promise.resolve() as Promise<unknown>};
    row.promise=Promise.resolve().then(work).then(value=>{
      if(row.revision!==revision)return read(key,work);
      recent.delete(key);recent.set(key,{revision,at:now(),value});
      while(recent.size>200)recent.delete(recent.keys().next().value!);
      return value;
    })
      .finally(()=>{if(flights.get(key)===row)flights.delete(key);});
    flights.set(key,row);return row.promise as Promise<T>;
  };
  return {read,invalidate(){revision++;recent.clear();},revision:()=>revision};
}
export const gameReads=createGameReadCoordinator();
