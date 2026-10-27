const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks}=require('./lifecycle-test-utils.cjs');
const m=load('apps/mobile/src/lib/friend-text-layout.ts'),visit=load('apps/mobile/src/lib/friend-visit-presentation.ts');
test('font shrinks before the panel grows, never below the readable minimum; huge text has bounded scrolling fallback',()=>{
 assert.equal(m.fitFriendText(700,18,270).size,18);
 assert.equal(m.fitFriendText(700,18,310).size,17);
 assert.equal(m.fitFriendText(700,17,295).size,16);
 assert.equal(m.fitFriendText(700,16,295).panelHeight,295);
 assert.equal(m.fitFriendText(700,16,900).panelHeight,406);
 assert.equal(m.fitFriendText(700,16,900).ready,true);
});
test('all paragraphs use the same left aligned style; options keep 48-point touch targets and their full measured height',()=>{
 for(const size of [18,17,16,15,14])for(const role of ['body','option']){
  const style=m.friendTextStyle(size,role);assert.equal(style.textAlign,'left');assert.equal(style.fontSize,size);assert.equal(style.lineHeight,size+8);
 }
 const page={body:'Question',options:['One','Two','Three']},heights={};
 heights[m.friendTextKey('Question','body')]=52;
 for(const text of page.options)heights[m.friendTextKey(text,'option')]=26;
 assert.equal(m.friendTextPageHeight(page,heights),52+3*49+3*12+40+5);
 heights[m.friendTextKey('Three','option')]=78;
 assert.equal(m.friendTextPageHeight(page,heights),52+2*49+101+3*12+40+5);
 assert.equal(m.friendTextRuns([page,page]).length,4);
 assert.equal(m.friendHintHeight(1),44);assert.equal(m.friendHintHeight(2),61);
 assert.equal(m.friendTextPageHeight({body:'Question',hint:true},heights,m.friendHintHeight(2)),52+40+61+5);
});
test('waiting is distinct from empty, locally pending sync, expired, both completed and frozen reading',()=>{
 const v={id:'visit',myCompleted:true,partnerCompleted:false,expiresAt:'2026-10-27T12:00:00Z'},now='2026-10-26T12:00:00Z';
 assert.equal(visit.friendVisitPresentation(v,now,'',undefined,false),'waiting');
 assert.equal(visit.friendVisitPresentation({...v,partnerCompleted:true},now,'',undefined,false),'empty');
 assert.equal(visit.friendVisitPresentation(v,now,'visit',undefined,false),'empty');
 assert.equal(visit.friendVisitPresentation(v,v.expiresAt,'',undefined,false),'empty');
 assert.equal(visit.friendVisitPresentation(null,now,'',undefined,true),'conversation');
 assert.equal(visit.friendVisitPresentation({...v,myCompleted:false},now,'',{choiceId:'A',done:true,status:'pending'},false),'syncing');
 assert.equal(visit.friendVisitPresentation({...v,myCompleted:false},now,'',{choiceId:'A',done:true,status:'confirmed'},false),'waiting');
 assert.equal(visit.friendVisitPresentation({...v,myCompleted:false,partnerCompleted:true},now,'',{choiceId:'A',done:true,status:'confirmed'},false),'empty');
 assert.equal(visit.friendVisitPresentation(null,now,'',{choiceId:'A',done:true,status:'confirmed'},false),'empty');
});
test('growing the text panel never changes a cast member’s visible height or torso centre',()=>{
 const geometry=load('apps/mobile/src/lib/adventure-encounter-layout.ts'),bounds=require('../apps/mobile/src/lib/adventure-friend-bounds.json');
 for(const g of Object.values(bounds))for(const pose of [false,true]){
  const a=geometry.adventureEncounterLayout(390,700,g,pose,'dialogue',280),b=geometry.adventureEncounterLayout(390,700,g,pose,'dialogue',360);
  assert.equal(a.visibleHeight,b.visibleHeight);assert.equal(a.bodyCenterX,b.bodyCenterX);assert.equal(a.image.width,b.image.width);
 }
});
test('compact typography starts smaller, handles large system text locally, and never shrinks below 14',()=>{
 const normal=m.friendTextSizing(312,720,1),small=m.friendTextSizing(256,520,1),largeText=m.friendTextSizing(312,720,1.8);
 assert.equal(normal.size,18);assert.equal(normal.minSize,16);assert.equal(normal.maxFontSizeMultiplier,0);
 for(const sizing of [small,largeText]){
  assert.equal(sizing.size,16);assert.equal(sizing.minSize,14);assert.equal(sizing.maxFontSizeMultiplier,1.1);
  assert.ok(sizing.size*sizing.fontScale<=normal.size,'compact rendered text is not larger than regular text');
  assert.equal(m.fitFriendText(520,16,900,sizing.minSize).size,15);
  assert.equal(m.fitFriendText(520,15,900,sizing.minSize).size,14);
  const fit=m.fitFriendText(520,14,900,sizing.minSize);assert.equal(fit.size,14);assert.equal(fit.ready,true);assert.equal(fit.panelHeight,520*.58);
 }
 assert.equal(m.friendTextSizing(312,720,undefined).size,18);
 assert.equal(m.friendTextSizing(312,720,NaN).size,18);
});
test('native compact measurement waits for every run, retries 15 then 14, and only publishes a complete fit',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props}),ready=[];
 const {FriendTextMeasure}=load('apps/mobile/src/components/burrow/friend-text-panel.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Text:'Text',View:'View',StyleSheet:{create:x=>x}},
  './adventure-reveal':{},'./burrow-back-button':{},
 });
 const outer=FriendTextMeasure({pages:[{body:'Long',options:['A','B','C']}],width:240,height:520,fontScale:1,onReady:fit=>ready.push(fit)});
 const render=()=>h.render(()=>outer.type(outer.props));
 for(const size of [16,15,14]){
  const tree=render(),texts=tree.props.children;
  assert.equal(texts[0].props.style[0].fontSize,size);
  assert.ok(texts.every(t=>t.props.maxFontSizeMultiplier===1.1));
  texts.slice(0,-1).forEach(t=>t.props.onLayout({nativeEvent:{layout:{height:52}}}));assert.equal(ready.length,0);
  texts.at(-1).props.onLayout({nativeEvent:{layout:{height:52}}});
 }
 assert.equal(ready.length,1);assert.equal(ready[0].size,14);assert.ok(ready[0].panelHeight>220);
 h.unmount();
});
test('rendered compact prose and choices share the exact scaling limit used by native probes',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props});
 const metrics={size:14,width:240,height:280,hintHeight:44,maxFontSizeMultiplier:1.1,heights:{}};
 const {FriendTextPanel}=load('apps/mobile/src/components/burrow/friend-text-panel.tsx',{
  react:{...h.react,useContext:()=>metrics},'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
  './adventure-reveal':{AdventureReveal:'Reveal'},'./burrow-back-button':{BackIcon:'Icon'},
 });
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 const tree=FriendTextPanel({page:{body:'Question',options:['A','B','C'],hint:true}}),texts=nodes(tree).filter(n=>n.type==='Text');
 assert.equal(texts.length,5);assert.ok(texts.every(t=>t.props.maxFontSizeMultiplier===1.1));
 assert.equal(texts[0].props.style.fontSize,14);
 for(const option of nodes(tree).filter(n=>n.type==='Button'))assert.ok(option.props.style({pressed:false})[0].minHeight>=48);
});
test('only explicit welcome pages use centred large titles, visitor badge and the reference button colours',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props}),metrics={size:18,width:312,height:300,hintHeight:44,maxFontSizeMultiplier:0,heights:{}};
 const {FriendTextPanel}=load('apps/mobile/src/components/burrow/friend-text-panel.tsx',{
  react:{...h.react,useContext:()=>metrics},'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
  './adventure-reveal':{AdventureReveal:'Reveal'},'./burrow-back-button':{BackIcon:'Icon'},
 });
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 for(const welcome of ['adventure','visit']){
  const outer=FriendTextPanel({page:{welcome,title:'Title',body:'Body',action:'Talk'}}),tree=h.render(()=>outer.type(outer.props)),list=nodes(tree);
  assert.ok(list.some(n=>n.props.testID==='friend-welcome-panel'));
  assert.equal(list.some(n=>n.props.testID==='friend-visitor-badge'),welcome==='visit');
  for(const text of list.filter(n=>n.type==='Text'&&['Title','Body','Talk'].includes(n.props.children)))
   assert.equal(Object.assign({},...text.props.style).textAlign,'center');
  const button=list.find(n=>n.type==='Button'),style=Object.assign({},...button.props.style({pressed:false}).filter(Boolean));
  assert.equal(style.backgroundColor,welcome==='adventure'?'#FFBE3B':'#6B3B24');assert.ok(style.minHeight>=48);
 }
 const normal=nodes(FriendTextPanel({page:{title:'Title',body:'Body',options:['A','B']}}));
 assert.equal(normal.some(n=>n.props.testID==='friend-welcome-panel'),false);
 assert.equal(normal.find(n=>n.props.testID==='friend-prose').props.style.textAlign,'left');
 h.unmount();
});
test('welcome text uses native heights to shrink first, then offers scrolling instead of clipping',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props}),metrics={width:312,height:240};
 const {FriendTextPanel}=load('apps/mobile/src/components/burrow/friend-text-panel.tsx',{
  react:{...h.react,useContext:()=>metrics},'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
  './adventure-reveal':{AdventureReveal:'Reveal'},'./burrow-back-button':{BackIcon:'Icon'},
 });
 const outer=FriendTextPanel({page:{welcome:'adventure',title:'Title',body:'Long body',action:'Talk'}});
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 const sizes=new Set();let list;
 for(let i=0;i<12;i++){
  list=nodes(h.render(()=>outer.type(outer.props)));
  const texts=list.filter(n=>n.type==='Text'&&n.props.onLayout);
  sizes.add(Object.assign({},...texts.find(n=>n.props.children==='Long body').props.style).fontSize);
  for(const text of texts)text.props.onLayout({nativeEvent:{layout:{height:text.props.children==='Long body'?200:40}}});
 }
 assert.deepEqual([...sizes],[18,17,16,15,14]);
 assert.ok(list.some(n=>n.props.children==='Scroll to read more ↓'));
 assert.equal(list.find(n=>n.props.testID==='friend-welcome-panel').props.style[1].opacity,1);
 h.unmount();
});
