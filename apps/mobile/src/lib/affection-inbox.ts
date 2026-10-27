import type {AffectionType} from '@novame/domain';
import type {MajorUpdateBootstrap} from './app-major-update-api';
export type AffectionGroup={affection_type:AffectionType;completed_at:string;ids:string[]};
const types:AffectionType[]=['cuddle','hug','kiss','miss_you','gratitude','spicy'];
export function groupAffectionInbox(data:Pick<MajorUpdateBootstrap,'affectionInbox'|'affectionInboxGroups'>):AffectionGroup[]{
  const groups=new Map<AffectionType,AffectionGroup>();
  const input=data.affectionInboxGroups??data.affectionInbox.map(row=>({...row,ids:[row.id]}));
  for(const row of input){
    if(!types.includes(row.affection_type))continue;
    const previous=groups.get(row.affection_type);
    groups.set(row.affection_type,{affection_type:row.affection_type,ids:[...new Set([...(previous?.ids??[]),...row.ids])],
      completed_at:previous&&previous.completed_at<row.completed_at?previous.completed_at:row.completed_at});
  }
  return [...groups.values()].filter(g=>g.ids.length).sort((a,b)=>a.completed_at.localeCompare(b.completed_at)||types.indexOf(a.affection_type)-types.indexOf(b.affection_type));
}
export function affectionReceivedCopy(type:AffectionType,name:string,count:number){
  const many=count>1;
  const copy={
    cuddle:[`${name} sent you a cuddle`,`${name} sent you ${count} cuddles`,'A little cuddle, just for you.','Someone really wants to hold you.'],
    hug:[`${name} sent you a hug`,`${name} sent you ${count} hugs`,'A warm hug, just for you.','That’s one big pile of hugs.'],
    kiss:[`${name} sent you a kiss`,`${name} sent you ${count} kisses`,'A sweet kiss just landed.','Someone is feeling extra sweet.'],
    miss_you:[`${name} sent you a "miss you"`,`${name} sent you ${count} "miss you"`,'They’re thinking of you.','They can’t stop thinking about you.'],
    gratitude:[`${name} sent you thanks`,`${name} sent you thanks ${count} times`,'A little gratitude, just for you.','You mean a lot to them.'],
    spicy:[`${name} is feeling spicy`,`${name} is feeling extra spicy x ${count}`,'They’re missing your touch.','They can’t stop wishing you were closer.'],
  }[type];
  return {title:copy[many?1:0],body:copy[many?3:2]};
}
