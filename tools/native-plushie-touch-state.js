// No production business API or real user photos in the native probe.
import {Image} from 'react-native';
const face=require('../apps/mobile/assets/burrow-webp/adventure-page/process-icon-biscuit.webp');
export const cachedRoomPhotoUri=()=>Image.resolveAssetSource(face).uri;
export const loadRoomPhoto=async()=>cachedRoomPhotoUri();
export const invalidateRoomPhotoCache=()=>{};
export const sessionUserId=()=> '11111111-1111-4111-8111-111111111111',sessionEpoch=()=>1,subscribeSessionIdentity=()=>()=>{};
const B='22222222-2222-4222-8222-222222222222',pair='a'.repeat(32);
const toy={stable_id:'qa-toy',name:'Love Bunny',metadata:{starter:true,slot:'couple_doll',artOrdinal:1},category:'couple_dolls',item_type:'decor',status:'active'};
const ownPhoto={id:'33333333-3333-4333-8333-333333333333',ownerId:sessionUserId(),kind:'doll',toyId:'qa-toy',updatedAt:'2026-10-25T00:00:00Z'};
export const data={profile:{id:sessionUserId(),display_name:'Mio'},partner:{id:B,display_name:'Sam'},pairVersion:pair,catalog:[toy],loadouts:[],roomPhotos:[ownPhoto,{...ownPhoto,id:'55555555-5555-4555-8555-555555555555',ownerId:B}],localDate:'2026-10-25'};
export const getBurrowSnapshot=()=>({data});export const useBurrow=()=>({data,loading:false,busy:false});
export const useBurrowSelector=fn=>fn({data});
let mode='record',exit=()=>{};export const setQAMode=v=>{mode=v;},setQAExit=fn=>{exit=fn;};
let navigate=()=>{};export const setQANavigate=fn=>{navigate=fn;};
export const useLocalSearchParams=()=>({mode,pairVersion:pair,kind:'toy',...(mode==='partner'?{ownerId:B,actorId:sessionUserId()}:{} )});
export const router={canGoBack:()=>true,back:()=>exit(),replace:target=>{if(target?.pathname==='/(main)/room-interaction'){mode='partner';navigate('default',true);}else exit();},push:target=>{if(target?.pathname==='/(main)/plushie-touch'){mode=target.params.mode;navigate('touch');}else exit();}};
export const runBurrowAction=async()=>false;
let messages=[],remaining=1,plusQA=false;
export const resetTouchQA=()=>{messages=[];remaining=1;plusQA=false;};
export const seedTouchQA=()=>{plusQA=false;messages=[{id:'44444444-4444-4444-8444-444444444444',sender_id:B,recipient_id:sessionUserId(),pair_version:pair,toy_id:'qa-toy',created_at:new Date().toISOString(),expires_at:null,read_at:null,clip:{version:2,durationMs:60000,touches:120,events:[[0,0,0,500,500],[30000,1,0,800,400],[60000,3,0,800,400]]},toy,photo:{...ownPhoto,ownerId:B}}];};
export const seedPlusQA=()=>{seedTouchQA();plusQA=true;const m=messages[0];messages=Array.from({length:10},(_,i)=>({...m,id:'44444444-4444-4444-8444-'+String(i).padStart(12,'0'),sender_id:i%2?sessionUserId():B,recipient_id:i%2?B:sessionUserId(),created_at:new Date(Date.now()-i*86400000).toISOString()}));};
export const apiClient={get:async url=>{
 if(!url.startsWith('/api/vnext/plushie-touch'))throw Error('Production business API prohibited');
 const id=url.split('&id=')[1],base={version:2,userId:sessionUserId(),partnerId:B,pairVersion:pair};
 return id?{...base,message:messages.find(m=>m.id===id)}:{...base,localDate:'2026-10-25',serverNow:new Date().toISOString(),hasPlus:plusQA,remaining,sameDomain:true,items:messages.map(({clip,toy,photo,...m})=>({...m,touches:clip.touches,toy}))};
},post:async(url,b)=>{
 if(url!=='/api/vnext/plushie-touch')throw Error('Production business API prohibited');
 if(b.action==='seen'){messages=messages.map(m=>m.id===b.messageId?{...m,read_at:new Date().toISOString()}:m);return{success:true};}
 await new Promise(r=>setTimeout(r,1500));remaining=0;
 messages=[{id:'44444444-4444-4444-8444-444444444444',sender_id:B,recipient_id:sessionUserId(),pair_version:pair,toy_id:'qa-toy',created_at:new Date().toISOString(),expires_at:null,read_at:null,
  clip:b.clip,toy,photo:{...ownPhoto,ownerId:B}}];return{success:true,version:1};
}};
