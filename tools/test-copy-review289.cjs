const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {load}=require('./lifecycle-test-utils.cjs');
const ts=require('../apps/mobile/node_modules/typescript');
const audit=require('../catalog/approvals/copy-review-2026-10-29.json');
const base='apps/mobile/src/components/',source=p=>fs.readFileSync(p,'utf8'),norm=s=>s.replace(/\s+/g,' ').trim();
const pages={
 '设置菜单':['apps/mobile/app/(main)/(modals)/me.tsx'],
 '绑定账号':[base+'auth/connect-account-view.tsx'],
 'Plushie 收藏与购买':[base+'burrow/toy-collection-screen.tsx'],
 'Touch Note 录制 / 播放 / 历史':[base+'burrow/plushie-touch-screen.tsx'],
 'Touch Note 入口':[base+'burrow/touch-note-entry.tsx'],
 'Tap Your Day':['apps/mobile/app/(main)/reflect-guided.tsx'],
 'Adventure 发起页':[base+'burrow/adventure-entry.tsx'],
 'Game Room 历史':[base+'burrow/game-history-screen.tsx'],
 'Game Room 功能与结算':[base+'burrow/game-room-screen.tsx'],
 'Release Room 功能与结算':[base+'burrow/release-room-screen.tsx'],
 'Quests 任务与奖励':[base+'burrow/quest-board.tsx'],
 '照片查看与编辑':[base+'burrow/room-photo.tsx'],
 'Plus 支付与恢复':['apps/mobile/app/(main)/(modals)/subscription-paywall.tsx'],
 '金币商店':[base+'burrow/carrot-shop.tsx'],
 'Plus 权益与方案':[base+'paywall/burrow-paywall-page.tsx'],
 '订阅支付回执':['apps/mobile/src/lib/iap.ts'],
 'Moments 时间线':[base+'burrow/moments-timeline.tsx'],
 '评分与反馈':[base+'rating/rating-prompt-sheet.tsx'],
 'burrow-store':['apps/mobile/src/lib/burrow-store.ts'],
 '房间公共控制页':[base+'burrow/burrow-screen.tsx'],
};
const originals=require('node:child_process').execFileSync('rg',['--files','apps/mobile/src','apps/mobile/app'],{encoding:'utf8'}).trim().split('\n').filter(p=>/tsx?$/.test(p));
const strings=new Map(originals.map(file=>{const root=ts.createSourceFile(file,source(file),99,true),out=[];
 function visit(n){if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isJsxText(n))out.push(norm(n.text));ts.forEachChild(n,visit);}visit(root);return[file,out];}));
test('all 101 annotated workbook rows are accounted for; blank/unreviewed suggestions are not auto-approved',()=>{
 assert.equal(audit.entries.length,101);assert.equal(new Set(audit.entries.map(x=>x.id)).size,101);
 assert.deepEqual(audit.counts,{'retain-visible-conditional':1,retain:26,applied:51,'rename-revoked':1,'retired-ui':2,'already-removed':1,'previously-updated':19});
 assert.equal(audit.sourceWorkbook.modified,false);assert.match(audit.sourceWorkbook.sha256,/^[a-f0-9]{64}$/);
});
for(const entry of audit.entries.filter(e=>e.status==='applied'&&!/[\u3400-\u9fff{}]/.test(e.decision)&&!['TXT-0705','TXT-3724','TXT-4352'].includes(e.id))){
 test(`${entry.sheet}!I${entry.row} (${entry.id}) uses the approved final sentence`,()=>{
  const originalRowPage={
   'TXT-0208':'设置菜单','TXT-0213':'设置菜单','TXT-0351':'绑定账号','TXT-0719':'照片查看与编辑','TXT-0721':'照片查看与编辑',
   'TXT-0816':'Plushie 收藏与购买','TXT-0842':'Touch Note 录制 / 播放 / 历史','TXT-0843':'Touch Note 录制 / 播放 / 历史',
   'TXT-0856':'Touch Note 录制 / 播放 / 历史','TXT-0857':'Touch Note 录制 / 播放 / 历史','TXT-0886':'Touch Note 录制 / 播放 / 历史','TXT-0915':'Touch Note 入口',
   'TXT-1608':'Tap Your Day','TXT-1645':'Adventure 发起页','TXT-2602':'Game Room 历史','TXT-2645':'Game Room 功能与结算',
   'TXT-2679':'Game Room 功能与结算','TXT-2688':'Release Room 功能与结算','TXT-2804':'Memories Room 问答与历史',
   'TXT-3096':'Quests 任务与奖励','TXT-3099':'Quests 任务与奖励','TXT-3902':'Plus 支付与恢复','TXT-3938':'金币商店',
   'TXT-3968':'Plus 权益与方案','TXT-3991':'Plus 权益与方案','TXT-4056':'订阅支付回执','TXT-4094':'Moments 时间线','TXT-4399':'burrow-store','TXT-0632':'房间公共控制页',
  }[entry.id];
  const candidates=originalRowPage==='Memories Room 问答与历史'?[base+'burrow/couple-journal-screen.tsx']:pages[originalRowPage]??originals;
  const expected=entry.id==='TXT-0719'?'Fit the face inside your plushie’s face opening.':entry.decision;
  assert.ok(candidates.some(p=>strings.get(p)?.includes(norm(expected))),entry.id+': '+expected);
 });
}
test('dynamic approved names, prices and outcome use the current partner/value without changing the result or cost',()=>{
 assert.ok(source('apps/mobile/app/(main)/room-interaction.tsx').includes('Add your face so ${partnerName} can give you a squeeze.'));
 const home=source(base+'burrow/home-art-scene.tsx');assert.ok(home.includes('Make {partnerRoom.name}’s day with a gift.'));assert.ok(home.includes('Fertilize your partner’s flower.'));
 const affection=source(base+'burrow/affection-gesture.tsx');assert.ok(affection.includes('A warm hug is on its way to ${name}.'));assert.ok(affection.includes('Your thanks are on their way to ${name}.'));
 const surprise=source(base+'burrow/surprise-room-screen.tsx');assert.ok(surprise.includes('Costs ${price} coins per send.'));assert.equal(surprise.split('${name} can view your surprise once it’s ready.').length-1,2);
 assert.ok(source(base+'burrow/game-room-screen.tsx').includes("session.result.outcome==='lose'?`${partnerName} won this round!`"));
 const store=source('apps/mobile/src/lib/burrow-store.ts');assert.ok(store.includes('Could not apply this room change. Please try again.'));assert.doesNotMatch(store,/Purchase could not be completed \(\$|Could not apply this room change \(\$/);
});
test('daily Plushie messaging cannot imply a restored quota; frame quota and technical upload limiter remain distinct',()=>{
 const errors=load('apps/mobile/src/lib/room-photo-errors.ts');
 for(const code of ['upload_limit','daily_limit_reached']){
  const message=errors.roomPhotoFailureMessage({body:{error:code}},'fallback');assert.doesNotMatch(message,/\b(?:tomorrow|today|Plus)\b/i);
 }
 assert.equal(errors.roomPhotoFailureMessage({body:{error:'upload_limit'}},'fallback'),'You’ve uploaded too many photos. Please try again later.');
 assert.match(errors.roomPhotoFailureMessage({body:{error:'daily_limit_reached'}},'fallback','frame'),/tomorrow/);
 assert.doesNotMatch(source(base+'burrow/room-photo.tsx'),/Today’s photo change for this toy|You already changed this toy’s photo today/);
 assert.ok(source('apps/mobile/app/(main)/room-interaction.tsx').includes('Oops, something went wrong. Please try again.'));
});
test('only the obsolete Add to Furnitures caption disappears; all real claim buttons and coin description remain',()=>{
 const s=source(base+'burrow/adventure-reward-screen.tsx');assert.doesNotMatch(s,/Add to Furnitures/);assert.ok(s.includes("item?.item_type!=='decor'"));
 assert.ok(s.includes("isCoins?'Add to your coins'"));assert.ok(s.includes("accessibilityLabel={emptyGift ? 'Finish adventure' : opened ? 'Claim'"));
});
test('singular update count and platform-aware rating feedback are presentation-only',()=>{
 const {UpdateBadge}=load(base+'burrow/update-badge.tsx',{'@/lib/burrow-attention':{badgeLabel:n=>n?String(n):''},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'react-native':{View:'View',Text:'Text',StyleSheet:{create:x=>x}}});
 assert.equal(UpdateBadge({count:1}).props.accessibilityLabel,'1 update');assert.equal(UpdateBadge({count:2}).props.accessibilityLabel,'2 updates');
 const rating=source(base+'rating/rating-prompt-sheet.tsx');assert.ok(rating.includes("Platform.OS === 'ios' ? 'iOS version: ' : 'Android version: '"));
 assert.ok(norm(rating).includes('Would you mind taking a moment to rate us? Every rating helps Burrow reach more people.'));
});
test('retired AI page cannot disclose obsolete copy, silently mark consent, forward a next target or invoke AI; conditional login copy remains visible',()=>{
 const retired=source('apps/mobile/app/(main)/ai-consent.tsx');assert.ok(retired.includes('<Redirect href="/(main)/(tabs)" />'));
 assert.doesNotMatch(retired,/markAiConsent|Gemini|DeepSeek|useLocalSearchParams|apiClient|fetch\(/);
 assert.ok(source('apps/mobile/app/(auth)/sign-in.tsx').includes('Your wisdoms and cards will be waiting for you.'));
});
test('visible Plushie terms include system permission overlays and accessibility; internal protocol names are preserved',()=>{
 const config=JSON.parse(source('apps/mobile/app.json')).expo,ios=config.ios.infoPlist;
 const permissions=[ios.NSPhotoLibraryUsageDescription,ios.NSCameraUsageDescription,...config.plugins.filter(x=>Array.isArray(x)).flatMap(x=>Object.entries(x[1]??{}).filter(([k])=>/Permission$/.test(k)).map(([,v])=>v)).filter(v=>typeof v==='string'&&/photo|camera|face/.test(v))];
 for(const text of permissions){assert.doesNotMatch(text,/\btoy\b|\bdoll\b/i);assert.match(text,/plushie/i);}
 assert.ok(source(base+'burrow/squishy-toy-controls.tsx').includes("'Squeeze plushie':'Bonk plushie'"));
 assert.ok(source(base+'burrow/interactive-doll.tsx').includes('Play with our plushies'));
 assert.ok(source('apps/mobile/src/lib/burrow-toy-photos.ts').includes("kind === 'doll'"));
});
test('withdrawn product rename leaves the whole catalog and all published capability sets unchanged',()=>{
 const manifest=JSON.parse(source('catalog/burrow-shop-products.json'));
 const p=manifest.products.find(p=>p.id==='burrow_kettle_01_07');assert.equal(p.title,'Rabbit Carrots');
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),'d7c69593f28a39eb21ee7e15b2e9a7ca5a992b1766ad677887a97c00cf7ddfad');
 const release=JSON.parse(source('catalog/generated/shop-catalog-release.json'));
 assert.equal(release.release,'5acf169b89ae03ad502a2f18797ae0e03b9aa59005e6e3104165845a63ff20f4');
 assert.equal(release.clients['68b83c9113fa987a24a94414cdf34dc9a2f1e9e0c6ec1923ed807c28e1050f91'],undefined);
 assert.equal(audit.entries.find(e=>e.id==='TXT-3724').status,'rename-revoked');
 assert.equal(fs.existsSync('supabase/migrations/20261029000290_reviewed_copy_client_support.sql'),false);
});
