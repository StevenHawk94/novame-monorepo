import type {BunnyVariant} from './bunny-identity-model';
export type AdventureTeam={id:string;version:number;ruleVersion:5;leaderId:string;followerId:string|null;
 partnerId:string|null;pairVersion:string|null;plus:boolean;startedAt:string;progressAt:string;progressFraction:number;
 endsAt:string;nudged:boolean;leaderVariant:BunnyVariant;followerVariant:BunnyVariant};
export type AdventureTeamState={userId:string;partnerId:string|null;pairVersion:string|null;adventureId:string|null;
 team:AdventureTeam|null;joinable:AdventureTeam|null;nudgeAvailable:boolean;coordinationPending?:boolean;
 nudgeStatus?:{reason:'unpaired'|'relationship_unavailable'|'economy_restricted'|'couple'|'own_finishing'|'partner_finishing'|'partner_adventuring'|'partner_finished'|'available';
  partnerEndsAt?:string;partnerUsedToday?:boolean}};
export function teamProgress(team:AdventureTeam,now:number){
 const from=Date.parse(team.progressAt),end=Date.parse(team.endsAt);
 if(!Number.isFinite(from)||!Number.isFinite(end)||end<=from)return 0;
 return Math.min(1,Math.max(0,team.progressFraction+(1-team.progressFraction)*Math.max(0,now-from)/(end-from)));
}
export function teamStateFor(data:{profile:{id:string};partner:{id:string}|null;pairVersion?:string;activeAdventure:{id:string}|null;adventureTeam?:AdventureTeamState}){
 const value=data.adventureTeam;
 return value?.userId===data.profile.id&&(value.partnerId??null)===(data.partner?.id??null)
  &&(value.pairVersion??null)===(data.pairVersion??null)&&value.adventureId===data.activeAdventure?.id?value:null;
}
/** Display prediction only. Start v5 still rechecks eligibility under locks.
 * Never reuse the leader's personal Adventure/result ID for this user's trip. */
export function previewAdventureJoin(state:AdventureTeamState|undefined|null,scope:{userId:string;partnerId:string|null;pairVersion:string|null},now:number){
 const candidate=state?.joinable;
 if(!state||state.userId!==scope.userId||state.partnerId!==scope.partnerId||state.pairVersion!==scope.pairVersion
  ||state.adventureId||!scope.partnerId||!scope.pairVersion||!candidate||candidate.ruleVersion!==5
  ||candidate.leaderId!==scope.partnerId||candidate.partnerId!==scope.userId||candidate.pairVersion!==scope.pairVersion
  ||candidate.followerId||!Number.isFinite(now)||!Number.isFinite(Date.parse(candidate.progressAt))
  ||!Number.isFinite(candidate.progressFraction)||candidate.progressFraction<0||candidate.progressFraction>=1
  ||Date.parse(candidate.progressAt)>now||!(Date.parse(candidate.endsAt)-now>600000))return undefined;
 return {...candidate,followerId:scope.userId,progressAt:new Date(now).toISOString(),progressFraction:teamProgress(candidate,now),
  endsAt:new Date(now+(Date.parse(candidate.endsAt)-now)/1.5).toISOString()};
}
export function adventureModeCopy(plus:boolean,couple:boolean,name:string){
 if(couple)return {label:plus?'You’re in Plus+Couple Mode':'You’re in Couple Mode',
  copy:plus?'You’re enjoying 3x adventure speed.':'You’re enjoying 1.5x adventure speed.\nJoin Plus to finish an extra 2x faster.'};
 return {label:`Nudge ${name}`,copy:plus?`You’re enjoying 2x adventure speed.\nNudge ${name} to team up for 1.5x faster adventures.`
  :`Nudge ${name} to team up for 1.5x faster adventures.\nJoin Plus to finish 2x faster.`};
}

/** One view model for label, eligibility and footer. Applied trip speed is not
 * current membership; a finished invitation window must override queued copy. */
export function adventureOngoingPresentation({state,paired,name,hasPlus,pending,remaining,now,nudge}:{
 state:AdventureTeamState|null;paired:boolean;name:string;hasPlus:boolean;pending:boolean;remaining:number;now:number;
 nudge:'idle'|'queued'|'sent'|'blocked';
}){
 const team=state?.team,couple=!!team?.followerId,plus=team?.plus??hasPlus;
 const speed=plus?`You’re enjoying ${couple?'3':'2'}x adventure speed.`
  :`${couple?'You’re enjoying 1.5x adventure speed.\n':''}${hasPlus?'Your Plus speed boost is syncing.':`Join Plus to finish ${couple?'an extra ':''}2x faster.`}`;
 const mode=adventureModeCopy(plus,couple,name);
 if(couple)return {label:mode.label,copy:speed,canNudge:false,couple,plus};
 if(!paired)return {label:'Solo Adventure',copy:`${speed}\nConnect with your partner to adventure together.`,canNudge:false,couple,plus};
 if(remaining<=600000)return {label:'Your bunny is almost back',copy:speed,canNudge:false,couple,plus};
 if(pending||!state||state.coordinationPending)return {label:`Nudge ${name}`,copy:`${speed}\nChecking adventure availability…`,canNudge:false,couple,plus};
 let reason=state.nudgeStatus?.reason;
 if(reason==='partner_adventuring'||reason==='partner_finishing'){
  const left=Date.parse(state.nudgeStatus?.partnerEndsAt??'')-now;
  if(Number.isFinite(left))reason=left<=0?(state.nudgeStatus?.partnerUsedToday?'partner_finished':'relationship_unavailable')
   :left<=600000?'partner_finishing':'partner_adventuring';
 }
 if(!state.nudgeAvailable){
  const explanation=reason==='partner_finishing'?`${name} is finishing today's adventure.`
   :reason==='partner_finished'?`${name} has already finished today's adventure.`
   :reason==='partner_adventuring'?`${name} is on another adventure.`:'';
  return {label:'Solo Adventure',copy:explanation?`${speed}\n${explanation}`:speed,canNudge:false,couple,plus};
 }
 if(nudge==='queued'||nudge==='sent'||team?.nudged)return {label:'Reminder submitted ✓',
  copy:`${speed}\nReminder submitted. You’ll team up when ${name} joins.`,canNudge:false,couple,plus};
 const invitation=nudge==='blocked'?'We couldn’t submit this reminder. Please try again.'
  :`Nudge ${name} to team up for 1.5x faster adventures.`;
 return {label:`Nudge ${name}`,copy:`${speed}\n${invitation}`,canNudge:!!team,couple,plus};
}
