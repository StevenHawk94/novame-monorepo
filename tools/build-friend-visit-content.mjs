// Import XLSX with the bundled artifact-tool runtime, then apply the returned
// patch. Source workbook is never edited; user rules override README rewards.
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const sqlQuote=value=>"'"+String(value).replaceAll("'","''")+"'";
const rows=(workbook,name)=>{const values=workbook.worksheets.getItem(name).getUsedRange().values;
  return values.slice(1).map(row=>Object.fromEntries(values[0].map((key,i)=>[key,row[i]])));};
export const WAITING_LINES={
  MM:["Hm. Comfy chair. I’ll stay till {partner}’s back. Haven’t said hi yet.","Hm. Mabel says don’t leave before greeting everyone. So. Waiting for {partner}."],
  JN:["I’m fine. Just chilling on your couch till {partner} shows up. Don’t mind me.","Not leaving till I’ve said hi to {partner}. Also your snacks are good. Mostly that."],
  PK:["I’m NOT staying just to see {partner}. I’m just... resting. Okay, I’m staying.","Tell {partner} I’m here. Not because I missed them. I’m FINE."],
  TW:["Is {partner} coming back soon? Not that I’m waiting. I’m totally waiting. Nice weather.","Okay so I’ll just sit here quietly until {partner} gets home. Quietly. Mostly quietly."],
  HZ:["Okay, so, I’ve blocked out the next hour to wait for {partner}. It’s in my planner.","Okay, so, I reorganized your shelf while waiting for {partner}. You’re welcome."],
  BC:["What time does {partner} get back? I’ll wait. I’m really good at waiting.","I’ll just keep checking the clock till {partner} gets here. Old habit."],
  KK:["GUESS WHAT!! I’m not leaving till I see {partner}!! I have SO much to tell them!!","Where’s {partner}?? I’ve been here two minutes and I already miss them!!"],
  DL:["...I’ll wait for {partner}. If that’s okay. ...I’ll be quiet.","...Didn’t get to say hi to {partner} yet. I’ll stay a bit. ...Maybe."],
  DC:["Oh, dear, I couldn’t possibly leave without seeing {partner}. I’ll put the kettle on.","Oh, dear, I’ll just wait right here for {partner}. These scones won’t eat themselves."],
  AR:["Small thing, but I’d really like to say hi to {partner} before I go. Cracker?","Small thing, but I saved {partner} the best cracker. I’m guarding it till they’re back."],
  FN:["I can’t leave without seeing {partner}! What if it’s a SIGN?","I’ll just wait here for {partner}. Romantically. On your windowsill."],
  OS:["Okay, hear me out. I’ll wait for {partner}. Unless that’s weird. Is it weird? I’ll wait.","I rehearsed my ‘hi {partner}’ three times. I’m ready. Just waiting now."],
  BR:["Gotta give {partner} a big hug before I go. Big feelings. Big wait.","I brought {partner} some honey. I’ll wait to give it in person. I might cry."],
  RU:["I’m good. ...Just waiting on {partner}. Not like I care. ...I care a little.","I’ll stick around till {partner}’s back. Got nowhere to be. ...Are you okay?"],
  TB:["I’ll wait for {partner}. No rush. I’ve got all the time in the world. Literally.","Saving a seat for {partner}. I’m comfortable. Very comfortable. No rush."],
};
const lines=(row,prefix)=>[1,2,3].map(i=>row[`${prefix}${i}`]).filter(Boolean);
export function visitDocument(workbook,index){
  const character=rows(workbook,'Characters')[index];if(!character)throw Error('Invalid character');
  const {Code:code,Friend:name}=character,friendId=`adventure_friend_${code.toLowerCase()}`;
  const replies=rows(workbook,'Visit_Couple_Replies'),seen=new Set();
  const questions=rows(workbook,'Visit_Trivia').filter(q=>q.Friend===name).map(q=>{
    if(seen.has(q.ID))throw Error('Duplicate question');seen.add(q.ID);
    const choices=['A','B','C'].filter(o=>q[`Option_${o}`]).map(o=>({id:o,label:q[`Option_${o}`],reply:lines(q,`Reply_${o}_Line_`)}));
    const coupleReplies={};
    for(const r of replies.filter(r=>r.Question_ID===q.ID)){
      const key=`${r.First_Answerer_Pick}:${r.Second_Answerer_Pick}`;
      if(coupleReplies[key]||r.Type!==q.Type||r.Friend!==name)throw Error('Invalid reply key');
      if(choices.find(c=>c.id===r.First_Answerer_Pick)?.label!==r.First_Pick_Text
        ||choices.find(c=>c.id===r.Second_Answerer_Pick)?.label!==r.Second_Pick_Text)throw Error('Reply choice mismatch');
      coupleReplies[key]=lines(r,'Reply_Line_');
    }
    if(q.Type!=='Trivia')for(const a of choices)for(const b of choices)if(!coupleReplies[`${a.id}:${b.id}`]?.length)throw Error('Missing matrix');
    if(choices.length<2||choices.some(c=>!c.reply.length)||!q.Question||(q.Type==='Guess'&&!q.Question_Self_Version))throw Error('Incomplete question');
    if(q.Type==='Trivia'&&!choices.some(c=>c.id===q.Correct_Option))throw Error('Missing correct option');
    return {id:q.ID,friendId,type:q.Type,scene:q.Scene,lines:[q.Friend_Line],question:q.Question,selfQuestion:q.Question_Self_Version,
      choices,correctOption:q.Correct_Option,coinsIfCorrect:q.Coins_If_Correct,coinsIfWrong:q.Coins_If_Wrong,factBasis:q.Fact_Basis,coupleReplies};
  });
  if(questions.length!==20||['Trivia','Preference','Guess'].some((t,i)=>questions.filter(q=>q.type===t).length!==[10,5,5][i]))throw Error('Invalid question counts');
  return {code,name,friendId,waitingLines:WAITING_LINES[code],questions};
}
export function patches(workbook,index){
  const doc=visitDocument(workbook,index),json=JSON.stringify(doc,null,2)+'\n';
  const sql=`insert into public.friend_visit_characters_v2(friend_id,waiting_lines) values(${sqlQuote(doc.friendId)},${sqlQuote(JSON.stringify(doc.waitingLines))}::jsonb) on conflict(friend_id) do update set waiting_lines=excluded.waiting_lines;\n`
    +`insert into public.friend_visit_questions_v2(id,friend_id,kind,content) values\n`
    +doc.questions.map(q=>`(${sqlQuote(q.id)},${sqlQuote(doc.friendId)},${sqlQuote(q.type)},${sqlQuote(JSON.stringify(q))}::jsonb)`).join(',\n')
    +'\non conflict(id) do update set content=excluded.content,kind=excluded.kind,status=\'active\';';
  return `*** Begin Patch\n*** Add File: ${root}/apps/api/src/data/friend-visits/${doc.code}.json\n${json.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n*** Update File: ${root}/supabase/migrations/20261014000236_friend_visit_workbook_content.sql\n@@\n--- CONTENT NEXT\n+${sql.split('\n').join('\n+')}\n+-- CONTENT NEXT\n*** End Patch`;
}
