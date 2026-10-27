// Workbook extraction is read-only. Call patches(workbook, index) with the
// bundled artifact-tool runtime; apply the returned patch through apply_patch.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const revision = "coalesce((select value from public.app_config where key='app_major_update_content_revision'),'burrow-v1-placeholder')";
export function patches(workbook, index) {
  const chars = workbook.worksheets.getItem('Characters').getUsedRange().values;
  const dialogs = workbook.worksheets.getItem('Dialogues').getUsedRange().values;
  const gifts = workbook.worksheets.getItem('Gifts').getUsedRange().values;
  const row = chars[index + 1];
  if (!row) throw Error('Unknown character index');
  const [code, name, gender, species, partner, emotionalState, speakingStyle, catchphrase] = row;
  const id = `adventure_friend_${code.toLowerCase()}`;
  const art = [2, 3].map((n, i) => `${species}_${String(n).padStart(2, '0')}_Variant${i + 1}.webp`);
  for (const file of art) if (!fs.existsSync(path.join(root, 'apps/mobile/assets/burrow-webp/adventure-page', file))) throw Error(`Missing character art ${file}`);
  const lines = (r, start, count) => r.slice(start, start + count).filter(v => v != null && v !== '').map(String);
  const content = dialogs.slice(1).filter(r => r[1] === name).map(r => ({
    id: r[0], friendId: id, phase: r[3], seq: r[4], familiarity: r[6], type: r[7],
    scene: r[8] || null, lines: lines(r, 9, 4),
    choices: [[13,14,'a'],[17,18,'b'],[21,22,'c']].filter(([o]) => r[o]).map(([o,s,k]) => ({id:k,label:r[o],reaction:lines(r,s,3)})),
    outro: r[25] || null,
  }));
  if (content.length !== 30 || new Set(content.map(d => d.id)).size !== 30 || content.some(d => !d.lines.length || d.choices.length < 2 || d.choices.some(c => !c.reaction.length))) throw Error(`Invalid dialogue content ${name}`);
  const rewards = gifts.slice(1).filter(r => r[0] === name).map(r => {
    const file = `${r[3]}/${r[5].replace(/\.png$/i, '.webp')}`;
    const absolute = path.join(root, 'apps/mobile/assets/burrow-webp/Gift Collection Webp', file);
    const bytes = fs.readFileSync(absolute), hash = crypto.createHash('sha256').update(bytes).digest('hex');
    // Source ID outlives friend renames/reassignments and preserves ownership.
    return {id:`adventure_gift_${r[6]}`,friendId:id,giftId:r[1],name:r[2],category:r[3],categoryCode:r[4],sourceId:r[6],file,
      key:`burrow/adventure-gifts/v1/${r[6]}-${hash.slice(0,16)}.webp`,sha256:hash,bytes:bytes.length};
  });
  const document = {code,id,name,gender,species,partner,emotionalState,speakingStyle,catchphrase,art,dialogues:content,gifts:rewards};
  let sql = `\n-- ${name}: workbook v8. Existing completed dialogue IDs remain consumed.\n`;
  sql += `insert into public.friend_definitions(stable_id,revision_id,name,subtitle,art,metadata,is_placeholder) values(${q(id)},${revision},${q(name)},${q(catchphrase)},${q(JSON.stringify({renderer:'bundled',key:species}))}::jsonb,${q(JSON.stringify({adventureV2:true,code,gender,species}))}::jsonb,false) on conflict(stable_id) do update set name=excluded.name,subtitle=excluded.subtitle,art=excluded.art,metadata=excluded.metadata,status='active',updated_at=now();\n`;
  sql += `insert into public.adventure_dialogues_v2(id,friend_id,phase,seq,weight,content) values\n`;
  sql += content.map(d => `(${q(d.id)},${q(id)},${q(d.phase)},${d.seq},${d.type==='Rare'?0.25:1},${q(JSON.stringify(d))}::jsonb)`).join(',\n');
  sql += `\non conflict(id) do update set content=excluded.content,phase=excluded.phase,seq=excluded.seq,weight=excluded.weight,status='active';\n`;
  sql += `insert into public.catalog_items(stable_id,revision_id,item_type,category,title,price,tradable,tags,asset,metadata,is_placeholder) values\n`;
  sql += rewards.map(g => `(${q(g.id)},${revision},'souvenir','adventure_gifts',${q(g.name)},null,false,array['adventure_v2_gift'],${q(JSON.stringify({renderer:'r2',key:g.key,url:`https://media.novameapp.com/${g.key}`,width:600,height:600}))}::jsonb,${q(JSON.stringify({giftCategory:g.category,giftCategoryCode:g.categoryCode,friendId:id,sourceId:g.sourceId}))}::jsonb,false)`).join(',\n');
  sql += `\non conflict(stable_id) do update set title=excluded.title,asset=excluded.asset,metadata=excluded.metadata,status='active',updated_at=now();\n`;
  const json = JSON.stringify(document, null, 2) + '\n';
  return `*** Begin Patch\n*** Add File: ${root}/apps/api/src/data/adventure-friends/${code}.json\n${json.split('\n').filter((_,i,a)=>i<a.length-1).map(l=>'+'+l).join('\n')}\n*** Update File: ${root}/supabase/migrations/20261010000214_adventure_friends_content.sql\n@@\n--- CONTENT NEXT\n+${sql.trim().split('\n').join('\n+')}\n+-- CONTENT NEXT\n*** End Patch`;
}
