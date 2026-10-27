const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
test('all six Room headers share 24pt system bold while dialogue/body styles remain independent',()=>{
 for(const os of ['ios','android']){
  const {ROOM_TITLE_STYLE}=load('apps/mobile/src/lib/room-header-typography.ts',{'react-native':{Platform:{OS:os}}});
  assert.equal(ROOM_TITLE_STYLE.fontSize,24);assert.equal(ROOM_TITLE_STYLE.lineHeight,30);assert.equal(ROOM_TITLE_STYLE.fontWeight,'800');
  assert.equal(ROOM_TITLE_STYLE.fontFamily,os==='ios'?'System':'sans-serif');
 }
 for(const file of ['surprise-room-screen','game-room-screen','release-room-screen','couple-friend-visit-card','couple-journal-screen','collection-room-screen']){
  const source=fs.readFileSync(`apps/mobile/src/components/burrow/${file}.tsx`,'utf8');
  assert.match(source,/import.*ROOM_TITLE_STYLE.*room-header-typography/);
  assert.match(source,/style=\{\[[^\]]*ROOM_TITLE_STYLE/);
 }
});
