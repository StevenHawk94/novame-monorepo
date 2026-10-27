const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,deferred,flush}=require('./lifecycle-test-utils.cjs');
const copy=load('apps/api/src/lib/system-notification-copy.mjs');
test('five active copies and destinations match approved wording; unknown/retired types have no fallback message',()=>{
 const expected={game_invite:['Game Room','Alex finished a game. It’s your turn to play!'],game_ready:['Game Room','Your results are ready to see!'],affection_received:['Alex sent you some love ❤️','Open to see it.'],surprise_received:['Alex left you a surprise 🎁','Tap to see what it is.'],adventure_reminder:['Adventure time?','Log your day and take your bunny exploring.']};
 for(const [type,text] of Object.entries(expected)){const c=copy.systemNotificationCopy(type,{sessionId:'session',eventId:'event',surpriseId:'surprise'},'Alex');assert.deepEqual([c.title,c.body],text);assert.equal(c.data.type,type);}
 for(const type of ['court_ready','court_invite','partner_reflect','partner_reflect_widget_refresh','unexpected'])assert.equal(copy.systemNotificationCopy(type),null);
 assert.equal(copy.systemNotificationCopy('affection_received',{},'').title,'Your partner sent you some love ❤️');
});
function push({type='affection_received',allowed=true,expires=null,version=2,enabled=true,fail=false}={}){
 const sent=[],updates=[],filters=[],row={id:'row',recipient_user_id:'me',event_type:type,attempts:0,payload:{eventId:'event'},expires_at:expires};
 const db={rpc:async()=>({data:{allowed,partnerName:'Alex'}}),from:table=>{
  let patch;const conditions=[];const query={update(v){patch=v;updates.push([table,v]);return this;},select(){return this;},eq(k,v){conditions.push([k,v]);return this;},in(k,v){conditions.push([k,v]);return this;},lt(){return this;},lte(){return this;},gte(k,v){conditions.push([k,v]);return this;},order(){return this;},limit(){return this;},maybeSingle:async()=>({data:{id:'row'}}),
  then(resolve,reject){filters.push([table,conditions]);let data=null;if(!patch&&table==='notification_outbox')data=copy.SYSTEM_NOTIFICATION_TYPES.includes(type)?[row]:[];
   if(!patch&&table==='device_push_tokens')data=(!conditions.some(([k])=>k==='notification_version')||version>=2)&&(!conditions.some(([k])=>k==='adventure_reminder_enabled')||enabled)?[{id:'token',expo_push_token:'ExpoPushToken[test]',platform:'ios'}]:[];
   return Promise.resolve({data,error:null}).then(resolve,reject);}};return query;}};
 const api=load('apps/api/src/lib/push-notifications.js',{'./system-notification-copy.mjs':copy},{process:{env:{}},fetch:async(_url,options)=>{sent.push(JSON.parse(options.body));if(fail)throw Error('network');return{ok:true,json:async()=>({data:[{status:'ok'}]})};}});
 return{sent,updates,filters,run:()=>api.drainPushNotificationOutbox(db)};
}
test('visible push only; no silent/widget request; no new notices to unsupported old clients',async()=>{
 const h=push();await h.run();assert.equal(h.sent.length,1);assert.equal(h.sent[0][0].title,'Alex sent you some love ❤️');assert.equal(h.sent[0][0].contentAvailable,undefined);
 const old=push({version:1});await old.run();assert.equal(old.sent.length,0);
 const game=push({type:'game_ready',version:1});await game.run();assert.equal(game.sent.length,1);
});
test('retired events, stale pairing, expired notices and opted-out reminder never reach transport',async()=>{
 for(const options of [{type:'partner_reflect'},{type:'court_ready'},{allowed:false},{expires:'2000-01-01T00:00:00Z'},{type:'adventure_reminder',enabled:false}]){const h=push(options);await h.run();assert.equal(h.sent.length,0);}
});
test('transport failure keeps retry state, not sent, and no extra background message is emitted',async()=>{
 const h=push({fail:true});await h.run();assert.equal(h.sent.length,1);assert.ok(h.updates.some(([,p])=>p.status==='retry'));assert.ok(!h.updates.some(([,p])=>p.status==='sent'));
});
function settings({legacy=true,apiFailure=false,oldServer=false}={}){
 let saved=legacy?JSON.stringify({enabled:true,hour:9,min:15,identifier:'old',scheduleVersion:2}):null;
 const calls=[],scheduled=[{identifier:'old',content:{body:'How was your day? your companion wants to hear about your life moments.'}},{identifier:'other-feature',content:{body:'Other reminder'}}];
 let post=async body=>{calls.push(['register',body]);if(apiFailure)throw Error('offline');return{success:true,notificationVersion:oldServer?undefined:2};};
 const api=load('apps/mobile/src/lib/notification-settings.ts',{
 'expo-notifications':{getPermissionsAsync:async()=>({granted:true}),getAllScheduledNotificationsAsync:async()=>scheduled,cancelScheduledNotificationAsync:async id=>calls.push(['cancel',id]),getExpoPushTokenAsync:async()=>({data:'ExpoPushToken[test]'})},'react-native':{Platform:{OS:'ios'}},'expo-constants':{__esModule:true,default:{expoConfig:{extra:{eas:{projectId:'project'}}}}},
 './storage':{storage:{getString:()=>saved,set:(_key,value)=>{saved=value;}}},'./api':{apiClient:{post:(_url,body)=>post(body)}},'./supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'me'}}}})}}},
 });return{api,calls,state:()=>JSON.parse(saved),post:fn=>post=fn};
}
test('migrates only old reminder IDs, fixes 8pm, preserves opt-in and registers supported version',async()=>{
 const h=settings();assert.equal(await h.api.reconcileDailyReminderSchedule(),true);assert.ok(h.calls.some(c=>c[0]==='cancel'&&c[1]==='old'));assert.ok(!h.calls.some(c=>c[1]==='other-feature'));
 assert.equal(h.state().identifier,null);assert.equal(h.state().hour,20);assert.equal(h.state().enabled,true);assert.equal(h.state().remotePending,false);
 assert.equal(h.calls.find(c=>c[0]==='register')[1].dailyReminderEnabled,true);
});
test('offline/older-server registration remains pending for retry; disabling does not disable other remote notifications',async()=>{
 for(const options of [{apiFailure:true},{oldServer:true}]){const h=settings(options);await h.api.reconcileDailyReminderSchedule();assert.equal(h.state().remotePending,true);}
 const h=settings();await h.api.cancelDailyReminder();const body=h.calls.filter(c=>c[0]==='register').at(-1)[1];assert.equal(body.dailyReminderEnabled,false);assert.equal(body.notificationVersion,2);assert.equal(h.state().enabled,false);
});
test('serialized registration makes newer opt-out win over delayed opt-in',async()=>{
 const h=settings(),first=deferred(),bodies=[];h.post(body=>{bodies.push(body);return bodies.length===1?first.promise:Promise.resolve({success:true,notificationVersion:2});});
 const enabling=h.api.scheduleDailyReminder(20,0);await flush();const disabling=h.api.cancelDailyReminder();first.resolve({success:true,notificationVersion:2});await enabling;await disabling;
 assert.equal(bodies.at(-1).dailyReminderEnabled,false);assert.equal(h.state().remotePending,false);
});
test('partner-reflect campaign compatibility facade never queues, fetches or assigns a paywall',async()=>{
 const removed=[];const api=load('apps/mobile/src/lib/partner-reflect-paywall.ts',{'./storage':{storage:{remove:key=>removed.push(key)}},'@/shared/storage':{kPartnerReflectPaywallQueue:{name:'queue'},kPartnerReflectPaywallAssignment:{name:'assignment'}}});
 api.requestPartnerReflectPaywall('reflect');assert.equal(api.peekPartnerReflectPaywall(),null);await api.syncPartnerReflectPaywallRequests();assert.equal((await api.claimPartnerReflectPaywall('reflect')).eligible,false);assert.ok(removed.includes('queue'));
});
test('widget native targets retained; disabled background handler cannot fetch data, unregisters old task',async()=>{
 const calls=[];let handler;const api=load('apps/mobile/src/lib/background-widget-refresh.ts',{'expo-notifications':{unregisterTaskAsync:async name=>calls.push(name)},'expo-task-manager':{isTaskDefined:()=>false,defineTask:(_name,fn)=>handler=fn,isAvailableAsync:async()=>true,isTaskRegisteredAsync:async()=>true},'./widget-policy':{widgetUpdatesEnabled:()=>false}});
 await flush();assert.deepEqual(calls,[api.PARTNER_WIDGET_REFRESH_TASK]);assert.equal(await handler({data:{data:{type:api.PARTNER_WIDGET_REFRESH_TYPE}}}),1);
 assert.ok(fs.existsSync('apps/mobile/targets/widget/index.swift'));assert.ok(fs.existsSync('apps/mobile/modules/widget-sync/android/src/main/java/com/burrow/widgetsync/BurrowWidgetProvider.kt'));
});
test('notification-only migration never replaces business/red-dot functions or touches wallet/claims/Moments',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261020000254_system_notification_policy.sql','utf8');
 assert.doesNotMatch(sql,/create or replace function/i);assert.doesNotMatch(sql,/(?:update|delete from)\s+(?:public\.)?(?:wallets|moment_events|adventures|affection_events|burrow_surprises|burrow_attention)/i);
 const root=fs.readFileSync('apps/mobile/app/_layout.tsx','utf8'),gate=fs.readFileSync('apps/mobile/src/components/rating/official-rating-gate.tsx','utf8');assert.doesNotMatch(root,/requestPartnerReflectPaywall/);assert.doesNotMatch(gate,/claimPartnerReflectPaywall|syncPartnerReflectPaywallRequests/);
});
test('registration validates identity; old clients preserve v2 preferences, new clients receive capability acknowledgement',async()=>{
 const writes=[];const route=load('apps/api/src/app/api/notifications/register/route.js',{
  'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
  '@/lib/auth-guard':{verifyToken:async()=>({id:'me'})},
  '@/lib/reflect-draft':{serviceClient:()=>({from:()=>({upsert:async row=>{writes.push(row);return{error:null};}})})},
 });
 const request=body=>new Request('https://test/api/notifications/register',{method:'POST',headers:{authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)});
 const base={userId:'me',token:'ExpoPushToken[test]',platform:'ios'};
 assert.equal((await route.POST(request({...base,userId:'other'}))).status,401);assert.equal(writes.length,0);
 const legacy=await route.POST(request(base));assert.equal((await legacy.json()).notificationVersion,1);
 assert.equal(Object.hasOwn(writes[0],'adventure_reminder_enabled'),false);assert.equal(Object.hasOwn(writes[0],'notification_version'),false);
 const modern=await route.POST(request({...base,notificationVersion:2,dailyReminderEnabled:false}));assert.equal((await modern.json()).notificationVersion,2);
 assert.equal(writes[1].adventure_reminder_enabled,false);assert.equal(writes[1].enabled,true);
});
test('retired Paywall endpoint keeps authenticated old clients compatible without campaign reads or writes',async()=>{
 const route=load('apps/api/src/app/api/marketing/partner-reflect-paywall/route.js',{'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},'@/lib/auth-guard':{verifyToken:async()=>({id:'me'})}},{URL});
 const response=await route.GET(new Request('https://test/api/marketing/partner-reflect-paywall?userId=me',{headers:{authorization:'Bearer test'}}));
 assert.deepEqual(await response.json(),{success:true,eligible:false,reflectIds:[]});
 const denied=await route.GET(new Request('https://test/api/marketing/partner-reflect-paywall?userId=other'));assert.equal(denied.status,401);
});
test('new push destinations reuse prepared entry routes; malformed Surprise IDs do not navigate',()=>{
 const {systemNotificationDestination:destination}=load('apps/mobile/src/lib/system-notification-routing.ts');
 assert.equal(destination({type:'affection_received'}).params.section,'affection');assert.equal(destination({type:'adventure_reminder'}).params.section,'adventure');
 assert.equal(destination({type:'surprise_received',surpriseId:'invalid'}),null);
 assert.equal(destination({type:'surprise_received',surpriseId:'11111111-1111-4111-8111-111111111111'}).params.receive,'1');
});
