/** Server-time projection only. Changing the device wall clock cannot reset tasks. */
export function burrowLocalDay(serverTime: number, timezone: string | null | undefined): string {
  const formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'});
  const parts=formatter.formatToParts(new Date(serverTime));
  const value=(type:string)=>parts.find(part=>part.type===type)?.value??'';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
