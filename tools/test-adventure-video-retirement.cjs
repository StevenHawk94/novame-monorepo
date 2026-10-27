const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks}=require('./lifecycle-test-utils.cjs');

test('retired Adventure movie, poster and player are absent; current route remains vector based',()=>{
  for(const file of [
    'apps/mobile/assets/burrow-webp/adventure-page/adventure-video.mp4',
    'apps/mobile/assets/burrow-webp/adventure-page/adventure-video-poster.webp',
    'apps/mobile/src/lib/adventure-legacy-video-assets.ts',
    'apps/mobile/src/components/burrow/adventure-video.tsx',
    'apps/mobile/src/components/burrow/adventure-video.ios.tsx',
    'apps/mobile/src/components/burrow/adventure-video-expo.tsx',
  ])assert.equal(fs.existsSync(file),false,file);
  const screen=fs.readFileSync('apps/mobile/src/components/burrow/adventure-progress-screen.tsx','utf8');
  assert.match(screen,/AdventureDiggingRoute/);
  assert.doesNotMatch(screen,/AdventureVideo|adventure-legacy-video-assets|adventure-video/);
});

// The lifecycle hook is also used by the current digging/reward animations.
test('shared Adventure motion pauses while inactive/blurred and releases its listener',()=>{
  const h=hooks();let focused=true,notify,removed=false;
  const appState={currentState:'active',addEventListener:(_,fn)=>{notify=fn;return {remove:()=>{removed=true;}};}};
  const {useAdventureVideoActive}=load('apps/mobile/src/lib/use-adventure-video-active.ts',{
    react:h.react,'react-native':{AppState:appState},'@react-navigation/native':{useIsFocused:()=>focused},
  });
  const render=()=>h.render(useAdventureVideoActive);
  assert.equal(render(),true);notify('inactive');assert.equal(render(),false);
  notify('background');assert.equal(render(),false);notify('active');assert.equal(render(),true);
  focused=false;assert.equal(render(),false);h.unmount();assert.equal(removed,true);
});
