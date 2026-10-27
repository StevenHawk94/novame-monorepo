/** Legacy IDs remain recognizable in stored profiles, but never load bundled portraits. */
export const DEFAULT_AVATAR_IDS = ['default-1','default-2','default-3','default-4','default-5','default-6','default-7','default-8','default-9','default-10'] as const;
export type DefaultAvatarId = typeof DEFAULT_AVATAR_IDS[number];
export function isDefaultAvatarId(value:unknown):value is DefaultAvatarId{return typeof value==='string'&&(DEFAULT_AVATAR_IDS as readonly string[]).includes(value);}
const palette=['#A35C43','#557B70','#726193','#A16C32','#4D738D','#955C76','#687546','#865D47'] as const;
const hash=(value:string)=>{let n=0;for(const c of value)n=(n*31+c.codePointAt(0)!)>>>0;return n;};
export function getDefaultAvatarId(userId:string|null|undefined):DefaultAvatarId{return DEFAULT_AVATAR_IDS[hash(userId??'')%10];}
type Person={id:string;display_name?:string|null};
let pair: {self:Person;partner:Person|null}|null=null;
let initiatorId:string|null=null,avatarRevision=0;
const avatarListeners=new Set<()=>void>();
const notify=()=>{avatarRevision++;avatarListeners.forEach(fn=>fn());};
export const subscribeAvatarIdentity=(fn:()=>void)=>{avatarListeners.add(fn);return()=>{avatarListeners.delete(fn);};};
export const avatarIdentityRevision=()=>avatarRevision;
/** Identity-only context, cleared on sign-out/pair invalidation; never stores photos. */
export function configureAvatarPair(self:Person|null,partner:Person|null=null){
 const next=self?{self:{id:self.id,display_name:self.display_name},partner:partner?{id:partner.id,display_name:partner.display_name}:null}:null;
 if(pair?.self.id!==next?.self.id||pair?.partner?.id!==next?.partner?.id)initiatorId=null;
 if(JSON.stringify(next)===JSON.stringify(pair))return;
 pair=next;notify();
}
/** Shared presentation metadata, scoped to the current authenticated pair.
 * The Menu and every retained avatar observe the same change together. */
export function configureAvatarPairRole(ownerId:string,partnerId:string|undefined,initiator:string|null|undefined){
 if(pair?.self.id!==ownerId||pair.partner?.id!==partnerId)return;
 const next=partnerId&&(initiator===ownerId||initiator===partnerId)?initiator:null;
 if(next===initiatorId)return;initiatorId=next;notify();
}
export function initialAvatar(userId:string|null|undefined,name?:string|null,otherUserId?:string|null){
 const person=pair&&userId===pair.self.id?pair.self:pair&&userId===pair.partner?.id?pair.partner:null;
 const other=otherUserId??(person?(userId===pair?.self.id?pair?.partner?.id:pair?.self.id):undefined);
 const text=(name?.trim()||person?.display_name?.trim()||'?').normalize('NFC');
 const initial=Array.from(text)[0]?.toLocaleUpperCase()||'?';
 if(person&&pair?.partner&&initiatorId){
  const initiator=userId===initiatorId;
  return {initial,backgroundColor:initiator?'#FFC547':'#83513E',color:initiator?'#61320C':'#FFF9F0'};
 }
 let index=hash(userId||text)%palette.length;
 if(userId&&other&&other!==userId&&hash(other)%palette.length===index&&userId>other)index=(index+1)%palette.length;
 return {initial,backgroundColor:palette[index],color:'#FFF9F0'};
}
export function uploadedAvatarUri(avatarUrl:string|null|undefined,isDefaultAvatar?:boolean|null){
 return avatarUrl&&!isDefaultAvatarId(avatarUrl)&&isDefaultAvatar!==true&&/^(https?:|file:|data:|content:)/.test(avatarUrl)?avatarUrl:null;
}
