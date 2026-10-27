export const SYSTEM_NOTIFICATION_TYPES=['game_ready','game_invite','affection_received','surprise_received','adventure_reminder','adventure_invite','plushie_touch']
export function systemNotificationCopy(type,payload={},name){
 const partner=typeof name==='string'&&name.trim()?name.replace(/[\r\n\t]/g,' ').trim().slice(0,80):'Your partner'
 if(type==='game_ready')return{title:'Game Room',body:'Your results are ready to see!',data:{type,route:'game_room',sessionId:payload.sessionId}}
 if(type==='game_invite')return{title:'Game Room',body:`${partner} finished a game. It’s your turn to play!`,data:{type,route:'game_room',sessionId:payload.sessionId}}
 if(type==='affection_received')return{title:`${partner} sent you some love ❤️`,body:'Open to see it.',data:{type,route:'affection',eventId:payload.eventId}}
 if(type==='surprise_received')return{title:`${partner} left you a surprise 🎁`,body:'Tap to see what it is.',data:{type,route:'surprise',surpriseId:payload.surpriseId}}
 if(type==='adventure_reminder')return{title:'Adventure time?',body:'Log your day and take your bunny exploring.',data:{type,route:'adventure',localDate:payload.localDate}}
 if(type==='adventure_invite')return{title:'Adventure',body:`${partner} invited you to team up. Log your day to join the adventure.`,data:{type,route:'adventure',partyId:payload.partyId}}
 if(type==='plushie_touch')return{title:`A touch from ${partner} ❤️`,body:'Tap to feel their love.',data:{type,route:'plushie_touch',messageId:payload.messageId}}
 return null
}
