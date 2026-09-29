export async function testContentEditor({db,rpc,query,check}) {
  await db.exec('begin');
  try {
    const admin='00000000-0000-0000-0000-000000000001';
    const [item]=await query('select stable_id from catalog_items order by stable_id limit 1');
    const call=(kind,id,action,payload=null,version=0,base=null)=>rpc('edit_burrow_content_v1',[admin,kind,id,action,payload,version,base]);
    const first=await call('catalog',item.stable_id,'read');
    check(first.editable.includes('title')&&!first.editable.includes('price'),'economic fields protected');
    check((await call('catalog',item.stable_id,'stage',{price:1},0,first.baseHash)).error==='protected_field','cannot alter price');
    check((await call('catalog',item.stable_id,'stage',{title:'Updated copy'},0,first.baseHash)).version===1,'stage version');
    check((await call('catalog',item.stable_id,'read')).current.title===first.current.title,'staging does not publish');
    check((await call('catalog',item.stable_id,'publish',null,0)).error==='content_conflict','stale publish denied');
    check((await call('catalog',item.stable_id,'publish',null,1)).published,'publish atomic');
    const after=await call('catalog',item.stable_id,'read');
    check(after.current.title==='Updated copy'&&after.current.price===first.current.price,'publish copy only');
    check((await call('catalog',item.stable_id,'stage',{title:'Old request'},1,first.baseHash)).error==='content_conflict','delayed editor cannot overwrite');
    check((await query('select count(*)::int n from burrow_content_audit where content_id=$1',[item.stable_id]))[0].n===1,'publish audit retained');
    const [content]=await query("select id from friend_content where status='active' limit 1");
    const dialogue=await call('dialogue',content.id,'read');
    await call('dialogue',content.id,'stage',{content_type:'question',choices:[]},0,dialogue.baseHash);
    await db.exec('savepoint invalid_publish');
    let rejected=false;try{await call('dialogue',content.id,'publish',null,1);}catch{rejected=true;await db.exec('rollback to savepoint invalid_publish');}
    check(rejected,'invalid interaction cannot publish');
    check((await call('dialogue',content.id,'read')).current.content_type===dialogue.current.content_type,'failed publish leaves live row unchanged');
    check(!(await query("select has_function_privilege('authenticated','edit_burrow_content_v1(uuid,text,text,text,jsonb,integer,text)','EXECUTE') ok"))[0].ok,'content publishing service only');
  } finally {await db.exec('rollback');}
}
