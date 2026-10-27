import type {MajorUpdateBootstrap} from './app-major-update-api';

export type LoveNote=MajorUpdateBootstrap['memoryEntries'][number];
export type LoveNoteTab='received'|'sent';
export const LOVE_NOTE_PREFIX='💌 ';
export function loveNoteLimitMessage(error:unknown):string|null{
  const body=error&&typeof error==='object'&&'body' in error?error.body:null;
  const code=body&&typeof body==='object'&&'error' in body?body.error:
    error&&typeof error==='object'&&'message' in error?error.message:null;
  if(code==='love_note_minute_limit')return 'You can send up to 5 Love Notes per minute. Please wait a moment and try again. Your note is still here.';
  if(code==='love_note_daily_limit')return 'You’ve reached today’s limit of 100 Love Notes. Try again after your local midnight. Your note is still here.';
  return null;
}
export const loveNoteKey=(note:LoveNote)=>`${note.id}:${note.updated_at}`;
export const loveNoteBody=(note:LoveNote)=>note.body.slice(LOVE_NOTE_PREFIX.length);
/** History stays newest-first; the unread inbox is a chronological queue.
 * Do not choose a recent body while older unread bodies are still paginating. */
export function oldestUnreadLoveNote(rows:LoveNote[],unread:readonly string[],complete=false){
  const keys=new Set(unread),available=rows.filter(row=>keys.has(loveNoteKey(row)));
  if(!complete&&new Set(available.map(loveNoteKey)).size<keys.size)return undefined;
  return available.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))[0];
}
export function mergeLoveNotes(data:MajorUpdateBootstrap,...batches:readonly LoveNote[][]):LoveNote[]{
  const rows=new Map<string,LoveNote>();
  for(const batch of batches)for(const row of batch){
    if(!row.body.startsWith(LOVE_NOTE_PREFIX)||(row.author_id!==data.profile.id&&row.author_id!==data.partner?.id))continue;
    const previous=rows.get(row.id);
    if(!previous||row.updated_at>=previous.updated_at)rows.set(row.id,row);
  }
  return [...rows.values()].sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
}
export function notesForTab(data:MajorUpdateBootstrap,rows:LoveNote[],tab:LoveNoteTab){
  return rows.filter(row=>row.author_id===(tab==='sent'?data.profile.id:data.partner?.id));
}
function format(at:string,timezone:string|null|undefined,options:Intl.DateTimeFormatOptions){
  const date=new Date(at);if(!Number.isFinite(date.getTime()))return '';
  try{return new Intl.DateTimeFormat('en-US',{...options,...(timezone?{timeZone:timezone}:{})}).format(date);}
  catch{return new Intl.DateTimeFormat('en-US',options).format(date);}
}
export function loveNoteDate(at:string,timezone?:string|null,year=false){
  return `${format(at,timezone,{month:'short',day:'numeric',...(year?{year:'numeric' as const}:{})})} · ${format(at,timezone,{hour:'numeric',minute:'2-digit',hour12:true})}`;
}
export function loveNoteSections(rows:LoveNote[],timezone?:string|null){
  const groups=new Map<string,{title:string;data:LoveNote[]}>();
  for(const row of rows){
    const title=format(row.created_at,timezone,{month:'long',year:'numeric'});
    const group=groups.get(title)??{title,data:[]};group.data.push(row);groups.set(title,group);
  }
  return [...groups.values()];
}
