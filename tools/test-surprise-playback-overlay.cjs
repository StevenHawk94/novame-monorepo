const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./lifecycle-test-utils.cjs');
const jsx=(type,props)=>({type,props}),nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const overlay=load('apps/mobile/src/components/burrow/surprise-playback-overlay.tsx',{
 'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Pressable:'Button',View:'View',StyleSheet:{create:x=>x}},
 '@expo/vector-icons':{Feather:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:59,bottom:34})},
 '@/components/ui/screen-overlay':{ScreenOverlay:'ScreenOverlay'},'./surprise-rain':{SurpriseRain:'Rain'},
});
test('all playback modes use exactly one 50%-black scrim and transparent native rain',()=>{
 let closed=0;
 for(const uri of [undefined,'draft-photo.jpg','received-photo.jpg']){
  const tree=overlay.SurprisePlaybackSurface({frame:'heart',uri,playing:true,onClose:()=>closed++,children:jsx('Audio',{})});
  assert.equal(tree.props.style.backgroundColor,'rgba(0,0,0,0.5)');assert.equal(tree.props.accessibilityViewIsModal,true);
  const rain=nodes(tree).find(n=>n.type==='Rain');assert.equal(rain.props.transparent,true);assert.equal(rain.props.uri,uri);
  assert.equal(nodes(tree).filter(n=>n.props.style?.backgroundColor).length,1);
  const close=nodes(tree).find(n=>n.type==='Button');assert.equal(close.props.style[1].top,71);close.props.onPress();
 }
 assert.equal(closed,3);
});
test('preview is a full-window overlay; Home receive surface can stay clear while waiting for private media',()=>{
 const close=()=>{};
 const tree=overlay.SurprisePlaybackOverlay({visible:true,frame:'heart',playing:true,onClose:close});
 assert.equal(tree.type,'ScreenOverlay');assert.equal(tree.props.transparent,true);assert.equal(tree.props.visible,true);
 assert.equal(tree.props.statusBarTranslucent,true);assert.equal(tree.props.navigationBarTranslucent,true);assert.equal(tree.props.onRequestClose,close);
 const loading=overlay.SurprisePlaybackSurface({frame:'heart',playing:false,showRain:false,onClose:close});
 assert.equal(nodes(loading).some(n=>n.type==='Rain'),false);assert.equal(loading.props.style.backgroundColor,overlay.SURPRISE_PLAYBACK_SCRIM);
});
