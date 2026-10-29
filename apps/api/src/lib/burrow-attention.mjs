const events=['room_need_refilled','memory_created','affection_sent','game_played','adventure_record_saved','toy_interacted','rage_room_completed','gift_sent','surprise_sent'];
const item=(id,at)=>({id,at});
/** Supplementary metadata only. Never expose answers, message bodies, or former-pair state. */
export async function readBurrowAttention(db,userId,snapshot,readSignal,journalV2Capable=false) {
  const partnerId=snapshot.partner?.id,version=snapshot.pairVersion;
  const empty={scope:`${userId}:${partnerId??''}:${version??''}`,localDate:snapshot.localDate,moments:[],letters:[],games:[],journal:[]};
  if(!partnerId||!version)return empty;
  const signal=readSignal??AbortSignal.timeout(3500);
  const read=async query=>{
    const result=await (typeof query.abortSignal==='function'?query.abortSignal(signal):query);
    if(result.error)throw result.error;return result.data;
  };
  const args={p_user_id:userId,p_partner_id:partnerId};
  const current=async()=>{
    const [partner,currentVersion]=await Promise.all([read(db.rpc('lock_burrow_pair',{p_user:userId})),read(db.rpc('burrow_pair_version_v1',args))]);
    return partner===partnerId&&currentVersion===version;
  };
  try {
    if(!await current())return null;
    const [low,high]=[userId,partnerId].sort();
    const pair=query=>query.eq('pair_low',low).eq('pair_high',high);
    const [moments,letters,games,pages,journalV2]=await Promise.all([
      read(pair(db.from('moment_events').select('id,created_at,event_type,payload')).eq('actor_id',partnerId).eq('visibility','pair')
        .in('event_type',events).order('created_at',{ascending:false}).limit(200)),
      read(pair(db.from('memory_room_entries').select('id,updated_at')).eq('author_id',partnerId).like('body','💌 %')
        .is('deleted_at',null).order('updated_at',{ascending:false}).limit(200)),
      read(pair(db.from('burrow_game_sessions').select('id,started_by,created_at,completed_at,burrow_game_progress(user_id,own_answers,guesses,updated_at)'))
        .eq('pair_version',version).order('created_at',{ascending:false}).limit(200)),
      read(pair(db.from('couple_journal_pages').select('id,couple_journal_answers(id,author_id,updated_at)'))
        .eq('pair_version',version).eq('local_date',snapshot.localDate).limit(1)),
      journalV2Capable?read(db.rpc('couple_journal_attention_v2',{p_user_id:userId})):Promise.resolve(null),
    ]);
    if(!await current())return null;
    return {...empty,
      moments:(moments??[]).filter(row=>row.event_type!=='room_need_refilled'||['food','water','leaf','fertilizer'].includes(row.payload?.need)).map(row=>item(`${row.id}:${row.created_at}`,row.created_at)),
      letters:(letters??[]).map(row=>item(`${row.id}:${row.updated_at}`,row.updated_at)),
      games:(games??[]).flatMap(row=>{
        const me=row.burrow_game_progress?.find(p=>p.user_id===userId),them=row.burrow_game_progress?.find(p=>p.user_id===partnerId);
        if(row.completed_at&&row.started_by===userId)return [item(`${row.id}:result`,row.completed_at)];
        if(!row.completed_at&&row.started_by===partnerId&&them?.own_answers?.length===6&&them?.guesses?.length===6
          &&(me?.own_answers?.length!==6||me?.guesses?.length!==6))return [item(`${row.id}:invite`,them.updated_at)];
        return [];
      }),
      journal:journalV2??(pages??[]).flatMap(row=>(row.couple_journal_answers??[]).filter(answer=>answer.author_id===partnerId)
        .map(answer=>item(`${answer.id}:${answer.updated_at}`,answer.updated_at))),
    };
  }catch{return null;}
}
