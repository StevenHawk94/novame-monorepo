const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,deferred,flush,hooks}=require('./lifecycle-test-utils.cjs');
const migration=load('apps/mobile/src/shared/storage/encrypted-migration.ts');
const encryptedId=migration.ENCRYPTED_STORAGE_ID,marker=migration.STORAGE_MIGRATED;
function vaultFixture(initial={}){
 const stores=new Map(),events=[];let key=null,failAt=null;
 const make=(id,values={})=>{
  const map=new Map(Object.entries(values)),store={map,size:16384,getAllKeys:()=>[...map.keys()],getString:k=>typeof map.get(k)==='string'?map.get(k):undefined,
   getBoolean:k=>typeof map.get(k)==='boolean'?map.get(k):undefined,set(k,v){events.push(['set',id,k,typeof v==='string'?v.length:0]);if(failAt===k)throw Error('disk full');map.set(k,v);},clearAll(){events.push(['clear',id]);map.clear();}};
  stores.set(id,store);return store;
 };
 if(Object.keys(initial).length)make('novame-storage',initial);
 const deps={readKey:()=>key,saveKey:k=>{events.push(['key']);key=k;},randomKey:()=> 'a'.repeat(32),exists:id=>stores.has(id),open:(id,k)=>{events.push(['open',id,k]);return stores.get(id)??make(id);},retireLegacy:()=>stores.get('novame-storage').clearAll()};
 return {stores,events,deps,setKey:k=>key=k,fail:k=>failAt=k,open:()=>migration.openEncryptedStorage(deps)};
}
test('encrypted upgrade verifies strings and false boolean flags before committing and removing plaintext',()=>{
 const f=vaultFixture({draft:'private draft',novame_quota_exhausted:false,'burrow_meta_first_reflect_logged:me':true});
 const out=f.open();assert.equal(out.getString('draft'),'private draft');assert.equal(out.getBoolean('novame_quota_exhausted'),false);
 assert.equal(out.getBoolean('burrow_meta_first_reflect_logged:me'),true);assert.equal(out.getString(marker),'1');
 assert.equal(f.stores.get('novame-storage').getAllKeys().length,0);
 assert.ok(f.events.findIndex(e=>e[0]==='key')<f.events.findIndex(e=>e[0]==='open'&&e[1]===encryptedId));
 assert.ok(f.events.findIndex(e=>e[0]==='set'&&e[2]===marker)<f.events.findIndex(e=>e[0]==='clear'));
});
test('disk-full/interrupted migration leaves every original value intact and retries from source',()=>{
 for(const at of ['two',marker]){
  const f=vaultFixture({one:'draft',two:'receipt'});f.fail(at);assert.throws(f.open,/disk full/);
  assert.equal(f.stores.get('novame-storage').getString('two'),'receipt');assert.ok(!f.events.some(e=>e[0]==='clear'));
  f.fail(null);const target=f.open();assert.equal(target.getString('one'),'draft');assert.equal(target.getString('two'),'receipt');
 }
});
test('missing or malformed encryption key never recreates or opens an existing vault',()=>{
 const f=vaultFixture({draft:'saved'});f.open();f.events.length=0;
 f.setKey(null);assert.throws(f.open,/key_unavailable/);assert.equal(f.events.length,0);
 f.setKey('wrong');assert.throws(f.open,/key_invalid/);assert.equal(f.events.length,0);
 f.setKey('a'.repeat(32));assert.equal(f.open().getString('draft'),'saved');
});
test('keychain failure does not create encrypted bytes or erase the old store',()=>{
 const f=vaultFixture({draft:'saved'});f.deps.saveKey=()=>{throw Error('vault locked');};
 assert.throws(f.open,/vault locked/);assert.equal(f.stores.has(encryptedId),false);assert.equal(f.stores.get('novame-storage').getString('draft'),'saved');
});
test('silent vault-write failure cannot create an encrypted store whose key was never saved',()=>{
 const f=vaultFixture({draft:'saved'});f.deps.saveKey=()=>{};
 assert.throws(f.open,/key_not_saved/);assert.equal(f.stores.has(encryptedId),false);assert.equal(f.stores.get('novame-storage').getString('draft'),'saved');
});
test('Android backup excludes the encrypted vault and its non-restorable key without disabling other backups',()=>{
 const app=JSON.parse(fs.readFileSync('apps/mobile/app.json','utf8')).expo;
 const secure=app.plugins.find(x=>Array.isArray(x)&&x[0]==='expo-secure-store');
 assert.equal(secure[1].configureAndroidBackup,false);assert.equal(secure[1].faceIDPermission,false);
 for(const name of ['burrow_storage_backup','burrow_storage_extraction']){
  const xml=fs.readFileSync(`apps/mobile/android/app/src/main/res/xml/${name}.xml`,'utf8');
  assert.match(xml,/<exclude domain="sharedpref" path="SecureStore"/);assert.match(xml,/<exclude domain="file" path="mmkv\/"/);
  assert.match(xml,/<exclude domain="database" path="RKStorage"/);assert.doesNotMatch(xml,/<include/,'other ordinary backup domains are not removed');
 }
 const manifest=fs.readFileSync('apps/mobile/android/app/src/main/AndroidManifest.xml','utf8');
 assert.match(manifest,/android:allowBackup="true"/);assert.match(manifest,/android:fullBackupContent="@xml\/burrow_storage_backup"/);
});
test('failed post-commit plaintext cleanup is retried without overwriting encrypted changes',()=>{
 const f=vaultFixture({draft:'old'}),legacy=f.stores.get('novame-storage'),clear=legacy.clearAll;legacy.clearAll=()=>{throw Error('locked');};
 const target=f.open();target.set('draft','new');legacy.clearAll=clear;
 assert.equal(f.open().getString('draft'),'new');assert.equal(legacy.getAllKeys().length,0);
});
test('migration wipes the old page without destroying a live MMKV handle; file retirement waits for a later startup',()=>{
 const f=vaultFixture({draft:'private saved words'});let retired=0;
 f.deps.retireLegacy=()=>{retired++;f.stores.get('novame-storage').clearAll();};
 f.open();assert.equal(retired,0);assert.ok(f.events.some(e=>e[0]==='set'&&e[2]==='burrow_storage_retired:v1'&&e[3]>16384));
 f.open();assert.equal(retired,1);assert.equal(f.stores.get(encryptedId).getString('draft'),'private saved words');
 const native=fs.readFileSync('apps/mobile/src/shared/storage/mmkv.ts','utf8');
 assert.match(native,/globalThis/);assert.match(native,/!processState\.__burrowLegacyMmkvOpened && !deleteMMKV/);
});
function authFixture(){
 const values=new Map(),legacy=new Map([['session','old-token']]);let blocked=null,failRemove=false;
 const disk={getString:k=>values.get(k),set:(k,v)=>values.set(k,v)};
 const api=load('apps/mobile/src/lib/auth-storage.ts',{'./storage':{storage:disk},'@react-native-async-storage/async-storage':{
  getItem:async k=>blocked?blocked.promise:legacy.get(k)??null,removeItem:async k=>{if(failRemove)throw Error('locked');legacy.delete(k);}
 }}).authStorage;
 return {api,values,legacy,block:()=>blocked=deferred(),fail:value=>failRemove=value};
}
test('auth upgrade migrates large sessions, retries old plaintext cleanup and preserves sign-out tombstones',async()=>{
 const f=authFixture();f.fail(true);assert.equal(await f.api.getItem('session'),'old-token');await flush();
 assert.equal(f.values.get('burrow_auth:session'),'old-token');assert.equal(f.legacy.has('session'),true);
 await f.api.removeItem('session');assert.equal(await f.api.getItem('session'),null);
 f.fail(false);assert.equal(await f.api.getItem('session'),null);await flush();assert.equal(f.legacy.has('session'),false);
 const large='x'.repeat(20000);await f.api.setItem('session',large);assert.equal(await f.api.getItem('session'),large);
});
test('sign-out or token refresh wins over a concurrent legacy session migration',async()=>{
 for(const next of [null,'refreshed']){
  const f=authFixture(),gate=f.block(),old=f.api.getItem('session');
  if(next===null)await f.api.removeItem('session');else await f.api.setItem('session',next);
  gate.resolve('old-token');assert.equal(await old,next);assert.equal(await f.api.getItem('session'),next);
 }
});
test('sound/haptics preferences persist before notification and a failed write never publishes false success',()=>{
 const values=new Map();let fail=false,changes=0;
 const imports={'./storage':{storage:{getString:k=>values.get(k),set:(k,v)=>{if(fail)throw Error('full');values.set(k,v);}}},'../shared/storage/keys':{kInteractionPreferences:{name:'prefs'}}};
 const prefs=load('apps/mobile/src/lib/interaction-preferences.ts',imports);
 prefs.subscribeInteractionPreferences(()=>{throw Error('bad observer');});const unsubscribe=prefs.subscribeInteractionPreferences(()=>changes++);
 prefs.setInteractionPreference('sound',false);assert.equal(changes,1);assert.equal(prefs.getInteractionPreferences().sound,false);
 assert.equal(load('apps/mobile/src/lib/interaction-preferences.ts',imports).getInteractionPreferences().sound,false);
 fail=true;assert.throws(()=>prefs.setInteractionPreference('haptics',false),/full/);assert.equal(prefs.getInteractionPreferences().haptics,true);assert.equal(changes,1);unsubscribe();
});
test('disabled haptics never invoke native code and unsupported-device errors are harmless',async()=>{
 let enabled=false,calls=0;
 const native=()=>{calls++;throw Error('unsupported');};
 const {haptics}=load('apps/mobile/src/lib/haptics.ts',{'./interaction-preferences':{getInteractionPreferences:()=>({haptics:enabled})},
  'expo-haptics':{impactAsync:native,notificationAsync:native,selectionAsync:native,ImpactFeedbackStyle:{},NotificationFeedbackType:{}}});
 await haptics.success();assert.equal(calls,0);enabled=true;await haptics.success();assert.equal(calls,1);
});
test('UI errors hide transport diagnostics but preserve the store adapter’s human recovery guidance',()=>{
 const {userErrorMessage}=load('apps/mobile/src/lib/user-error-message.ts');
 for(const message of ['HTTP 500 https://secret.invalid?token=x','not_a_real_error','[object Object]','Error: SQL failure'])assert.equal(userErrorMessage({message},'Try again.'),'Try again.');
 assert.equal(userErrorMessage({body:{error:'not_paired'}}),'Connect with your partner, then try again.');
 assert.equal(userErrorMessage({message:'Your payment is pending. Please check again shortly.'}),'Your payment is pending. Please check again shortly.');
});
test('eight Burrow entrances use supplied art and no legacy duplicate suffix remains',()=>{
 const file='apps/mobile/src/lib/burrow-ui-assets.ts',source=fs.readFileSync(file,'utf8');
 const imports=Object.fromEntries([...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(m=>[m[2],m[2]]));imports['./adventure-friend-bounds.json']={};
 const icons=load(file,imports).BURROW_ROOM_ICONS;
 assert.equal(Object.keys(icons).length,8);assert.match(icons.my_room,/my-room.webp$/);assert.match(icons.partner_room,/partner's-room.webp$/);assert.match(icons.surprise_room,/surprise-room.webp$/);
 for(const value of Object.values(icons))assert.doesNotMatch(value,/\.webp\.webp/);
});
test('release-room heart timeline and default-sharing business policy are not replaced by this audit',()=>{
 const flow=fs.readFileSync('apps/mobile/src/components/burrow/release-room-screen.tsx','utf8');
 assert.doesNotMatch(flow,/Saving your progress/);
 const menu=fs.readFileSync('apps/mobile/app/(main)/(modals)/me.tsx','utf8');
 assert.doesNotMatch(menu,/Share by default|Sharing preferences/);
});
