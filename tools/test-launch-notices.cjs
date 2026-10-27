const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const lib='apps/mobile/src/lib/',plain=x=>JSON.parse(JSON.stringify(x));
function launch({required=false,notice={id:'news'},versionWait,noticeWait,session={user:{id:'A'}},seen=true}={}){
 const time=clock(),calls=[];
 const api=load(lib+'launch-notices.ts',{
  './force-update':{checkForceUpdate:()=>{calls.push('version');return versionWait?.promise??Promise.resolve({required,message:null});}},
  './announcements-api':{prepareUnreadAnnouncement:()=>{calls.push('announcement');return noticeWait?.promise??Promise.resolve(notice);}},
  './auth':{getCurrentSession:async()=>{calls.push('session');return session;}},'./onboarding':{hasSeenIntro:()=>seen},
  './onboarding-announcement-entry':{clearOnboardingAnnouncementPending:()=>calls.push('clear-first-home')},
 },time.globals);return {api,time,calls};
}
test('required update wins; no announcement fetch/ack before or after slow version check',async()=>{
 const versionWait=deferred(),h=launch({versionWait}),pending=h.api.prepareLaunchNotices();
 assert.deepEqual(h.calls,['version']);versionWait.resolve({required:true,message:'Update'});
 const result=await pending;assert.equal(result.update.required,true);assert.equal(result.announcement,null);assert.deepEqual(h.calls,['version']);
});
test('next compatible launch displays the still-unread announcement; version always resolves first',async()=>{
 const h=launch(),result=await h.api.prepareLaunchNotices();
 assert.deepEqual(h.calls,['version','session','clear-first-home','announcement']);assert.equal(result.announcement.id,'news');assert.equal(result.userId,'A');
});
test('bounded announcement deadline skips late popup; unresponsive version adapter cannot trap Splash',async()=>{
 const noticeWait=deferred(),h=launch({noticeWait}),pending=h.api.prepareLaunchNotices();await flush();
 h.time.advance(2500);const result=await pending;assert.equal(result.announcement,null);noticeWait.resolve({id:'late'});await flush();assert.equal(result.announcement,null);
 const versionWait=deferred(),v=launch({versionWait,session:null}),work=v.api.prepareLaunchNotices();v.time.advance(4200);
 assert.equal((await work).update.required,false);
});
test('new anonymous onboarding and signed-out launches never show a targeted announcement',async()=>{
 for(const options of [{session:null},{session:{user:{id:'A',is_anonymous:true}},seen:false}]){
  const h=launch(options);assert.equal((await h.api.prepareLaunchNotices()).announcement,null);assert.ok(!h.calls.includes('announcement'));
 }
});
function gate({url=null}={}){
 const h=hooks(),calls=[],identities=[],back=[];let ready=false,owner='A',segments=['(main)','(tabs)'],linkError=false;
 const jsx=(type,props)=>({type,props}),notice={id:'news',title:'New outfits',content:'Description',image_url:'https://img.invalid/a.webp',button_text:'Let’s Burrow!',action_url:url};
 const {AnnouncementLaunchGate}=load('apps/mobile/src/components/main/announcement-launch-gate.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'expo-router':{useSegments:()=>segments},
  'react-native':{AppState:{currentState:'active'},BackHandler:{addEventListener:(_,fn)=>{back.push(fn);return {remove(){}};}},
   Linking:{openURL:async u=>{calls.push(['link',u]);if(linkError)throw Error('offline');}},
   Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFillObject:{position:'absolute'}}},
  'expo-image':{Image:'Image'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
  '@/lib/app-viewport':{useAppViewport:()=>({width:390,height:844})},'@/lib/use-home-entry':{useHomeEntry:()=>({pending:!ready})},
  '@/lib/home-entry-readiness':{isHomeEntryRoute:s=>s.join('/')==='(main)/(tabs)'},
  '@/lib/session-lifecycle':{sessionUserId:()=>owner,subscribeSessionIdentity:fn=>{identities.push(fn);return()=>{};}},
  '@/lib/announcements-api':{clearPreparedAnnouncement:(...a)=>calls.push(['clear',...a]),markAnnouncementRead:async(...a)=>calls.push(['read',...a])},
  '@/lib/splash':{hideSplashOnce(){}},'./burrow-launch-screen':{BurrowLaunchScreen:'Splash'},
 });
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 const render=()=>nodes(h.render(()=>AnnouncementLaunchGate({announcement:notice,userId:'A',onClose:()=>calls.push(['close'])})));
 return {render,calls,back,ready:()=>{ready=true;},failLink:()=>{linkError=true;},changeOwner:()=>{owner='B';identities.forEach(fn=>fn());},route:s=>{segments=s;}};
}
test('announcement covers loading Home, then shows white rounded image frame and custom text; close consumes once',()=>{
 const h=gate();assert.ok(h.render().some(n=>n.type==='Splash'));assert.equal(h.calls.length,0);
 h.ready();const tree=h.render(),frame=tree.find(n=>n.type==='View'&&Array.isArray(n.props.style)&&n.props.style[0]?.backgroundColor==='#fff');
 assert.ok(frame);assert.ok(frame.props.style[0].borderRadius>0);assert.ok(tree.some(n=>n.props?.children==='New outfits'));
 assert.ok(tree.some(n=>n.props?.children==='Let’s Burrow!'));
 const close=tree.find(n=>n.props?.accessibilityLabel==='Close announcement');close.props.onPress();close.props.onPress();
 assert.deepEqual(h.calls,[['clear','A','news'],['read','A','news'],['close']]);
});
test('no-link action closes; linked action opens then closes; failed link keeps page and read state intact',async()=>{
 const no=gate();no.ready();await no.render().find(n=>n.props?.accessibilityLabel==='Let’s Burrow!').props.onPress();await flush();
 assert.equal(no.calls.filter(x=>x[0]==='close').length,1);
 const yes=gate({url:'https://example.com/news'});yes.ready();yes.render().find(n=>n.props?.accessibilityLabel==='Let’s Burrow!').props.onPress();await flush();
 assert.deepEqual(yes.calls.map(x=>x[0]),['link','clear','read','close']);
 const bad=gate({url:'https://example.com/news'});bad.ready();bad.failLink();bad.render().find(n=>n.props?.accessibilityLabel==='Let’s Burrow!').props.onPress();await flush();
 assert.deepEqual(bad.calls.map(x=>x[0]),['link']);assert.ok(bad.render().some(n=>n.props?.accessibilityRole==='alert'));
});
test('account switch or external-entry route dismisses without consuming the private announcement',()=>{
 const h=gate();h.render();h.changeOwner();assert.deepEqual(h.calls,[['close']]);
 const deep=gate();deep.route(['(main)','game-room']);deep.render();assert.deepEqual(deep.calls,[['close']]);
});
test('announcement close survives offline/relaunch and retries read acknowledgement using the same user/id',async()=>{
 const disk=new Map(),calls=[];let online=false,owner='A';
 function api(){return load(lib+'announcements-api.ts',{
  './api':{apiClient:{get:async()=>({announcement:{id:'news',image_url:'https://img.invalid/news'}}),post:async(_p,body)=>{calls.push(plain(body));if(!online)throw Error('offline');}}},
  'expo-image':{Image:{prefetch:async()=>true}},'react-native':{Platform:{OS:'ios'}},
  './download-queue':{enqueueR2Image(){},ensurePriorityR2Image:async()=>true},
  './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},'../shared/storage/keys':{kAnnouncementReads:{keyFor:id=>'reads:'+id}},
  './session-lifecycle':{sessionUserId:()=>owner},
 });}
 await api().markAnnouncementRead('A','news');assert.equal((await api().prepareUnreadAnnouncement('A')),null);
 online=true;await api().fetchUnreadAnnouncement('A');assert.ok(calls.length>=2);assert.ok(calls.every(c=>c.userId==='A'&&c.announcementId==='news'));
 assert.deepEqual(JSON.parse(disk.get('reads:A')).pending,[]);owner='B';const before=calls.length;await api().markAnnouncementRead('A','other');assert.equal(calls.length,before);
});
