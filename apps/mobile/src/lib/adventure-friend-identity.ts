import identities from './adventure-friend-identities.json';

type FriendIdentity={stable_id?:string;name?:string;gender?:unknown;metadata?:{gender?:unknown}};
const validGender=(value:unknown):'he'|'she'|undefined=>value==='he'||value==='she'?value:undefined;
/** Preserve a valid frozen identity. Older snapshots can omit gender; the
 * bundled projection contains only identity fields from the canonical cast,
 * verified against all 15 server definitions by the presentation tests. */
export function adventureFriendGender(snapshot?:FriendIdentity|null,profile?:FriendIdentity,friendId?:string,friendName?:string) {
  const gender=validGender(snapshot?.gender)??validGender(snapshot?.metadata?.gender)
    ??validGender(profile?.gender)??validGender(profile?.metadata?.gender);
  if(gender)return gender;
  const id=friendId??snapshot?.stable_id??profile?.stable_id,name=friendName??snapshot?.name??profile?.name;
  const definition=identities.find(row=>row.id===id)??identities.find(row=>row.name===name);
  return validGender(definition?.gender);
}
