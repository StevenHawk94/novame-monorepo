export const careV2Capable = request => request.headers?.get?.('x-burrow-care') === '2';
/** Missing capability stays missing. Never infer four independent cooldowns
 * from the legacy two-meter DTO or a failed supplementary read. */
export async function readRoomCare(db, userId, snapshot, signal) {
  const query=db.rpc('room_care_state_v2',{p_user_id:userId});
  const {data,error}=await (typeof query.abortSignal==='function'?query.abortSignal(signal):query);
  if(error||data?.version!==2||data.actorId!==userId||data.partnerId!==(snapshot.partner?.id??null)
    ||data.pairVersion!==(snapshot.pairVersion??null)||!data.own||(snapshot.partner?!data.partner:data.partner!==null))return null;
  for(const room of [data.own,...(data.partner?[data.partner]:[])])for(const kind of ['carrot','water','leaf','fertilizer']){
    const row=room[kind];
    if(!row||![row.lastAt,row.nextAt].every(v=>v===null||typeof v==='string'&&Number.isFinite(Date.parse(v))))return null;
  }
  return data;
}
