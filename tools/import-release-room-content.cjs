// Feed the read-only workbook extraction (sheet name + values) to this importer.
const fs=require('node:fs');
const mapping={'People-Pleasing':'the_swallower',Overthinking:'overthinking',Procrastination:'procrastination',Lost:'the_fog',Anxiety:'the_spiral','Self-Doubt':'the_hollow',Comparison:'the_comparer',Isolation:'the_wall'};
function parseWorkbook(sheets){
 const sheet=sheets.find(x=>x.name==='Tame Dialogues');
 if(!sheet||JSON.stringify(sheet.values[0])!==JSON.stringify(['Monster','#','Angle','Bubble','A','B','C','D']))throw Error('Unexpected dialogue sheet/headers');
 const content=Object.fromEntries(Object.values(mapping).map(id=>[id,[]]));
 for(const row of sheet.values.slice(1)){
  if(row.every(x=>x==null||x===''))continue;
  const [name,number,angle,bubble,...replies]=row,id=mapping[name];
  if(!id||!Number.isInteger(number)||number<1||number>50||replies.length!==4||[angle,bubble,...replies].some(x=>typeof x!=='string'||!x.trim()||/^#(?:REF!|VALUE!|N\/A)/.test(x)))throw Error(`Invalid dialogue: ${name} ${number}`);
  if(content[id].some(x=>x.number===number))throw Error(`Duplicate number: ${name} ${number}`);
  content[id].push({id:`r${String(number).padStart(2,'0')}`,number,angle,monster:bubble,replies});
 }
 for(const [id,rows]of Object.entries(content)){
  rows.sort((a,b)=>a.number-b.number);
  if(rows.length!==50)throw Error(`${id}: expected 50, got ${rows.length}`);
  if(new Set(rows.map(x=>x.monster+'\0'+x.replies.join('\0'))).size!==50)throw Error(`${id}: duplicate dialogue`);
 }
 return content;
}
module.exports={parseWorkbook,mapping};
if(require.main===module){
 const content=parseWorkbook(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),id=process.argv[3];
 if(id){
  if(!content[id])throw Error('Unknown monster');
  const file=`packages/domain/src/release-room-dialogues/${id}.json`;
  process.stdout.write(`*** Begin Patch\n*** Add File: ${file}\n${JSON.stringify(content[id],null,2).split('\n').map(x=>'+'+x).join('\n')}\n*** End Patch`);
 }else console.log(JSON.stringify(Object.fromEntries(Object.entries(content).map(([id,rows])=>[id,{groups:rows.length,maxReply:Math.max(...rows.flatMap(r=>r.replies.map(x=>x.length))),maxBubble:Math.max(...rows.map(x=>x.monster.length))}]))));
}
