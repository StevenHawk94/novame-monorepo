// Offline QA boundaries only. Real journal cache/outbox, drafts, layout and UI.
import React from 'react';
import {View,Text} from 'react-native';
export const nav={current:null};
export const router={canGoBack:()=>nav.current?.canGoBack(),back:()=>nav.current?.goBack(),replace:()=>nav.current?.navigate('Home')};
const disk=new Map();export const storage={getString:k=>disk.get(k),getAllKeys:()=>[...disk.keys()],set:(k,v)=>disk.set(k,v),remove:k=>disk.delete(k),delete:k=>disk.delete(k)},mmkv=storage;
export const sessionUserId=()=> '11111111-1111-4111-8111-111111111111',sessionEpoch=()=>1,subscribeSessionIdentity=()=>()=>{};
export const data={profile:{id:sessionUserId(),display_name:'Mio',timezone_name:'UTC'},partner:{id:'22222222-2222-4222-8222-222222222222',display_name:'Jio'},pairVersion:'layout-qa',pairAccessVerified:true,moments:[],localDate:'2026-10-25',serverNow:new Date().toISOString()};
export const useBurrowSelector=select=>select({data});export function usePartnerEntryGate(){}
export function UserAvatar({name,size=32}){return <View style={{width:size,height:size,borderRadius:size/2,backgroundColor:'#B58D70',alignItems:'center',justifyContent:'center'}}><Text style={{color:'white'}}>{name?.[0]}</Text></View>;}
const answer=(authorId,body)=>({id:authorId,authorId,body,createdAt:'2026-10-25T00:00:00Z',updatedAt:'2026-10-25T00:00:00Z'});
export const fixture={protocol:2,today:{id:'33333333-3333-4333-8333-333333333333',date:'2026-10-25',pageNumber:1,protocol:2,timezone:'UTC',questionId:'cj_01',question:'What small thing made you feel close to me this week?',answers:[]},history:Array.from({length:12},(_,i)=>({id:`44444444-4444-4444-8444-${String(i).padStart(12,'0')}`,date:'2026-10-24',pageNumber:i+1,question:'What is one way our home or favorite spot reflects us?',questionId:'cj_01',answers:[answer(data.partner.id,'A quiet walk together. '.repeat(50)),answer(data.profile.id,'Spending the day together.')]})),hasMore:false,nextBefore:null,todayDate:'2026-10-25',timezone:'UTC',pairVersion:'layout-qa'};
export const apiClient={get:async()=>({success:true,...fixture}),patch:async()=>({success:true}),post:async(_url,body)=>{await new Promise(r=>setTimeout(r,5000));fixture.today={...fixture.today,answers:[...fixture.today.answers.filter(a=>a.authorId!==data.profile.id),answer(data.profile.id,body.body)]};return {success:true,page:fixture.today};}};
