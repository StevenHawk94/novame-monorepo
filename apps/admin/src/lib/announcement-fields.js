/** Admin is the sole content writer. Never permit executable/device URL schemes. */
export function announcementFields(body,partial=false){
 const out={};
 const text=(key,max,fallback)=>{
  if(partial&&body[key]===undefined)return;
  const value=typeof body[key]==='string'?body[key].trim():fallback;
  if(!value||value.length>max)throw Error(`Invalid ${key}`);out[key]=value;
 };
 text('title',120);text('content',2000);text('image_url',2048);text('button_text',60,'Continue');
 for(const key of ['image_url','action_url']){
  if(key==='action_url'&&(!partial||body[key]!==undefined))out[key]=body[key]?.trim()||null;
  if(out[key]){const url=new URL(out[key]);if(url.protocol!=='https:'||!url.hostname||url.username||url.password)throw Error(`Invalid ${key}`);}
 }
 for(const [key,values,fallback] of [['type',['info','update','promotion','warning'],'info'],['target_users',['all','free','paid'],'all']]){
  if(partial&&body[key]===undefined)continue;
  const value=body[key]??fallback;if(!values.includes(value))throw Error(`Invalid ${key}`);out[key]=value;
 }
 if(!partial||body.end_at!==undefined){
  const date=body.end_at?new Date(body.end_at):null;
  if(date&&Number.isNaN(date.getTime()))throw Error('Invalid end_at');out.end_at=date?date.toISOString():null;
 }
 if(partial&&body.is_active!==undefined){if(typeof body.is_active!=='boolean')throw Error('Invalid is_active');out.is_active=body.is_active;}
 return out;
}
