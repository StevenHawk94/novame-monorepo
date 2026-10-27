const {load,hooks,deferred}=require('./lifecycle-test-utils.cjs');
const {motionHarness}=require('./motion-test-utils.cjs');
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const motionModel=load('apps/mobile/src/lib/adventure-reward-motion.ts');
function rewardHarness({variant='treasure',reduced=false,empty=false,width=390,height=844}={}) {
  const h=hooks(),motion=motionHarness(h),calls=[],request=deferred();let active=true,reduce=reduced;
  const {AdventureRewardScreen}=load('apps/mobile/src/components/burrow/adventure-reward-screen.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{
      View:'View',Text:'Text',Pressable:'Button',StyleSheet:{create:x=>x,absoluteFillObject:{position:'absolute',top:0,bottom:0,left:0,right:0}},useWindowDimensions:()=>({width,height})},
    'react-native-reanimated':motion.reanimated,'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:20,bottom:0})},
    '@/lib/adventure-reward-motion':motionModel,'@/lib/adventure-screen-layout':load('apps/mobile/src/lib/adventure-screen-layout.ts'),
    '@/lib/use-adventure-motion':{useAdventureMotion:()=>({active,reduced:reduce})},
    '@/lib/haptics':{haptics:{light:async()=>calls.push('haptic')}},
    '@/lib/burrow-shop-categories':load('apps/mobile/src/lib/burrow-shop-categories.ts'),
    '@/lib/burrow-art-assets':{BURROW_FIXED_ART:{treasureClosed:'closed',treasureOpen:'open'},burrowArtForItem:()=>({source:'lamp',width:600,height:600,bounds:[200,150,400,550]})},
    './adventure-reveal':{AdventureReveal:'Reveal'},'./adventure-gift-box':{AdventureGiftBox:'GiftBox'},'./adventure-sunburst':{AdventureSunburst:'Sunburst'},'./burrow-image':{Image:'Image'},
  });
  const props={variant,title:empty?'Everything is collected':'Classic Lantern',item:empty?null:{title:'Classic Lantern',item_type:'decor',category:'lamps'},friendName:'Mr Mole',busy:false,
    onClaim:()=>{calls.push('claim');return request.promise;}};
  const render=()=>nodes(h.render(()=>AdventureRewardScreen(props)));
  const button=()=>render().filter(n=>n.type==='Button').at(-1);
  return {h,motion,calls,request,props,render,button,
    active:v=>{active=v;render();},reduce:v=>{reduce=v;render();}};
}
module.exports={rewardHarness,nodes,jsx,motionModel};
