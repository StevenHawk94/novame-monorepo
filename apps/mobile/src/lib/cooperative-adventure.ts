import type {BunnyVariant} from './bunny-identity-model';
export type AdventureTeam={id:string;version:number;ruleVersion:5;leaderId:string;followerId:string|null;
 partnerId:string|null;pairVersion:string|null;plus:boolean;startedAt:string;progressAt:string;progressFraction:number;
 endsAt:string;nudged:boolean;leaderVariant:BunnyVariant;followerVariant:BunnyVariant};
export type AdventureTeamState={userId:string;partnerId:string|null;pairVersion:string|null;adventureId:string|null;
 team:AdventureTeam|null;joinable:AdventureTeam|null;nudgeAvailable:boolean};
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
