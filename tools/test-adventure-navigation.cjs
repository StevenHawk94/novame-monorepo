const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {pathToFileURL}=require('node:url');
const {load}=require('./lifecycle-test-utils.cjs');
const {openStartedAdventure}=load('apps/mobile/src/lib/adventure-navigation.ts');
const routers=import(pathToFileURL(require.resolve('@react-navigation/routers',{paths:[require.resolve('expo-router',{paths:[require('node:path').resolve(__dirname,'../apps/mobile')]})]})).href);
function route(name,section){return {key:`${name}:${section??''}:${Math.random()}`,name,...(section?{params:{section}}:{})};}
async function harness(routes){
  const {StackRouter,StackActions}=await routers,router=StackRouter({initialRouteName:'(tabs)'});
  const options={routeNames:['(tabs)','burrow-detail','reflect-typing','reflect-guided','reflect'],routeParamList:{},routeGetIdList:{}};
  let state={...router.getInitialState(options),routes,index:routes.length-1};const calls=[];
  const dispatch=action=>{state=router.getStateForAction(state,action,options);assert.ok(state);};
  return {state:()=>state,calls,back:()=>dispatch(StackActions.pop(1)),replace:params=>dispatch(StackActions.replace('burrow-detail',params)),
    start:()=>openStartedAdventure({dismiss:count=>{calls.push(['dismiss',count]);dispatch(StackActions.pop(count));},replace:href=>{calls.push(['replace',href]);dispatch(StackActions.replace('burrow-detail',href.params));}},state)};
}
test('reproduces the old failure: replacing the record creates two Adventure pages, requiring two backs',async()=>{
  const x=await harness([route('(tabs)'),route('burrow-detail','adventure'),route('reflect-typing')]);
  x.replace({section:'adventure'});x.back();assert.equal(x.state().routes.at(-1).params.section,'adventure');
  x.back();assert.equal(x.state().routes.at(-1).name,'(tabs)');
});
for(const platform of ['ios','android'])for(const input of ['reflect-typing','reflect-guided'])test(`${platform}/${input}: Start reuses the original route; the FIRST edge-back leaves ongoing`,async()=>{
  const home=route('(tabs)'),adventure=route('burrow-detail','adventure'),x=await harness([home,adventure,route(input)]);
  x.start();assert.equal(x.state().routes.length,2);assert.equal(x.state().routes.at(-1).key,adventure.key);
  assert.deepEqual(x.calls,[['dismiss',1]]);x.back();assert.equal(x.state().routes.at(-1).key,home.key);
});
test('direct journal entry replaces only the input; an unrelated burrow-detail must never be mistaken for Adventure',async()=>{
  for(const underlay of [route('(tabs)'),route('burrow-detail','friends_room')]){
    const x=await harness([underlay,route('reflect-guided')]);x.start();assert.equal(x.calls[0][0],'replace');
    assert.equal(x.state().routes.length,2);x.back();assert.equal(x.state().routes.at(-1).key,underlay.key);
  }
});
test('a temporarily unavailable navigation state retains the safe direct-entry replacement',()=>{
  const calls=[];openStartedAdventure({dismiss(){assert.fail('cannot infer an ancestor');},replace:href=>calls.push(href)},undefined);
  assert.equal(calls.length,1);assert.equal(calls[0].params.section,'adventure');
});
test('old duplicate routes and nested inputs collapse to the earliest actual Adventure, never another detail',async()=>{
  const original=route('burrow-detail','adventure'),x=await harness([route('(tabs)'),original,route('burrow-detail','adventure'),route('reflect'),route('reflect-typing')]);
  x.start();assert.deepEqual(x.calls,[['dismiss',3]]);assert.equal(x.state().routes.at(-1).key,original.key);x.back();assert.equal(x.state().routes.length,1);
});
test('the actual source entry dismisses the arrival badge before navigation; a failed preparation never acknowledges it',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  const ast=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='openBurrow');
  const code=ts.transpileModule(`${fn.getText(ast)};exports.open=openBurrow;`,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  let ready=true,retry;const calls=[],data={profile:{id:'me'},serverNow:'2026-10-17T00:00:00Z'};
  const exports={};vm.runInNewContext(code,{exports,burrowPageIsReady:()=>ready,enterBurrowPage:(_entry,open)=>{if(ready)open();else retry=open;},
    uiWorkPriority:{action(){}},beginInteractionTiming(){},markInteractionTiming(){},
    getBurrowSnapshot:()=>({data,receivedAt:100}),burrowClock:()=>1100,dismissAdventureReminder:(value,now)=>calls.push(['dismiss',value,now]),
    router:{push:route=>calls.push(['push',route])}});
  exports.open('adventure');assert.deepEqual(calls.map(c=>c[0]),['dismiss','push']);assert.equal(calls[0][2],Date.parse(data.serverNow)+1000);
  calls.length=0;ready=false;exports.open('adventure');assert.equal(calls.length,0);ready=true;retry();assert.deepEqual(calls.map(c=>c[0]),['dismiss','push']);
});
test('a focused Adventure acknowledges arrival on entry or countdown completion, never in its exit cleanup',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  const ast=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback;
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('dismissAdventureReminder(data,now)'))callback=n.arguments[0].getText(ast);ts.forEachChild(n,visit);}visit(ast);
  assert.ok(callback);const calls=[],context={data:{activeAdventure:{id:'arrived'}},section:'adventure',focused:true,now:100,dismissAdventureReminder:(...args)=>calls.push(args)};
  const fn=vm.runInNewContext(callback,context);assert.equal(fn(),undefined);assert.equal(calls.length,1);
  context.focused=false;fn();assert.equal(calls.length,1);context.focused=true;context.section='home';fn();assert.equal(calls.length,1);
});
