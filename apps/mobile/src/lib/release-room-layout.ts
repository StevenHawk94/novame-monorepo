const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
export const RELEASE_MONSTER_BODY_FRACTION=.75;
export const RELEASE_DIALOGUE_TAIL_HEIGHT=10;
export const RELEASE_DIALOGUE_GAP=16;
/** All values are layout points, computed once per viewport/font change. */
export function releaseRoomLayout(width:number,height:number,top:number,bottom:number,fontScale=1){
 const usable=Math.max(360,height-top-bottom),padding=width<350?12:18;
 const font=clamp(fontScale,1,1.3);
 const instructionHeight=clamp(usable*.35,156,300);
 const arenaHeight=usable-instructionHeight;
 const battleSize=Math.max(80,Math.min(width*.78,arenaHeight-116,340)*.8);
 // Two full text lines plus vertical padding must fit even on 320pt phones.
 const buttonHeight=Math.ceil(clamp(usable*.075,60,68)*font);
 const optionGap=usable<620?8:12;
 const panelHeight=48+4*buttonHeight+3*optionGap+24;
 const finalArenaHeight=Math.max(100,usable-panelHeight);
 const bubbleHeight=font>1.1?92:80;
 const finalSize=Math.max(20,Math.min(battleSize*.55,finalArenaHeight-bubbleHeight-24));
 // Centre the dialogue + visible body as one group. Extra viewport height
 // belongs outside the group, never in the gap between speech and character.
 const finalBodyHeight=finalSize*RELEASE_MONSTER_BODY_FRACTION;
 const finalBubbleTop=Math.max(0,(finalArenaHeight-bubbleHeight-RELEASE_DIALOGUE_TAIL_HEIGHT-RELEASE_DIALOGUE_GAP-finalBodyHeight)/2);
 const finalBodyTop=finalBubbleTop+bubbleHeight+RELEASE_DIALOGUE_TAIL_HEIGHT+RELEASE_DIALOGUE_GAP;
 // The normalized monster silhouette is centred here after its .55 battle
 // scale. Keep the heart canvas independent of the speech/arena centre.
 const heartSize=Math.min(width,finalArenaHeight);
 const heartFrame={position:'absolute' as const,left:(width-heartSize)/2,
  top:finalBodyTop+finalBodyHeight/2-heartSize/2,width:heartSize,height:heartSize};
 const monsterTop=54+Math.max(0,(arenaHeight-54-70-battleSize)/3);
 return {usable,padding,instructionHeight,arenaHeight,battleSize,
  monsterTop,hpTop:Math.min(arenaHeight-40,monsterTop+battleSize+18),
  instructionIcon:clamp(instructionHeight*.29,58,112),instructionFont:clamp(instructionHeight*.074,15,22),
  buttonHeight,optionGap,panelHeight,finalArenaHeight,bubbleHeight,finalSize,
  finalBubbleTop,finalBodyTop,finalBodyHeight,heartFrame,
  finalMonsterTop:finalBodyTop-(finalSize-finalBodyHeight)/2,
  optionFont:width<350?13:14,
  gridHeight:clamp((usable-130-42)/4,98,(width-2*padding-14)/2*.85),
  prepArt:clamp(usable*.19,90,175),statsHeight:Math.ceil(clamp(usable*.27,166,210)*font),prepTop:54,prepGap:usable<650?8:14,
 };
}
export function releaseLastTamed(iso:string|null,timeZone:string,now=Date.now()):string{
 if(!iso)return 'No history';
 try{
  const date=new Date(iso),day=(value:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
  const label=day(date)===day(new Date(now))?'Today':new Intl.DateTimeFormat('en-US',{timeZone,month:'short',day:'numeric'}).format(date);
  return `${label}, ${new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric',minute:'2-digit'}).format(date)}`;
 }catch{return 'No history';}
}
