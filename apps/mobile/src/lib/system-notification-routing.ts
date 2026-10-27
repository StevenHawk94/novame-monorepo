type Data={type?:unknown;surpriseId?:unknown;messageId?:unknown};
export function systemNotificationDestination(data:Data|null|undefined){
 if(data?.type==='plushie_touch'&&typeof data.messageId==='string'&&/^[0-9a-f-]{36}$/i.test(data.messageId))return{pathname:'/(main)/plushie-touch',params:{mode:'inbox',messageId:data.messageId}};
 if(data?.type==='affection_received')return{pathname:'/(main)/burrow-detail',params:{section:'affection'}};
 if(data?.type==='surprise_received'&&typeof data.surpriseId==='string'&&/^[0-9a-f-]{36}$/i.test(data.surpriseId))return{pathname:'/(main)/surprise-room',params:{receive:'1'}};
 if(data?.type==='adventure_reminder'||data?.type==='adventure_invite')return{pathname:'/(main)/burrow-detail',params:{section:'adventure'}};
 return null;
}
