const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props});
test('shared back button provides one centered SVG and a consistent circular 44-point control',()=>{
 const ui=load('apps/mobile/src/components/burrow/burrow-back-button.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Pressable:'Button',StyleSheet:{create:x=>x}},
  'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},
 });
 const icon=ui.BackIcon({color:'#FFFFFF'});assert.equal(icon.type,'Svg');
 assert.equal(icon.props.width,28);assert.equal(icon.props.height,28);assert.equal(icon.props.accessible,false);
 assert.equal(icon.props.children.props.stroke,'#FFFFFF');assert.equal(icon.props.children.props.strokeWidth,2.5);
 assert.equal(icon.props.children.props.strokeLinecap,'round');assert.equal(icon.props.children.props.strokeLinejoin,'round');
 let pressed=0;const button=ui.BurrowBackButton({onPress:()=>pressed++,light:true,disabled:true});
 assert.equal(button.props.disabled,true);assert.equal(button.props.accessibilityLabel,'Go back');
 const style=button.props.style({pressed:false});assert.equal(style[0].width,44);assert.equal(style[0].height,44);
 assert.equal(style[0].alignItems,'center');assert.equal(style[0].justifyContent,'center');
 assert.equal(style[0].borderRadius,22);assert.equal(style[1].backgroundColor,'#FFFFFF30');
});
test('page headers cannot reintroduce raw text arrows or independent back icons; calendars keep month controls',()=>{
 function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):entry.name.endsWith('.tsx')?[path.join(dir,entry.name)]:[]);}
 for(const file of [...walk('apps/mobile/app'),...walk('apps/mobile/src/components')]){
  if(file.endsWith('history-calendar.tsx'))continue;
  const text=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(text,/<(?:Feather|MaterialIcons)[^>]*name="(?:arrow-back|arrow-left)"/,file);
  assert.doesNotMatch(text,/>\s*[‹←]\s*(?:<|Cancel)/,file);
  if(!file.endsWith('date-range-calendar.tsx')&&!file.endsWith('my-logs.tsx'))
   assert.doesNotMatch(text,/<(?:Feather|MaterialIcons)[^>]*name="chevron-left"/,file);
 }
});
test('Collection, Memories, Surprise (including camera) and Moments use the whole shared circular button',()=>{
 for(const name of ['collection-room-screen','couple-journal-screen','surprise-room-screen','surprise-camera','moments-timeline']){
  const source=fs.readFileSync(`apps/mobile/src/components/burrow/${name}.tsx`,'utf8');
  assert.match(source,/import \{ BurrowBackButton \} from '\.\/burrow-back-button'/,name);
  assert.match(source,/<BurrowBackButton light\b/,name);
  assert.doesNotMatch(source,/\bBackIcon\b/,`${name}: the icon alone omits the shared background and touch target`);
 }
});
test('gift route pushes categories as native cards and Done dismisses both library layers to retained Home',async()=>{
 const calls=[],data={profile:{id:'a'},partner:{id:'b'},pairVersion:'one'},selected={stable_id:'gift-1'};let category;
 const route=load('apps/mobile/app/(main)/gift-library.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Text:'Text',ActivityIndicator:'Spinner',StyleSheet:{create:x=>x}},
  'expo-router':{useLocalSearchParams:()=>({category}),router:{canGoBack:()=>true,back:()=>calls.push('back'),push:href=>calls.push(href)}},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:47,bottom:34})},
  '@/components/burrow/adventure-gift-collection':{AdventureGiftCollection:'Collection'},
  '@/components/burrow/burrow-back-button':{BurrowBackButton:'Back'},
  '@/lib/app-major-update-api':{selectAdventureGift:async id=>calls.push(['server',id])},
  '@/lib/burrow-store':{useBurrow:()=>({data}),runBurrowAction:async(key,action)=>{await action();return true;},confirmBurrowShelfGift:(owner,id)=>calls.push(['confirmed',owner,id])},
  '@/lib/retained-tab-navigation':{dismissToRetainedTab:href=>calls.push(['dismiss',href])},
 });
 const root=route.default();assert.equal(root.type,'Collection');root.props.onOpenCategory('Kettles');
 assert.equal(calls[0].pathname,'/(main)/gift-library');assert.equal(calls[0].params.category,'Kettles');
 category='Kettles';const detail=route.default();assert.equal(detail.props.category,'Kettles');detail.props.onBack();assert.equal(calls.at(-1),'back');
 assert.equal(await detail.props.onSelect(selected),true);assert.deepEqual(calls.at(-1),['confirmed','a','gift-1']);
 detail.props.onClose();assert.deepEqual(calls.at(-1),['dismiss','/(main)/(tabs)']);
 assert.ok(fs.existsSync('apps/mobile/app/(main)/(tabs)/index.tsx'),'Home is the index route, not a nonexistent /home alias');
 assert.doesNotMatch(fs.readFileSync('apps/mobile/app/(main)/gift-library.tsx','utf8'),/\(tabs\)\/home/);
});
