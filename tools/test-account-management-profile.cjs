const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props}),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
function harness({password=false,failSave=false,guest=false}={}){
 const h=hooks(),calls=[],alerts=[],profile={id:'me',display_name:'Sam',birthday:'1995-05-12',gender:null,has_password:password};let epoch=1,owner='me';
 const api=load('apps/mobile/src/components/me/account-management-screen.tsx',{
 react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{ActivityIndicator:'Spinner',KeyboardAvoidingView:'Keyboard',Platform:{OS:'ios'},Pressable:'Button',ScrollView:'Scroll',StyleSheet:{create:v=>v},Text:'Text',TextInput:'Input',View:'View'},
 '@react-native-community/datetimepicker':{default:'DatePicker',__esModule:true},'@expo/vector-icons':{MaterialIcons:'Icon'},'expo-router':{router:{push:p=>calls.push(['push',p]),replace:p=>calls.push(['replace',p]),back:()=>calls.push(['back'])}},
 'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},'@/components/ui/app-dialog':{appAlert:(...args)=>alerts.push(args)},'@/lib/haptics':{haptics:{success(){}}},
 '@/lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{email:'sam@example.test'}}}})}}},'@/lib/auth':{signOut:async()=>calls.push(['signout'])},
 '@/lib/session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>owner},
 '@/lib/account-api':{fetchAccountProfile:async()=>profile,requestAccountReauthentication:async()=>({kind:'success'}),
 updateAccountDetail:async(...args)=>{calls.push(['detail',...args]);return{kind:failSave?'error':'success',message:'failed'};},updateDisplayName:async(...args)=>{calls.push(['name',...args]);return{kind:'success'};},
 updateEmail:async(...args)=>{calls.push(['email',...args]);return{kind:'success'};},updateOwnPassword:async(...args)=>{calls.push(['password',...args]);return{kind:'success'};},
 prepareAccountDeletion:async id=>{calls.push(['prepare-delete',id]);return{kind:'success',challengeId:'session-bound',requiresCode:!guest};},
 deleteAccount:async(...args)=>{calls.push(['delete',...args]);return{kind:'success'};}},
 '@/lib/me-stats':{getCachedMeStats:()=>({displayName:'Sam'}),clearCachedMeStats(){},setCachedMeStats(){},invalidateMeStats(){},fetchMeStats:async()=>{}},
 '@/lib/subscription':{clearCachedSubscription(){}},'@/lib/storage':{storage:{getString:()=>JSON.stringify(profile),set(){}}},'@/shared/storage/keys':{kAccountProfile:{name:'account'}},
 '@/lib/account-profile-local':{cachedAccountProfile:()=>profile,subscribeAccountProfile:()=>()=>{},accountProfileSyncError:()=>'',saveAccountProfile:(fields,base)=>{if(failSave)throw Error('disk failed');calls.push(['local',fields]);return{...base,...fields};}},
 '@/lib/burrow-store':{scheduleBurrowRefresh(){}},'@/lib/onboarding':{getBunnyName:()=>''},
 './account-match-code-card':{AccountMatchCodeCard:'MatchCodeCard'},
 });
 const render=()=>h.render(api.AccountManagementScreen),button=label=>nodes(render()).find(n=>n.type==='Button'&&nodes(n).some(child=>child.type==='Text'&&child.props.children===label));
 return{render,button,calls,alerts,h,profile,input:(label,value)=>nodes(render()).find(n=>n.type==='Input'&&n.props.accessibilityLabel===label).props.onChangeText(value),switch:()=>{owner='other';epoch++;}};
}
test('account groups show profile details; passwordless users keep sign-in methods, not fake password entry',async()=>{
 const h=harness();h.render();await flush();for(const name of ['Your name','Your date of birth','Your gender','Email','Sign-in methods','Delete account'])assert.ok(h.button(name),name);
 assert.equal(h.button('Change password'),undefined);h.button('Sign-in methods').props.onPress();assert.equal(h.calls[0][1],'/(main)/(modals)/connect-account');h.h.unmount();
});
test('password accounts require current-email security code and no mutation happens with short code',async()=>{
 const h=harness({password:true});h.render();await flush();h.button('Change password').props.onPress();h.input('New password','a-secure-password');
 await h.button('Save').props.onPress();await flush();assert.equal(h.calls.length,0);
 h.input('Security code','123456');h.button('Save').props.onPress();await flush();assert.equal(h.calls[0][0],'password');assert.equal(h.calls[0][3],'123456');h.h.unmount();
});
test('local disk failure retains editor and previous details',async()=>{
 const h=harness({failSave:true});h.render();await flush();h.button('Your date of birth').props.onPress();
 const date=nodes(h.render()).find(n=>n.type==='DatePicker');date.props.onChange({},new Date(1998,1,3,12));h.button('Save').props.onPress();await flush();
 assert.equal(h.calls.length,0);assert.ok(h.button('Save'));assert.equal(h.profile.birthday,'1995-05-12');h.h.unmount();
});
test('profile changes close editor immediately without calling server wrappers',async()=>{
 const h=harness();h.render();await flush();h.button('Your name').props.onPress();h.input('Your name','New name');h.button('Save').props.onPress();
 assert.equal(h.button('Save'),undefined);assert.equal(h.calls[0][0],'local');assert.equal(h.calls[0][1].display_name,'New name');h.h.unmount();
});
test('deletion retains two explicit confirmations; old-account confirmation cannot delete a new account',async()=>{
 const h=harness();h.render();await flush();h.button('Delete account').props.onPress();assert.equal(h.calls.length,0);
 h.alerts[0][2].find(a=>a.text==='Delete').onPress();assert.equal(h.alerts.length,2);h.switch();h.alerts[1][2].find(a=>a.text==='Delete Forever').onPress();await flush();assert.equal(h.calls.length,0);h.h.unmount();
});
test('linked account deletion waits for session-bound confirmation code after both alerts',async()=>{
 const h=harness();h.render();await flush();h.button('Delete account').props.onPress();
 h.alerts[0][2].find(a=>a.text==='Delete').onPress();await h.alerts[1][2].find(a=>a.text==='Delete Forever').onPress();await flush();
 assert.equal(h.calls.filter(c=>c[0]==='delete').length,0);assert.ok(h.button('Delete Forever'));
 h.input('Account deletion confirmation code','12345678');await h.button('Delete Forever').props.onPress();await flush();
 assert.deepEqual(h.calls.find(c=>c[0]==='delete'),['delete','me','session-bound','12345678']);h.h.unmount();
});
test('password mutation facade uses authenticated user-scoped Auth and nonce, never admin endpoint',async()=>{
 const calls=[];let owner='me';const api=load('apps/mobile/src/lib/account-api.ts',{'./api':{apiClient:{post:async()=>{throw Error('must not use backend admin');}}},'./supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:owner}}}}),updateUser:async attrs=>{calls.push(attrs);return{};}}}}});
 assert.equal((await api.updateOwnPassword('me','secret123','123456')).kind,'success');assert.equal(calls[0].nonce,'123456');assert.equal(calls[0].password,'secret123');
 owner='other';assert.equal((await api.updateOwnPassword('me','secret123','123456')).kind,'error');assert.equal(calls.length,1);
});
