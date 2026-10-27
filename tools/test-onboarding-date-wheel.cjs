const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,hooks,clock}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/onboarding-relationship-date.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const today={year:2026,month:10,day:14};
test('relationship date validation uses calendar dates, including leap years and local today',()=>{
  assert.equal(model.parseRelationshipDate('29/02/2024',today),'2024-02-29');
  for(const value of ['29/02/2025','31/04/2024','15/10/2026','01/01/1899','01/13/2020','0/10/2020','invalid'])assert.equal(model.parseRelationshipDate(value,today),null,value);
  assert.equal(model.parseRelationshipDate('14/10/2026',today),'2026-10-14');
  assert.deepEqual(plain(model.clampRelationshipDate({year:2025,month:2,day:29},today)),{year:2025,month:2,day:28});
  assert.deepEqual(plain(model.clampRelationshipDate({year:2030,month:12,day:31},today)),today);
  assert.deepEqual(plain(model.relationshipDateParts('bad',today)),today);
  assert.equal(model.formatRelationshipDate({year:2024,month:10,day:7}),'07/10/2024');
});
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
function harness(){
  const parent=hooks(),time=clock();let active=parent;
  const react=Object.fromEntries(Object.keys(parent.react).map(name=>[name,(...args)=>active.react[name](...args)]));
  const {OnboardingDateWheel}=load('apps/mobile/src/components/onboarding/onboarding-date-wheel.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',ScrollView:'Scroll',Text:'Text',Pressable:'Button',StyleSheet:{create:value=>value}},
    '@/lib/burrow-onboarding-design':{ONBOARDING_CREAM:'#FCF4E8',ONBOARDING_INK:'#49270F'},
    '@/lib/onboarding-relationship-date':{...model,localRelationshipDate:()=>today},
  },time.globals);
  let value='07/10/2024';const changes=[];
  const render=()=>{active=parent;return parent.render(()=>OnboardingDateWheel({value,onChange:next=>{value=next;changes.push(next);}}));};
  const columns=()=>nodes(render()).filter(node=>typeof node.type==='function');
  return {parent,time,changes,columns,value:()=>value,set:next=>{value=next;},wheel(label){
    const child=hooks(),element=columns().find(node=>node.props.label===label);
    const renderChild=()=>{active=child;return child.render(()=>element.type(element.props));};
    const scroll=nodes(renderChild()).find(node=>node.type==='Scroll'),positions=[];
    scroll.props.ref.current={scrollTo:position=>positions.push(position)};
    return {child,render:renderChild,scroll:()=>nodes(renderChild()).find(node=>node.type==='Scroll'),positions};
  }};
}
test('three embedded wheels expose the selected month/day/year and cap future choices',()=>{
  const h=harness(),columns=h.columns();assert.equal(columns.length,3);
  assert.deepEqual(plain(columns.map(column=>column.props.label)),['Month','Day','Year']);
  assert.equal(columns[0].props.values[columns[0].props.index],'October');assert.equal(columns[1].props.values[columns[1].props.index],'7');assert.equal(columns[2].props.values[columns[2].props.index],'2024');
  assert.equal(columns[0].props.values.length,12);h.set('14/10/2026');
  const current=h.columns();assert.equal(current[0].props.values.length,10);assert.equal(current[1].props.values.length,14);h.parent.unmount();
});
test('native momentum wins over drag-end fallback and snaps to the final row, with no per-frame React updates',()=>{
  const h=harness(),wheel=h.wheel('Month'),scroll=wheel.scroll();
  const event=y=>({nativeEvent:{contentOffset:{y}}});
  assert.equal(scroll.props.snapToInterval,44);assert.equal(scroll.props.bounces,false);
  scroll.props.onScrollBeginDrag();scroll.props.onScroll(event(44*6));assert.equal(h.changes.length,0,'tracking position never updates state for each frame');
  scroll.props.onScrollEndDrag(event(44*6));scroll.props.onMomentumScrollBegin();h.time.advance(120);assert.equal(h.changes.length,0);
  scroll.props.onMomentumScrollEnd(event(44*8+.7));assert.equal(h.value(),'07/09/2024');assert.equal(h.changes.length,1);
  assert.equal(wheel.positions.at(-1).y,44*8);wheel.child.unmount();h.parent.unmount();
});
test('slow drag without momentum commits once; unmount removes its pending fallback',()=>{
  const h=harness(),wheel=h.wheel('Day'),scroll=wheel.scroll(),event={nativeEvent:{contentOffset:{y:44*9}}};
  scroll.props.onScrollBeginDrag();scroll.props.onScrollEndDrag(event);h.time.advance(120);assert.equal(h.value(),'10/10/2024');
  scroll.props.onScrollBeginDrag();scroll.props.onScrollEndDrag(event);wheel.child.unmount();h.time.advance(120);assert.equal(h.changes.length,1);h.parent.unmount();
});
test('year selection clamps February 29 to February 28, and VoiceOver/TalkBack can adjust values',()=>{
  const h=harness();h.set('29/02/2024');const year=h.columns().find(column=>column.props.label==='Year');year.props.onSelect(2025-1900);assert.equal(h.value(),'28/02/2025');
  const wheel=h.wheel('Day'),scroll=wheel.scroll();assert.equal(scroll.props.accessibilityRole,'adjustable');
  scroll.props.onAccessibilityAction({nativeEvent:{actionName:'decrement'}});assert.equal(h.value(),'27/02/2025');wheel.child.unmount();h.parent.unmount();
});
