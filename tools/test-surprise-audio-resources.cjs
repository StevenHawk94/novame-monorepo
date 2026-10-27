const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props,key)=>({type,props,key});
function harness(options={}){
 const owner=hooks(),slots=new Map(),calls={players:[],recorders:0,polls:0,releases:0},status={isLoaded:true,playing:false,currentTime:0,duration:12};
 let active,finished=0;const recorder={prepareToRecordAsync:async()=>{},record(){},stop:()=>options.stop?.()??Promise.resolve(),getStatus:()=>({isRecording:false,durationMillis:0}),uri:'record.m4a'};
 const api=load('apps/mobile/src/components/burrow/surprise-audio-resources.tsx',{
  react:owner.react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'expo-audio':{RecordingPresets:{HIGH_QUALITY:{}},
   useAudioRecorder:(_options,listener)=>{active.react.useMemo(()=>{calls.recorders++;return null;},[]);active.react.useEffect(()=>()=>calls.releases++,[]);recorder.finish=()=>listener({isFinished:true});return recorder;},
   useAudioRecorderState:()=>{calls.polls++;return{isRecording:false,durationMillis:0};},
   useAudioPlayer:source=>active.react.useMemo(()=>{calls.players.push(source);return{id:source,pause(){}};},[]),
   useAudioPlayerStatus:()=>status,
  },
 });
 // Small React-lifetime driver: resource components have independent hook
 // slots and unmount before a replacement mounts, as on native React.
 function remove(path){for(const [key,slot] of [...slots].reverse())if(key===path||key.startsWith(path+'/')){slot.h.unmount();slots.delete(key);}}
 function host(node,path){
  if(!node){remove(path);return;}
  const old=slots.get(path),signature=node.type.name+':'+(node.key??'');
  if(old&&old.signature!==signature)remove(path);
  const slot=slots.get(path)??{h:hooks(),signature};slots.set(path,slot);active=slot.h;
  // Exported hook shares owner hooks; resource components need their own.
  const previous=Object.assign({},owner.react);Object.assign(owner.react,slot.h.react);
  let child;try{child=slot.h.render(()=>node.type(node.props));}finally{Object.assign(owner.react,previous);}
  if(child&&typeof child.type==='function')host(child,path+'/child');else remove(path+'/child');
 }
 const render=(recording=false,source=null,lease)=>{
  const value=owner.render(()=>api.useSurpriseAudioResources(recording,source,lease,()=>finished++));
  const [record,player]=value.resources.props.children;host(record,'record');host(player,'player');return value;
 };
 return{render,calls,status,recorder,finished:()=>finished,unmount(){owner.unmount();remove('record');remove('player');}};
}
test('frame selection/history create zero native audio objects and zero recorder polls',()=>{
 const h=harness();for(let i=0;i<8;i++){const value=h.render();assert.equal(value.player,null);assert.equal(value.recording.isRecording,false);}
 assert.equal(h.calls.recorders,0);assert.equal(h.calls.polls,0);assert.equal(h.calls.players.length,0);h.unmount();
});
test('recorder has a stage-local lifetime and keeps the native finish callback; leaving stops polling',()=>{
 const h=harness();h.render();h.render(true);let value=h.render(true);assert.equal(h.calls.recorders,1);
 assert.equal(value.recorder.uri,'record.m4a');h.recorder.finish();assert.equal(h.finished(),1);
 h.render(false);const polls=h.calls.polls;h.render(false);assert.equal(h.calls.polls,polls);assert.equal(h.calls.releases,1);
 h.render(true);assert.equal(h.calls.recorders,2);h.unmount();
});
test('prepared receive reuses its existing player, never creates a null-source fallback or recorder',()=>{
 const h=harness(),lease={id:'warm',pause(){}};h.render(false,'warm.m4a',lease);const value=h.render(false,'warm.m4a',lease);
 assert.equal(value.player,lease);assert.equal(value.audio,h.status);assert.equal(h.calls.players.length,0);assert.equal(h.calls.recorders,0);h.unmount();
});
test('source changes cannot expose the previous player or EOF status for even one render',()=>{
 const h=harness();h.render(false,'first');let value=h.render(false,'first');assert.equal(value.player.id,'first');
 value=h.render(false,'second');assert.equal(value.player,null);assert.equal(value.audio.isLoaded,false);
 value=h.render(false,'second');assert.equal(value.player.id,'second');assert.deepEqual(h.calls.players,['first','second']);
 value=h.render(false);assert.equal(value.player,null);assert.equal(value.audio.isLoaded,false);h.unmount();
});
test('native recorder stop is retained across host detach so parent teardown waits before releasing audio focus',async()=>{
 const pending=deferred(),h=harness({stop:()=>pending.promise});const value=h.render(true);h.render(false);
 let stopped=false;const stop=value.recorder.stop().then(()=>{stopped=true;});await flush();assert.equal(stopped,false);
 pending.resolve();await stop;assert.equal(stopped,true);h.unmount();
});
