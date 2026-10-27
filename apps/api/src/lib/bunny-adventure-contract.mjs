export const bunnyCapable=request=>request.headers?.get?.('x-burrow-bunny')==='1'
export const teamCapable=request=>request.headers?.get?.('x-burrow-adventure')==='5'
export async function readCharacterState(db,user,snapshot,request){
 if(!bunnyCapable(request)&&!teamCapable(request))return null
 const {data,error}=await db.rpc('burrow_character_snapshot_v1',{p_user:user})
 if(error||data?.identity?.userId!==user)return null
 if((data.identity.partnerId??null)!==(snapshot.partner?.id??null)
  ||(data.identity.pairVersion??null)!==(snapshot.pairVersion??null))return null
 return {...(bunnyCapable(request)?{bunnyIdentity:data.identity}:{}),...(teamCapable(request)?{adventureTeam:data.adventure}:{} )}
}
