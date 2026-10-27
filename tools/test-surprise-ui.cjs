const {test}=require('node:test');const assert=require('node:assert/strict');
const {load,hooks,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.type==='FramePicker'?[
 Object.keys(require('../apps/mobile/src/lib/surprise-frame-geometry.json')).map(id=>jsx('Pressable',{accessibilityLabel:id[0].toUpperCase()+id.slice(1)+' frame',onPress:()=>x.props.onSelect(id)})),
 jsx('Continue',{title:x.props.continueTitle,onPress:x.props.onContinue}),
]:x.props?.children),...(['PlaybackSurface','PlaybackOverlay'].includes(x.type)?nodes([
  x.props.showRain!==false&&jsx('Rain',{frame:x.props.frame,uri:x.props.uri,playing:x.props.playing,transparent:true}),
  jsx('Pressable',{accessibilityLabel:x.props.closeLabel??'Close surprise',onPress:x.props.onClose}),
]):[])]:[];
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function harness(options={}){
 const checkout=require('./coin-purchase-test-mock.cjs')({manual:options.manual});
 const h=hooks(),writes=[],sends=[],alerts=[],listeners=[],opened=[],navigation=[],nativeCalls=[],modes=[],outbox=[],released=[],toasts=[];let keys=0;
 let identity,recordStatus={isRecording:false,durationMillis:0},recordUri='recorded.m4a',recorderReleased=false,playerReleased=false,statusFails=false,stopFails=options.stopReject??false;
 let focusStart,focusCleanup,focusReleases=0;
 const draft={userId:A,partnerId:B,pairVersion:'a'.repeat(32),key:'fixed-key',frame:'santa',...options.draft};
 const data={catalogComplete:true,profile:{id:A},partner:{id:B,display_name:'Alex'},pairVersion:'a'.repeat(32),catalog:Object.keys(require('../apps/mobile/src/lib/surprise-frame-geometry.json')).map(id=>({stable_id:'surprise:'+id,item_type:'surprise',price:300,plus_only:false})),wallet:{balance:options.balance??1000}};
 const audio={playing:false,isLoaded:true,currentTime:0,duration:12,didJustFinish:false,playbackState:'readyToPlay'};
 const player={play:()=>{if(playerReleased)throw Error('Player shared object released');nativeCalls.push('play');audio.playing=true;},pause:()=>{if(playerReleased)throw Error('Player shared object released');audio.playing=false;},seekTo:async value=>{nativeCalls.push('seek:'+value);if(options.seek)await options.seek();audio.currentTime=value;audio.didJustFinish=false;}};
 const recorder={getStatus:()=>{nativeCalls.push('getStatus');if(recorderReleased||statusFails)throw Error('Recorder shared object released');return recordStatus;},
  prepareToRecordAsync:async()=>{nativeCalls.push('prepare');if(options.prepare)await options.prepare;},record:()=>{nativeCalls.push('record');recordStatus={isRecording:true,durationMillis:0};},
  stop:()=>{nativeCalls.push('stop');if(recorderReleased||options.stopSyncThrow)throw Error('Recorder shared object released');if(stopFails)return Promise.reject(Error('Stop rejected'));recordStatus={...recordStatus,isRecording:false};return Promise.resolve();},get uri(){if(recorderReleased)throw Error('Recorder shared object released');return recordUri;}};
 const app={currentState:'active',addEventListener:(_name,fn)=>{listeners.push(fn);return{remove(){const index=listeners.indexOf(fn);if(index>=0)listeners.splice(index,1);}};}};
 const appState=state=>{app.currentState=state;listeners.slice().forEach(fn=>fn(state));};
 const api={SURPRISE_FRAMES:['santa','bunny','flower','heart','birthday','star'],readSurpriseDraft:()=>draft,saveSurpriseDraft:next=>writes.push(next),clearSurpriseDraft:()=>{},keepSurpriseFile:async uri=>options.keepPhoto?options.keepPhoto(uri):'private/'+uri,releaseSurpriseFile:async uri=>released.push(uri),
  sendSurprise:async value=>{sends.push(value);return options.send?options.send(value):{id:'sent-id'};},loadSurpriseMedia:async()=>options.media?options.media():({photoUrl:'private/received.jpg',audioUrl:'private/voice.m4a'}),openSurprise:async id=>{opened.push(id);},surpriseTime:ms=>`0:${Math.floor(ms/1000)}`};
 const queueSend=async job=>{job.state='sending';try{const receipt=await api.sendSurprise(job.draft);job.state='sent';job.sentId=receipt.id;writes.push({...job.draft,sentId:receipt.id});}catch(error){job.state='failed';job.error=error.body?.error??error.message;job.failureStage=error.status===400?'send':'receipt';}};
 const module=load('apps/mobile/src/components/burrow/surprise-room-screen.tsx',{
    "./burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
  ...checkout.imports,
  '@/components/ui/screen-overlay':{ScreenOverlay:'Overlay'},
  '@/lib/surprise-preview':{prepareSurprisePreview:async()=>options.preview?options.preview():'portrait.png',releaseSurprisePreview:async()=>{},useSurprisePreview:()=> 'portrait.png'},
  '@/lib/burrow-products':load('apps/mobile/src/lib/burrow-products.ts'),
  '@/lib/partner-pairing':{requirePartner:()=>false},'@/lib/use-partner-entry-gate':{usePartnerEntryGate(){}},
  '@/lib/room-history-entry':{prepareSurpriseHistoryEntry:async()=>options.hasHistory??false},
  '@/lib/burrow-toast':{showBurrowToast:message=>toasts.push(message)},
  '@/lib/insufficient-coins':load('apps/mobile/src/lib/insufficient-coins.ts',{'expo-router':{router:{navigate:href=>navigation.push(href)}}}),
  '@/lib/use-page-back-gesture':{usePageBackGesture:value=>options.gestures?.push(value)},
  './coin-ui':{CoinLabel:'Text'},
  './surprise-composer-ui':{RecordingOrb:'Orb',SurpriseGiftbox:'Giftbox',SurpriseAction:'Action',SurpriseCard:'Card',SURPRISE_CREAM:'#FAF3E5',SURPRISE_INK:'#4A2917'},
  './surprise-audio-resources':{useSurpriseAudioResources:()=>{
   h.react.useEffect(()=>()=>{playerReleased=true;recorderReleased=true;},[]);
   return{player,audio,recorder,recording:recordStatus,resources:null};
  }},
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{ActivityIndicator:'Spinner',Alert:{alert:(...args)=>alerts.push(args)},AppState:app,Linking:{openSettings:async()=>{}},Platform:{OS:'ios'},Pressable:'Pressable',ScrollView:'ScrollView',StyleSheet:{create:x=>x},Text:'Text',View:'View'},
  'expo-router':{router:{back:()=>navigation.push('back'),push:route=>navigation.push(route)},useLocalSearchParams:()=>options.params??{},useFocusEffect:fn=>h.react.useEffect(()=>{focusStart=fn;focusCleanup=fn();return()=>{const cleanup=focusCleanup;focusCleanup=null;cleanup?.();};},[fn])},
  '@react-navigation/native':{usePreventRemove:()=>{}},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},'@expo/vector-icons':{Feather:'Icon'},
  'expo-audio':{AudioModule:{requestRecordingPermissionsAsync:async()=>{nativeCalls.push('permission');return options.requestPermission?options.requestPermission(app):{granted:options.permission!==false};}},RecordingPresets:{HIGH_QUALITY:{}},
   setAudioModeAsync:mode=>{modes.push(mode);if(options.modeSyncThrow)throw Error('Audio mode unavailable');return options.mode?options.mode(mode):Promise.resolve();},
   useAudioPlayer:()=>{h.react.useEffect(()=>()=>{playerReleased=true;},[]);return player;},useAudioPlayerStatus:()=>audio,
   useAudioRecorder:()=>{h.react.useEffect(()=>()=>{recorderReleased=true;},[]);return recorder;},useAudioRecorderState:()=>recordStatus},
  'expo-crypto':{randomUUID:()=> 'new-key-'+(++keys)},'@/lib/burrow-store':{useBurrow:()=>({data}),refreshBurrow:async()=>{}},
  '@/lib/session-lifecycle':{sessionEpoch:()=>1,subscribeSessionIdentity:fn=>{identity=fn;return()=>{};}},'@/lib/surprise-api':api,
  '@/lib/surprise-inbox':{useSurpriseInbox:()=>options.items??[],refreshSurpriseInbox:async()=>{},markSurpriseOpened:()=>{}},
  '@/shared/storage/artifacts':{deleteSurpriseDraftFiles:async()=>{}},'./burrow-music':{acquireBurrowAudioFocus:()=>()=>{focusReleases++;}},
  '@/lib/surprise-send-queue':{useSurpriseOutbox:()=>outbox,enqueueSurprise:draft=>{let job=outbox.find(j=>j.draft.key===draft.key);if(!job){job={draft,state:'queued'};outbox.push(job);}void queueSend(job);},retrySurpriseSend:key=>void queueSend(outbox.find(j=>j.draft.key===key)),surpriseSendFailure:job=>job.error,canEditRejectedSurprise:job=>job.state==='failed'&&job.failureStage==='send',reviseRejectedSurprise:key=>{const index=outbox.findIndex(j=>j.draft.key===key);if(index<0)return null;return{...outbox.splice(index,1)[0].draft,key:'revised-key',locked:false};}},
  '@/lib/surprise-preparation':{acquirePreparedSurpriseAudio:()=>options.lease,preparedSurprise:()=>options.prepared,prepareSurprise:async(_scope,item)=>({item,media:await api.loadSurpriseMedia()}),inspectSurpriseAudio:async()=>options.fileDuration??recordStatus.durationMillis??12000},
  '@/lib/surprise-media-cache':{pinSurpriseMedia:()=>()=>{}},
  './surprise-art':{SurprisePortrait:'Portrait'},'./surprise-camera':{SurpriseCamera:'Camera'},'./surprise-rain':{SurpriseRain:'Rain'},
  './surprise-playback-overlay':{SurprisePlaybackOverlay:'PlaybackOverlay',SurprisePlaybackSurface:'PlaybackSurface',SURPRISE_PLAYBACK_SCRIM:'rgba(0,0,0,0.5)'},
  './surprise-history':{SurpriseHistory:'History'},
  './surprise-frame-picker':{SurpriseFramePicker:'FramePicker'},
  '@/lib/surprise-frame-assets':{SURPRISE_FRAME_OPTIONS:Object.keys(require('../apps/mobile/src/lib/surprise-frame-geometry.json')).map(id=>({id})),surpriseFrameName:id=>id[0].toUpperCase()+id.slice(1)},
 },{Date,setTimeout:options.timers?.setTimeout??setTimeout,clearTimeout:options.timers?.clearTimeout??clearTimeout});
 const render=()=>h.render(()=>{const root=module.SurpriseRoomScreen(),tree=root.type(root.props);return tree.type===undefined&&Array.isArray(tree.props?.children)?tree.props.children.at(-1):tree;});
 const find=(tree,predicate)=>nodes(tree).find(predicate);
 const title=(tree,value)=>find(tree,node=>node.props?.title===value||(node.type==='Pressable'&&nodes(node.props?.children).some(child=>child.type==='Text'&&child.props?.children===value)));
 const action=(tree,label)=>find(tree,node=>node.props?.accessibilityLabel===label);
 const recordAction=(tree,label)=>{if(!action(tree,label)&&title(tree,'Retake photo')){title(tree,'Continue').props.onPress();tree=render();}return action(tree,label);};
 const discard=()=>{const count=alerts.length;for(let i=0;i<5&&alerts.length===count;i++){const tree=render(),camera=find(tree,n=>n.type==='Camera');if(camera)camera.props.onBack();else action(tree,'Back').props.onPress();}};
 return {h,render,find,title,action,recordAction,discard,writes,sends,alerts,opened,navigation,audio,player,recorder,app,nativeCalls,modes,checkout,data,released,toasts,outbox,retry:()=>queueSend(outbox[0]),
  statusFailure:value=>{statusFails=value;},stopFailure:value=>{stopFails=value;},focusReleases:()=>focusReleases,
  blur:()=>{const cleanup=focusCleanup;focusCleanup=null;cleanup?.();},focus:()=>{focusCleanup=focusStart();},
  duration:ms=>{recordStatus={...recordStatus,durationMillis:ms};},appState,background:()=>appState('background'),signOut:()=>identity()};
}
test('Surprise uses the full shared back button and equally-sized header actions in selection and preview',()=>{
 for(const draft of [{},{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000}]){
  const h=harness({draft}),tree=h.render(),back=h.action(tree,'Back');
  assert.equal(back.type,'BackButton');assert.equal(back.props.light,!draft.photoUri);assert.equal(back.props.style,undefined);
  const header=nodes(tree).find(n=>Array.isArray(n.props?.children)&&n.props.children.includes(back));
  const right=header.props.children.at(-1);assert.equal(right.props.style.width,44);assert.equal(right.props.style.height,44);
  h.h.unmount();
 }
});
test('36 bundled frame choices proceed to frozen photo and voice, then priced preview',async()=>{
 const h=harness();let tree=h.render();assert.equal(nodes(tree).filter(node=>/ frame$/.test(node.props?.accessibilityLabel??'')).length,36);
 h.title(tree,'Use This Frame').props.onPress();tree=h.render();await h.find(tree,node=>node.type==='Camera').props.onDone('cropped.jpg');
 tree=h.render();assert.ok(h.title(tree,'Retake photo'));h.title(tree,'Continue').props.onPress();tree=h.render();h.recordAction(tree,'Start recording').props.onPress();await flush();tree=h.render();h.duration(12000);tree=h.render();
 h.action(tree,'Stop recording').props.onPress();await flush();tree=h.render();assert.ok(h.title(tree,'Record again'));h.title(tree,'Continue').props.onPress();tree=h.render();assert.ok(h.title(tree,'Send the surprise'));assert.equal(h.sends.length,0);assert.equal(h.writes.at(-1).durationMs,12000);assert.ok(h.writes.at(-1).audioUri.startsWith('private/'));h.h.unmount();
});
test('only Surprise root screens can edge-pop; camera/voice creation use their internal Back steps',async()=>{
 const gestures=[],h=harness({gestures});let tree=h.render();assert.equal(gestures.at(-1),true);
 h.title(tree,'Use This Frame').props.onPress();tree=h.render();assert.equal(gestures.at(-1),false);
 h.find(tree,n=>n.type==='Camera').props.onBack();tree=h.render();assert.equal(gestures.at(-1),true);
 h.title(tree,'Use This Frame').props.onPress();tree=h.render();
 await h.find(tree,n=>n.type==='Camera').props.onDone('face.jpg');tree=h.render();assert.equal(gestures.at(-1),false);
 h.discard();h.alerts.at(-1)[2].find(b=>b.text==='Discard').onPress();h.render();assert.equal(gestures.at(-1),true);h.h.unmount();
});
for(const cancel of ['back','unmount','account'])test(`late photo persistence cannot reopen recording after ${cancel}`,async()=>{
 const saved=deferred(),h=harness({keepPhoto:()=>saved.promise});let tree=h.render();
 h.title(tree,'Use This Frame').props.onPress();tree=h.render();const camera=h.find(tree,node=>node.type==='Camera');
 const pending=camera.props.onDone('cropped.jpg');
 if(cancel==='back')camera.props.onBack();else if(cancel==='unmount')h.h.unmount();else h.signOut();
 saved.resolve('private/cropped.jpg');await pending;await flush();assert.equal(h.writes.length,0);
 if(cancel==='back'){tree=h.render();assert.ok(h.title(tree,'Use This Frame'));assert.equal(h.recordAction(tree,'Start recording'),undefined);}
 if(cancel!=='unmount')h.h.unmount();
});
test('optimistic send responds immediately; retry preserves exact key and cannot reopen the success card after Done',async()=>{
 let attempts=0;const h=harness({draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000},send:async()=>{if(++attempts===1)throw Error('timeout');return{id:'receipt'};}});
 let tree=h.render();h.title(tree,'Send the surprise').props.onPress();tree=h.render();assert.ok(h.title(tree,'Done'));await flush();tree=h.render();assert.equal(h.outbox[0].state,'failed');assert.equal(h.writes.at(-1).locked,true);
 h.title(tree,'Done').props.onPress();await h.retry();await flush();tree=h.render();assert.ok(h.title(tree,'Use This Frame'));assert.equal(h.title(tree,'Done'),undefined);assert.deepEqual(h.sends[0],h.sends[1]);h.h.unmount();
 assert.equal(h.checkout.offers.length,0,'explicit priced Send is the authorization');
});
test('Send immediately acknowledges durable intent without an extra checkout or network wait; rapid stale taps send only once',async()=>{
 const pending=deferred(),h=harness({manual:true,draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000},send:()=>pending.promise});
 const button=h.title(h.render(),'Send the surprise');button.props.onPress();button.props.onPress();
 assert.equal(h.checkout.offers.length,0);assert.equal(h.sends.length,1);assert.ok(h.title(h.render(),'Done'));
 assert.equal(h.sends[0].deliveryVersion,1);h.title(h.render(),'Done').props.onPress();assert.ok(h.title(h.render(),'Use This Frame'));
 pending.resolve({id:'sent'});await flush();h.render();assert.equal(h.title(h.render(),'Done'),undefined);h.h.unmount();
});
test('recipient downloads on Receive, acknowledges only after playing, and pauses on background',async()=>{
 const item={id:'surprise-id',sender_id:B,recipient_id:A,frame:'heart',duration_ms:12000,opened_at:null};
 const h=harness({items:[item],params:{id:item.id,receive:'1'}});h.audio.isLoaded=false;h.render();await flush();let tree=h.render();assert.ok(h.find(tree,node=>node.type==='Rain'));assert.equal(h.opened.length,0);
 h.audio.isLoaded=true;tree=h.render();await flush();tree=h.render();assert.equal(h.opened[0],item.id);assert.equal(h.audio.playing,true);h.background();assert.equal(h.audio.playing,false);h.h.unmount();
});
test('prepared Home receive paints playback on its first render and starts audio without another Receive tap',async()=>{
 const item={id:'warm-gift',sender_id:B,recipient_id:A,frame:'heart',duration_ms:12000,opened_at:null};
 const h=harness({params:{id:item.id,receive:'1'},prepared:{item,media:{photoUrl:'local-face.jpg',audioUrl:'local-voice.m4a',portraitUri:'local-composite.png'}},media:()=>{throw Error('Must not download again');}});
 let tree=h.render();assert.equal(tree.type,'PlaybackSurface');assert.equal(tree.props.showRain,true);assert.equal(tree.props.portraitUri,'local-composite.png');
 await flush();tree=h.render();assert.equal(h.audio.playing,true);assert.deepEqual(h.nativeCalls,['play']);assert.equal(h.opened.length,1);h.h.unmount();
});
test('the small playback orb resumes an interrupted received message without restarting its rain or recording a second open',async()=>{
 const item={id:'warm-gift',sender_id:B,recipient_id:A,frame:'heart',duration_ms:12000,opened_at:null};
 const h=harness({params:{id:item.id,receive:'1'},prepared:{item,media:{photoUrl:'local-face.jpg',audioUrl:'local-voice.m4a'}}});
 h.render();await flush();h.render();await flush();h.render();h.audio.currentTime=3;h.background();h.appState('active');let tree=h.render();
 assert.equal(h.audio.playing,false);const session=tree.props.session;h.action(tree,'Resume surprise').props.onPress();tree=h.render();assert.equal(h.audio.playing,true);assert.equal(tree.props.session,session);assert.equal(h.opened.length,1);h.h.unmount();
});
test('replay at EOF seeks to zero on the current player; rapid Replay taps start only one animation/audio session',async()=>{
 const item={id:'warm-gift',sender_id:B,recipient_id:A,frame:'heart',duration_ms:12000,opened_at:null};
 const h=harness({params:{id:item.id,receive:'1'},prepared:{item,media:{photoUrl:'face',audioUrl:'audio'}}});h.render();await flush();h.render();
 h.audio.playing=false;h.audio.currentTime=12;h.audio.didJustFinish=true;h.render();let tree=h.render();
 const tap=h.title(tree,'Replay').props.onPress;tap();tap();await flush();h.render();await flush();tree=h.render();
 assert.equal(h.audio.currentTime,0);assert.equal(h.audio.playing,true);assert.equal(h.nativeCalls.filter(x=>x==='seek:0').length,1);assert.equal(h.nativeCalls.filter(x=>x==='play').length,2);assert.equal(h.opened.length,1);h.h.unmount();
});
for(const stage of ['mode','seek'])test('background and foreground cannot revive a cancelled playback startup during '+stage,async()=>{
 const pending=deferred(),h=harness({draft:{photoUri:'face',audioUri:'audio',durationMs:12000},...(stage==='mode'?{mode:()=>pending.promise}:{seek:()=>pending.promise})});
 if(stage==='seek')h.audio.currentTime=3;
 h.action(h.render(),'Preview Surprise').props.onPress();await flush();h.render();await flush();
 h.background();h.appState('active');pending.resolve();await flush();h.render();await flush();
 assert.equal(h.audio.playing,false);assert.equal(h.nativeCalls.filter(x=>x==='play').length,0);h.h.unmount();
});
test('mic permission denial keeps photo and never records or charges',async()=>{
 const h=harness({draft:{photoUri:'face.jpg'},permission:false});let tree=h.render();h.recordAction(tree,'Start recording').props.onPress();await flush();tree=h.render();assert.ok(h.recordAction(tree,'Start recording'));assert.equal(h.sends.length,0);assert.equal(h.alerts[0][0],'Microphone access needed');h.h.unmount();
});
test('granting microphone permission while iOS is inactive automatically starts once on returning active, without a second tap',async()=>{
 const timer=clock(),permission=deferred(),h=harness({draft:{photoUri:'face.jpg'},timers:timer.globals,requestPermission:()=>permission.promise});
 let tree=h.render();const start=h.recordAction(tree,'Start recording').props.onPress;start();h.appState('inactive');permission.resolve({granted:true});await flush();
 assert.equal(h.nativeCalls.includes('prepare'),false);start();await flush();assert.equal(h.nativeCalls.filter(x=>x==='permission').length,1);
 h.appState('active');await flush();tree=h.render();assert.ok(h.action(tree,'Stop recording'));
 assert.equal(h.nativeCalls.filter(x=>x==='record').length,1);assert.equal(timer.timers.size,0);
 h.appState('active');await flush();assert.equal(h.nativeCalls.filter(x=>x==='record').length,1);h.h.unmount();await flush();
});
for(const cancel of ['background','blur','unmount','account','timeout'])test(`microphone grant never starts a pending recording after ${cancel}`,async()=>{
 const timer=clock(),permission=deferred(),h=harness({draft:{photoUri:'face.jpg'},timers:timer.globals,requestPermission:()=>permission.promise});
 let tree=h.render();h.recordAction(tree,'Start recording').props.onPress();h.appState('inactive');permission.resolve({granted:true});await flush();
 if(cancel==='background')h.background();else if(cancel==='blur'){h.blur();h.focus();}else if(cancel==='unmount')h.h.unmount();else if(cancel==='account')h.signOut();else timer.advance(5000);
 h.appState('active');await flush();assert.equal(h.nativeCalls.includes('record'),false);assert.equal(h.nativeCalls.includes('prepare'),false);assert.equal(timer.timers.size,0);
 if(cancel!=='unmount')h.h.unmount();await flush();
});
test('backgrounding before permission resolves cannot later start a hidden recording',async()=>{
 const permission=deferred(),h=harness({draft:{photoUri:'face.jpg'},requestPermission:()=>permission.promise});let tree=h.render();
 h.recordAction(tree,'Start recording').props.onPress();h.background();h.appState('active');permission.resolve({granted:true});await flush();
 assert.equal(h.nativeCalls.includes('record'),false);h.h.unmount();await flush();
});
test('microphone foreground timeout releases the lock so a fresh explicit tap can record',async()=>{
 const timer=clock(),h=harness({draft:{photoUri:'face.jpg'},timers:timer.globals});let tree=h.render();
 h.recordAction(tree,'Start recording').props.onPress();h.appState('inactive');await flush();timer.advance(5000);await flush();h.appState('active');tree=h.render();
 h.recordAction(tree,'Start recording').props.onPress();await flush();assert.equal(h.nativeCalls.filter(x=>x==='record').length,1);h.h.unmount();await flush();
});
test('a confirmed sent draft reopens at frame selection, never a stale Sent page or a new paid send',()=>{const h=harness({draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000,locked:true,sentId:'receipt'}});const tree=h.render();assert.ok(h.title(tree,'Use This Frame'));assert.equal(h.title(tree,'Retry send · {coin} 300'),undefined);assert.equal(h.sends.length,0);h.h.unmount();});

test('unmount after Expo releases native objects never reads recorder status or throws',async()=>{
 const h=harness();h.render();assert.doesNotThrow(()=>h.h.unmount());await flush();
 assert.equal(h.nativeCalls.includes('getStatus'),false);assert.equal(h.nativeCalls.includes('stop'),false);
 assert.equal(h.focusReleases(),0);assert.equal(h.modes.length,0,'silent browsing does not configure the system audio session');
});
test('active recording unmount tolerates a synchronous native stop exception and releases audio focus',async()=>{
 const h=harness({draft:{photoUri:'face.jpg'}});let tree=h.render();h.recordAction(tree,'Start recording').props.onPress();await flush();
 assert.ok(h.nativeCalls.includes('record'));assert.doesNotThrow(()=>h.h.unmount());await flush();
 assert.ok(h.nativeCalls.includes('stop'));assert.equal(h.nativeCalls.includes('getStatus'),false);
 assert.equal(h.focusReleases(),1);assert.equal(h.modes.at(-1).allowsRecording,false);assert.equal(h.writes.length,0);
});
test('blur handles rejected stop promises without an unhandled rejection or stranded audio focus',async()=>{
 const h=harness({draft:{photoUri:'face.jpg'},stopReject:true});let tree=h.render();h.recordAction(tree,'Start recording').props.onPress();await flush();
 h.blur();await flush();assert.equal(h.focusReleases(),1);assert.equal(h.nativeCalls.includes('getStatus'),false);
 h.h.unmount();await flush();assert.equal(h.focusReleases(),1);
});
test('silent browsing does not touch an unavailable audio session during teardown',async()=>{
 const h=harness({modeSyncThrow:true});h.render();assert.doesNotThrow(()=>h.h.unmount());await flush();assert.equal(h.focusReleases(),0);assert.equal(h.modes.length,0);
});
test('native status failure while saving stays inside try/finally and unlocks a new recording',async()=>{
 const h=harness({draft:{photoUri:'face.jpg'}});let tree=h.render();h.recordAction(tree,'Start recording').props.onPress();await flush();h.duration(12000);tree=h.render();
 h.statusFailure(true);assert.doesNotThrow(()=>h.action(tree,'Stop recording').props.onPress());await flush();tree=h.render();
 assert.ok(nodes(tree).some(n=>n.props?.children==='Recording could not be saved. Please record again.'));
 assert.equal(h.recordAction(tree,'Start recording').props.disabled,false);assert.equal(h.writes.length,0);
 h.statusFailure(false);h.recordAction(tree,'Start recording').props.onPress();await flush();assert.equal(h.nativeCalls.filter(x=>x==='record').length,2);h.h.unmount();await flush();
});
test('failed native stop remains retryable and cannot save an incomplete recording',async()=>{
 const h=harness({draft:{photoUri:'face.jpg'},stopReject:true});let tree=h.render();h.recordAction(tree,'Start recording').props.onPress();await flush();h.duration(12000);tree=h.render();
 h.action(tree,'Stop recording').props.onPress();await flush();tree=h.render();assert.equal(h.action(tree,'Stop recording').props.disabled,false);assert.equal(h.writes.length,0);
 h.stopFailure(false);h.action(tree,'Stop recording').props.onPress();await flush();tree=h.render();
 assert.ok(h.title(tree,'Record again'));assert.equal(h.writes.at(-1).durationMs,12000);h.h.unmount();await flush();
});
test('late recorder preparation cannot start after blur and refocus',async()=>{
 const preparing=deferred(),h=harness({draft:{photoUri:'face.jpg'},prepare:preparing.promise});let tree=h.render();h.recordAction(tree,'Start recording').props.onPress();await flush();
 assert.ok(h.nativeCalls.includes('prepare'));h.blur();h.focus();preparing.resolve();await flush();
 assert.equal(h.nativeCalls.includes('record'),false);assert.equal(h.writes.length,0);h.h.unmount();await flush();
});

test('recorded preview plays the complete clip beyond three seconds and returns to checkout only at audio EOF',async()=>{
 const timer=clock(),h=harness({timers:timer.globals,draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000}});
 let tree=h.render();h.action(tree,'Preview Surprise').props.onPress();await flush();h.render();await flush();let tree2=h.render();tree=tree2;
 assert.equal(h.find(tree,node=>node.type==='PlaybackOverlay').props.playing,true);
 timer.advance(3001);tree=h.render();assert.ok(h.action(tree,'Close surprise'));assert.equal(h.audio.playing,true);
 h.audio.playing=false;h.audio.didJustFinish=true;h.render();tree=h.render();assert.equal(h.action(tree,'Close surprise'),undefined);assert.ok(h.action(tree,'Preview Surprise'));h.h.unmount();
});
test('discard confirmation keeps media on No, deletes photo/audio on Yes, and returns to frame selection',async()=>{
 const h=harness({draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000}});
 h.discard();assert.equal(h.alerts.length,1);assert.equal(h.released.length,0);
 h.alerts[0][2].find(b=>b.style==='cancel').onPress();assert.ok(h.title(h.render(),'Record again'));assert.equal(h.writes.length,0);
 h.discard();h.alerts.at(-1)[2].find(b=>b.text==='Discard').onPress();await flush();
 assert.ok(h.title(h.render(),'Use This Frame'));assert.deepEqual(h.released,['face.jpg','voice.m4a']);assert.equal(h.sends.length,0);assert.deepEqual(h.navigation,[]);h.h.unmount();
});
test('photo confirmation Back prompts once about the photo only; Keep stays and Discard goes straight to selection, not camera',()=>{
 const h=harness({draft:{photoUri:'face.jpg'}});let tree=h.render();assert.ok(h.title(tree,'Retake photo'));
 h.action(tree,'Back').props.onPress();h.action(tree,'Back').props.onPress();assert.equal(h.alerts.length,1);
 assert.equal(h.alerts[0][0],'Discard this surprise?');assert.equal(h.alerts[0][1],'Your photo will not be saved.');
 h.alerts[0][2].find(b=>b.text==='Keep editing').onPress();tree=h.render();assert.ok(h.title(tree,'Retake photo'));assert.equal(h.released.length,0);
 h.action(tree,'Back').props.onPress();h.alerts.at(-1)[2].find(b=>b.text==='Discard').onPress();tree=h.render();
 assert.ok(h.title(tree,'Use This Frame'));assert.equal(h.find(tree,n=>n.type==='Camera'),undefined);assert.deepEqual(h.navigation,[]);
 assert.equal(h.writes.at(-1).photoUri,undefined);assert.equal(h.released.includes('face.jpg'),true);h.h.unmount();
});
for(const active of [false,true])test(`Record a message Back confirms at that page, including active recording (${active})`,async()=>{
 const h=harness({draft:{photoUri:'face.jpg'}});h.title(h.render(),'Continue').props.onPress();let tree=h.render();
 if(active){h.action(tree,'Start recording').props.onPress();await flush();tree=h.render();}
 h.action(tree,'Back').props.onPress();assert.equal(h.alerts.length,1);assert.match(h.alerts[0][1],/photo and voice recording/);
 h.alerts[0][2].find(b=>b.text==='Keep editing').onPress();tree=h.render();
 assert.ok(h.action(tree,active?'Stop recording':'Start recording'));assert.equal(h.nativeCalls.filter(x=>x==='stop').length,0);
 h.action(tree,'Back').props.onPress();h.alerts.at(-1)[2].find(b=>b.text==='Discard').onPress();tree=h.render();
 assert.ok(h.title(tree,'Use This Frame'));assert.equal(h.find(tree,n=>n.type==='Camera'),undefined);assert.equal(h.sends.length,0);
 await flush();if(active)assert.ok(h.nativeCalls.includes('stop'));assert.equal(h.writes.at(-1).audioUri,undefined);h.h.unmount();
});
test('discard while microphone permission is pending cannot later start recording or return to the abandoned page',async()=>{
 const permission=deferred(),h=harness({draft:{photoUri:'face.jpg'},requestPermission:()=>permission.promise});
 h.title(h.render(),'Continue').props.onPress();h.action(h.render(),'Start recording').props.onPress();
 h.action(h.render(),'Back').props.onPress();h.alerts.at(-1)[2].find(b=>b.text==='Discard').onPress();assert.ok(h.title(h.render(),'Use This Frame'));
 permission.resolve({granted:true});await flush();assert.equal(h.nativeCalls.includes('record'),false);
 assert.ok(h.title(h.render(),'Use This Frame'));h.h.unmount();
});
test('Oops preserves the draft across coin-shop focus changes; after top-up Send responds immediately without extra confirmation',async()=>{
 const h=harness({manual:true,balance:100,draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000}});
 h.title(h.render(),'Send the surprise').props.onPress();await flush();assert.deepEqual(h.navigation,['/(main)/insufficient-coins']);assert.equal(h.checkout.offers.length,0);
 h.blur();h.data.wallet.balance=600;h.focus();assert.ok(h.action(h.render(),'Preview Surprise'));
 h.title(h.render(),'Send the surprise').props.onPress();assert.equal(h.checkout.offers.length,0);assert.equal(h.sends.length,1);
 const tree=h.render();assert.ok(h.title(tree,'Done'));h.title(tree,'Done').props.onPress();assert.ok(h.title(h.render(),'Use This Frame'));assert.equal(h.writes.at(-1).photoUri,undefined);h.h.unmount();
});
test('definitive server insufficient balance returns the immutable rejected draft to checkout and reuses Oops',async()=>{
 const h=harness({draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000},send:async()=>{throw{status:400,body:{error:'insufficient_balance'}};}});
 h.title(h.render(),'Send the surprise').props.onPress();await flush();h.render();const tree=h.render();
 assert.deepEqual(h.navigation,['/(main)/insufficient-coins']);assert.ok(h.title(tree,'Send the surprise'));assert.equal(h.sends.length,1);assert.equal(h.released.length,0);h.h.unmount();
});
test('recipient rain is audio-driven, never stopped by the three-second demo timer',async()=>{
 const timer=clock(),item={id:'surprise-id',sender_id:B,recipient_id:A,frame:'heart',duration_ms:12000,opened_at:null};
 const h=harness({timers:timer.globals,items:[item],params:{id:item.id,receive:'1'}});h.render();await flush();h.render();await flush();let tree=h.render();
 timer.advance(3000);tree=h.render();assert.equal(h.find(tree,node=>node.type==='Rain').props.playing,true);assert.equal(h.find(tree,node=>node.type==='Rain').props.transparent,true);
 h.audio.didJustFinish=true;tree=h.render();tree=h.render();assert.ok(h.title(tree,'Replay'));h.h.unmount();
});
test('recorded preview keeps the original composer under its rain overlay, then closes without changing/charging the draft',async()=>{
  const h=harness({draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000}});
  h.action(h.render(),'Preview Surprise').props.onPress();await flush();h.render();let tree=h.render();
  assert.ok(h.find(tree,n=>n.type==='PlaybackOverlay'));
  assert.ok(nodes(tree).some(n=>n.type==='View'&&n.props.importantForAccessibility==='no-hide-descendants'));
  assert.ok(h.title(tree,'Send the surprise'),'real original preview remains below');
  h.action(tree,'Close surprise').props.onPress();tree=h.render();
  assert.equal(h.find(tree,n=>n.type==='PlaybackOverlay'),undefined);assert.equal(h.audio.playing,false);
  assert.ok(h.title(tree,'Send the surprise'));assert.equal(h.writes.length,0);assert.equal(h.sends.length,0);h.h.unmount();
});
test('Home receive never paints a brown composer or leaks the sender draft during loading, playing or replay',async()=>{
  const pending=deferred(),item={id:'surprise-id',sender_id:B,recipient_id:A,frame:'heart',duration_ms:12000,opened_at:null};
  const h=harness({items:[item],params:{id:item.id,receive:'1'},media:()=>pending.promise,
    draft:{photoUri:'my-own-draft.jpg',audioUri:'my-own-voice.m4a',durationMs:12000}});
  let tree=h.render();assert.equal(tree.type,'PlaybackSurface');assert.equal(tree.props.showRain,false);
  assert.equal(tree.props.uri,undefined);assert.equal(h.find(tree,n=>n.type==='FramePicker'),undefined);
  assert.equal(h.audio.playing,false);h.render();
  pending.resolve({photoUrl:'received-face.jpg',audioUrl:'received-voice.m4a'});await flush();h.render();await flush();tree=h.render();
  assert.equal(tree.type,'PlaybackSurface');assert.equal(tree.props.uri,'received-face.jpg');assert.equal(tree.props.playing,true);
  h.audio.didJustFinish=true;h.render();tree=h.render();assert.equal(tree.type,'PlaybackSurface');assert.ok(h.title(tree,'Replay'));
  h.action(tree,'Close surprise').props.onPress();assert.deepEqual(h.navigation,['back']);assert.equal(h.audio.playing,false);h.h.unmount();
});
test('closing Home surprise during pending media stops future autoplay and never changes the draft',async()=>{
  const pending=deferred(),item={id:'surprise-id',sender_id:B,recipient_id:A,frame:'heart',duration_ms:12000,opened_at:null};
  const h=harness({items:[item],params:{id:item.id,receive:'1'},media:()=>pending.promise});
  let tree=h.render();h.render();h.action(tree,'Close surprise').props.onPress();assert.deepEqual(h.navigation,['back']);h.blur();
  pending.resolve({photoUrl:'late-face.jpg',audioUrl:'late-voice.m4a'});await flush();tree=h.render();
  assert.equal(tree.props.showRain,false);assert.equal(h.audio.playing,false);assert.equal(h.opened.length,0);assert.equal(h.writes.length,0);h.h.unmount();
});
test('history has its own top-right entry and replay returns to history, not the create flow',async()=>{
 const entry=harness({hasHistory:true});entry.action(entry.render(),'Surprise history').props.onPress();await flush();
 assert.equal(entry.navigation[0].params.history,'1');entry.h.unmount();
 const h=harness({params:{history:'1'}});let tree=h.render();
 const history=h.find(tree,node=>node.type==='History');assert.ok(history);
 history.props.onSelect({id:'surprise-id',sender_id:B,recipient_id:A,frame:'santa',duration_ms:12000});await flush();tree=h.render();
 assert.ok(h.title(tree,'Replay'));h.action(tree,'Close surprise').props.onPress();tree=h.render();assert.ok(h.find(tree,node=>node.type==='History'));h.h.unmount();
});
test('back during cold history preparation releases its lock so the same row remains playable on a later visit',async()=>{
 const pending=deferred(),item={id:'cold-gift',sender_id:B,recipient_id:A,frame:'santa',duration_ms:12000},h=harness({params:{history:'1'},media:()=>pending.promise});
 let tree=h.render();h.find(tree,n=>n.type==='History').props.onSelect(item);h.render();
 h.action(h.render(),'Back').props.onPress();h.blur();h.focus();tree=h.render();
 h.find(tree,n=>n.type==='History').props.onSelect(item);pending.resolve({photoUrl:'face',audioUrl:'voice'});await flush();h.render();await flush();tree=h.render();
 assert.ok(h.action(tree,'Close surprise'));assert.equal(h.audio.playing,true);h.h.unmount();
});
test('empty Surprise history does not navigate and shows the shared toast',async()=>{
 const h=harness();h.action(h.render(),'Surprise history').props.onPress();await flush();
 assert.deepEqual(h.navigation,[]);assert.deepEqual(h.toasts,['No history yet']);h.h.unmount();
});
test('changing the frame discards the mismatched photo and requires a new aligned photo',()=>{
 const h=harness({draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000}});let tree=h.render();
 h.discard();h.alerts.at(-1)[2].find(b=>b.text==='Discard').onPress();tree=h.render();
 h.action(tree,'Pumpkin frame').props.onPress();tree=h.render();assert.equal(h.writes.at(-1).photoUri,undefined);
 h.title(tree,'Use This Frame').props.onPress();tree=h.render();assert.ok(h.find(tree,node=>node.type==='Camera'));h.h.unmount();
});

test('rapid taps cannot start a second microphone session before recorder state catches up',async()=>{
 const h=harness({draft:{photoUri:'face.jpg'}});let tree=h.render();const start=h.recordAction(tree,'Start recording').props.onPress;
 start();await flush();start();await flush();assert.equal(h.nativeCalls.filter(call=>call==='record').length,1);h.h.unmount();await flush();
});
test('Surprise low balance opens Oops before uploads, leaving the photo and voice draft intact',async()=>{
 const h=harness({balance:299,draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000}}),tree=h.render();
 h.title(tree,'Send the surprise').props.onPress();await flush();
 assert.deepEqual(h.navigation,['/(main)/insufficient-coins']);assert.equal(h.sends.length,0);assert.equal(h.writes.length,0);
 assert.ok(h.title(h.render(),'Send the surprise'));h.h.unmount();
});
test('background balance rejection stays a saved failed job, without forcing navigation or changing its retry key',async()=>{
 const h=harness({draft:{photoUri:'face.jpg',audioUri:'voice.m4a',durationMs:12000},send:async()=>{throw {body:{error:'insufficient_balance'}};}});
 h.title(h.render(),'Send the surprise').props.onPress();await flush();const tree=h.render();
 assert.deepEqual(h.navigation,[]);assert.equal(h.outbox[0].state,'failed');assert.ok(h.title(tree,'Done'));
 assert.equal(h.writes.at(-1).key,'fixed-key');assert.equal(h.writes.at(-1).photoUri,'face.jpg');assert.equal(h.writes.at(-1).audioUri,'voice.m4a');h.h.unmount();
});
