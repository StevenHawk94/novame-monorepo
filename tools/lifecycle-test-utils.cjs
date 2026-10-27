const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
function load(file, imports = {}, globals = {}) {
  // Native wallet/queue boundaries added by the unified wallet. Keep old
  // component tests isolated; explicit implementations always take precedence.
  let coinSeams;
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if(name==='next/server'&&Object.hasOwn(imports,name))return{after(){},...imports[name]};
      if(name==='../shared/storage/keys'&&Object.hasOwn(imports,name))return {kPersonalRoomEdits:{keyFor:owner=>'personal-room-edits:'+owner},kShopPurchases:{name:'burrow.shop-purchases.v1'},kLoveNoteOutbox:{keyFor:owner=>'love-note-outbox:'+owner},kFramePhotoOutbox:{keyFor:owner=>'frame-outbox:'+owner},kPlushiePhotoOutbox:{keyFor:owner=>'plushie-outbox:'+owner},...imports[name]};
      if(name==='./coin-reward-store'&&file.endsWith('burrow-store.ts')&&Object.hasOwn(imports,name))return{
        projectCoinSpend(){},settleCoinSpend(){},rejectCoinSpend(){},getCoinRewardSnapshot:()=>({balance:null}),...imports[name]};
      if(['./ui-idle','@/lib/ui-idle'].includes(name)&&Object.hasOwn(imports,name))return {yieldToUi:async()=>{},...imports[name]};
      if(Object.hasOwn(imports,name))return imports[name];
      if(['./adventure-friend-identity','@/lib/adventure-friend-identity'].includes(name))return load('apps/mobile/src/lib/adventure-friend-identity.ts');
      if(name==='./adventure-friend-identities.json')return require('../apps/mobile/src/lib/adventure-friend-identities.json');
      if(['./friend-text-layout','@/lib/friend-text-layout','./friend-visit-presentation','@/lib/friend-visit-presentation'].includes(name))return load('apps/mobile/src/lib/'+name.split('/').at(-1)+'.ts');
      if(['./adventure-friend-bounds.json','./adventure-friend-body-anchors.json'].includes(name))return require('../apps/mobile/src/lib/'+name.slice(2));
      if(name==='./friend-text-panel')return load('apps/mobile/src/components/burrow/friend-text-panel.tsx',{
        react:imports.react??{createContext:value=>({value}),useContext:c=>c.value},'react/jsx-runtime':imports['react/jsx-runtime'],
        'react-native':{Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
        './adventure-reveal':{AdventureReveal:'Reveal'},'./burrow-back-button':{BackIcon:'BackIcon'},
      });
      if(name==='../../../assets/burrow-webp/adventure-page/pinky.webp'){
        assert.ok(fs.existsSync(path.resolve(__dirname,'../apps/mobile/assets/burrow-webp/adventure-page/pinky.webp')));
        return 'adventure-ready-pinky';
      }
      if(name==='../../../assets/burrow-webp/adventure-page/biscuit.webp'){
        assert.ok(fs.existsSync(path.resolve(__dirname,'../apps/mobile/assets/burrow-webp/adventure-page/biscuit.webp')));
        return 'adventure-ready-biscuit';
      }
      // Older UI fixtures have no authenticated transport. Dedicated entry
      // tests inject the real narrow prefetch controller and lifecycle hook.
      if(['./adventure-team-prefetch','@/lib/adventure-team-prefetch'].includes(name))return{prefetchAdventureTeam:async()=>{},preparedAdventureTeam:()=>undefined};
      if(name==='@/lib/use-adventure-team-prefetch')return{useAdventureTeamPrefetch(){}};
      if(name==='@/lib/plushie-touch-signals')return load('apps/mobile/src/lib/plushie-touch-signals.ts');
      if(name==='@/lib/bunny-adventure-contract.mjs')return load('apps/api/src/lib/bunny-adventure-contract.mjs');
      if(['./cooperative-adventure','@/lib/cooperative-adventure'].includes(name))return load('apps/mobile/src/lib/cooperative-adventure.ts');
      // Legacy tests isolate account-identity/native assets. Dual-bunny tests
      // inject the real identity store and generated registry explicitly.
      if(['./bunny-identity','@/lib/bunny-identity'].includes(name))return{bunnyVariant:()=> 'biscuit',useBunnyVariant:()=> 'biscuit',useBunnyIdentity:()=>undefined,adoptBunnyOnHome:async()=>{}};
      if(name==='@/lib/adventure-nudge')return{useAdventureNudge:()=> 'idle',queueAdventureNudge(){}};
      if(name==='@/lib/burrow-toast')return{showBurrowToast(){}};
      if(['./bunny-variant-assets','@/lib/bunny-variant-assets'].includes(name)){
        const generated='apps/mobile/src/lib/bunny-variant-assets.ts';
        const assets=Object.fromEntries([...fs.readFileSync(path.resolve(__dirname,'..',generated),'utf8').matchAll(/require\('([^']+)'\)|require\("([^"]+)"\)/g)].map(([,a,b])=>[a??b,a??b]));
        return load(generated,{'./burrow-outfit-assets':imports['./burrow-outfit-assets']??imports['@/lib/burrow-outfit-assets']??{OUTFIT_LAYERS:{}},...assets},globals);
      }
      // Legacy component/route tests isolate the limiter and store-queue
      // boundary. Dedicated security tests import the REAL implementations.
      if(name==='@/lib/security-boundary')return{
        securityRateLimit:async()=>{},
        securityFailure:error=>(imports['next/server']?.NextResponse??Response).json({error:error.message},{status:error.status??503}),
      };
      if(name==='@/lib/store-finish-jobs.mjs')return{drainStoreFinishJobs:async()=>({processed:0})};
      if(name==='@/lib/store-entitlement')return load('apps/api/src/lib/store-entitlement.js');
      if(['./native-image-decoder','../../lib/native-image-decoder','@/lib/native-image-decoder'].includes(name))return {
        decodeNativeImage:(...args)=>imports['expo-image'].Image.loadAsync(...args),
      };
      if(name==='@/lib/use-room-photo-uri')return load('apps/mobile/src/lib/use-room-photo-uri.ts',{
        react:imports.react,'react-native':imports['react-native'],'@react-navigation/native':imports['expo-router'],
        './burrow-room-photo-cache':imports['@/lib/burrow-room-photo-cache'],
        './session-lifecycle':imports['@/lib/session-lifecycle'],
      },globals);
      if(name==='./plushie-face-mask'&&file.includes('/components/'))return {PlushieFaceMask:'PlushieFaceMask'};
      if(['@/lib/plushie-face-mask','./plushie-face-mask'].includes(name))return load('apps/mobile/src/lib/plushie-face-mask.ts',{'./generated/plushie-face-masks.json':require('../apps/mobile/src/lib/generated/plushie-face-masks.json')});
      if(name==='./game-read-coordinator')return load('apps/mobile/src/lib/game-read-coordinator.ts');
      if(name==='./idle-snapshot-sharing')return load('apps/mobile/src/lib/idle-snapshot-sharing.ts');
      if(name==='./coin-operation-queue')return load('apps/mobile/src/lib/coin-operation-queue.ts');
      if(name==='./burrow-shop-categories')return load('apps/mobile/src/lib/burrow-shop-categories.ts');
      // Legacy native-boundary tests isolate quest display state; dedicated
      // quest-progress tests inject the real model/store and monetary outbox.
      if(['./quest-progress-store','@/lib/quest-progress-store'].includes(name))return{
        questProgress:{fact(){},claim(){},project:d=>d,unproject:d=>d,observe(){},reset(){}},
        captureQuestFact:()=>undefined,currentQuestData:()=>null,guardQuestClaim(){},configureQuestProgress(){},subscribeQuestProgress:()=>()=>{},
      };
      if(['./quest-progress-model','@/lib/quest-progress-model'].includes(name))return load('apps/mobile/src/lib/quest-progress-model.ts');
      if(name==='./burrow-daily-entry')return load('apps/mobile/src/lib/burrow-daily-entry.ts',{'./burrow-local-day':load('apps/mobile/src/lib/burrow-local-day.ts')});
      if(name==='./burrow-local-day')return load('apps/mobile/src/lib/burrow-local-day.ts',{}, {Intl,Date});
      if(name==='./coin-reward-store'&&file.endsWith('toy-interaction-records.ts'))return{
        coinRewardDefinitelyRejected:e=>['invalid_request','own_toy_only','pair_changed','not_paired'].includes(e?.body?.error??e?.message),
      };
      if(name==='./generated/shop-catalog-version')return load('apps/mobile/src/lib/generated/shop-catalog-version.ts');
      // Use the real generated permanent-ID bindings with the same native asset
      // values supplied by each old registry fixture (not an empty mock map).
      if(name==='./generated/shop-product-art'){
        const generated='apps/mobile/src/lib/generated/shop-product-art.ts';
        const assets=Object.fromEntries([...fs.readFileSync(path.resolve(__dirname,'..',generated),'utf8')
          .matchAll(/require\("([^\"]+)"\)/g)].map(([,asset])=>[asset,
            imports[asset.replace('../../../assets/','../../assets/')]??asset.replace('../../../assets/','../../assets/')]));
        return load(generated,assets,globals);
      }
      if(name==='@/lib/shop-catalog-release.mjs')return load('apps/api/src/lib/shop-catalog-release.mjs',{
        '../../../../packages/domain/src/generated/shop-catalog-release.json':require('../packages/domain/src/generated/shop-catalog-release.json')});
      if(name==='./adventure-duration')return load('apps/mobile/src/lib/adventure-duration.ts');
      if(name==='@/components/main/partner-connection-gate')return{PartnerConnectionGate:'PartnerConnectionGate'};
      if(['./account-profile-local','@/lib/account-profile-local'].includes(name))return {
        accountProfileRevision:()=>0,projectAccountProfile:p=>p,subscribeAccountProfile:()=>()=>{},
        syncAccountProfile:async()=>{},cachedAccountProfile:()=>null,accountProfileSyncError:()=>'',
      };
      // Legacy component fixtures have a phone-sized RN window. Dedicated
      // viewport tests exercise the real provider and native-overlay boundary.
      if(['@/lib/app-viewport','./app-viewport'].includes(name))return {
        useAppViewport:()=>imports['react-native'].useWindowDimensions(),
        useAppWindowGeometry:()=>({left:0,top:0}),
        getAppViewport:()=>imports['react-native'].Dimensions.get('window'),
      };
      if(['@/components/layout/app-modal','./app-modal'].includes(name))return {AppModal:imports['react-native']?.Modal??'Modal'};
      if(['@/components/layout/app-window-layer','./app-window-layer'].includes(name))return {AppWindowLayer:'AppWindowLayer'};
      if(name==='@/lib/push-notifications')return{drainPushNotificationOutbox:async()=>({sent:0})};
      if(name==='./widget-policy')return{widgetUpdatesEnabled:()=>false};
      if(name==='./system-notification-copy.mjs')return load('apps/api/src/lib/system-notification-copy.mjs');
      if(name==='./burrow-motion')return load('apps/mobile/src/lib/burrow-motion.ts');
      if(['./adventure-treasure-reward','@/lib/adventure-treasure-reward'].includes(name))return load('apps/mobile/src/lib/adventure-treasure-reward.ts');
      if(['./adventure-treasure-art','@/lib/adventure-treasure-art'].includes(name))return load('apps/mobile/src/lib/adventure-treasure-art.ts',{'../../assets/burrow-webp/Coin-purchase-page/400.webp':'400.webp'});
      // Avatar persistence is covered with the real module in dedicated tests.
      if(name==='@/lib/profile-avatar-local')return{localProfileAvatarUri:()=>null,subscribeLocalProfileAvatar:()=>()=>{},syncLocalProfileAvatar:async()=>{},onProfileAvatarCommitted:()=>()=>{}};
      if(name==='@/components/me/profile-avatar-editor')return{ProfileAvatarEditor:'AvatarEditor'};
      if(name==='@/lib/redeem-offer')return{openOfficialRedeemCode:async()=>{}};
      if(file.endsWith('(main)/_layout.tsx')&&name==='@/lib/session-lifecycle')return{sessionUserId:()=>null};
      if(file.endsWith('(main)/_layout.tsx')&&name==='@/lib/me-stats')return{invalidateMeStats(){},fetchMeStats:async()=>{}};
      if(file.endsWith('(main)/_layout.tsx')&&name==='@/lib/burrow-store')return{scheduleBurrowRefresh(){}};
      if(name==='@/components/burrow/plushie-room-background')return{PlushieRoomBackground:'PlushieRoomBackground'};
      if(name==='@/lib/plushie-room-layout')return load('apps/mobile/src/lib/plushie-room-layout.ts');
      if(name==='./plushie-photo-outbox')return load('apps/mobile/src/lib/plushie-photo-outbox.ts',{},globals);
      if(name==='./love-note-outbox')return load('apps/mobile/src/lib/love-note-outbox.ts',{},globals);
      if(name==='./journal-outbox')return load('apps/mobile/src/lib/journal-outbox.ts',{},globals);
      // Other store tests isolate this independently persisted text domain.
      if(name==='./couple-journal'&&file.endsWith('burrow-store.ts'))return{configureJournal(){},observeJournalAppState(){}};
      if(name==='./burrow-text-drafts'&&file.endsWith('couple-journal.ts'))return{removeBurrowTextDraft(){}};
      if(name==='./love-note-model')return load('apps/mobile/src/lib/love-note-model.ts',{},globals);
      if(name==='@/lib/affection-inbox')return load('apps/mobile/src/lib/affection-inbox.ts',{},globals);
      // Native file I/O is isolated in legacy store tests. Dedicated photo
      // cache + store tests provide the real adapter and filesystem seams.
      if(name==='./burrow-room-photo-cache'&&file.endsWith('burrow-store.ts'))return {
        keepRoomPhotoPreview:async()=>{},adoptRoomPhotoPreview(){},invalidateRoomPhotoCache(){},
      };
      if(['./avatar','@/lib/avatar'].includes(name))return load('apps/mobile/src/lib/avatar.ts');
      if(name==='@/components/ui/user-avatar')return{UserAvatar:'UserAvatar'};
      if(name==='./plushie-photo-cropper')return{PlushiePhotoCropper:'PlushiePhotoCropper'};
      if(name==='@/lib/room-header-typography')return load('apps/mobile/src/lib/room-header-typography.ts',{'react-native':{Platform:{OS:'ios'}}});
      if(name==='./burrow-moment-names.json')return require('../apps/mobile/src/lib/burrow-moment-names.json');
      if(name==='@/components/burrow/burrow-toast-host')return{BurrowToastHost:'BurrowToastHost'};
      if(name==='@/lib/tap-day-display-order'){
        const engine=load('packages/engine/src/items/tap-your-day.ts',Object.fromEntries(
          ['v1','v2','v4','local'].map(v=>['./tap-your-day-'+v+'.json',require('../packages/engine/src/items/tap-your-day-'+v+'.json')])));
        return load('apps/mobile/src/lib/tap-day-display-order.ts',{'@novame/engine':engine});
      }
      if(['@/lib/burrow-toast','./burrow-toast'].includes(name))return{showBurrowToast(){},clearBurrowToast(){}};
      if(name==='@/lib/room-history-entry')return{prepareGameHistoryEntry:async()=>false,prepareSurpriseHistoryEntry:async()=>false};
      if(name==='@/lib/use-page-back-gesture')return{usePageBackGesture(){}};
      if(name==='./adventure-gift-collection')return{AdventureGiftCollection:'AdventureGiftCollection'};
      if(name==='@/lib/burrow-shop-gifts.mjs')return load('apps/api/src/lib/burrow-shop-gifts.mjs');
      if(name==='./shop-gift-preparation')return{prepareShopGifts:async()=>{},shopGiftsPrepared:()=>false,preparedShopGiftIds:()=>[]};
      if(name==='./shop-gift-queue')return load('apps/mobile/src/lib/shop-gift-queue.ts',{
        './shop-gift-model':load('apps/mobile/src/lib/shop-gift-model.ts'),
        './notification-content-version':load('apps/mobile/src/lib/notification-content-version.ts')});
      if(name==='./shop-gift-model')return load('apps/mobile/src/lib/shop-gift-model.ts');
      if(name==='./shop-gift-inbox')return{ShopGiftInbox:'ShopGiftInbox'};
      if(name==='@/lib/burrow-surface')return load('apps/mobile/src/lib/burrow-surface.ts');
      if(name==='./native-vertical-gradient')return{NativeVerticalGradient:'Gradient'};
      if(name==='@/lib/burrow-destination-preload')return{useBurrowDestinationPreload(){}};
      if(name==='@/lib/burrow-destination-model')return load('apps/mobile/src/lib/burrow-destination-model.ts');
      if(name==='@/lib/game-room-layout')return load('apps/mobile/src/lib/game-room-layout.ts');
      if(name==='@/lib/adventure-presentation-clock')return load('apps/mobile/src/lib/adventure-presentation-clock.ts');
      if(['./notification-content-version','@/lib/notification-content-version','./notification-readiness','@/lib/notification-readiness'].includes(name))
        return load('apps/mobile/src/lib/'+name.split('/').at(-1)+'.ts',{},globals);
      // Navigation tests can isolate non-target destinations. Dedicated
      // notification tests exercise the real preparation and cache adapters.
      if(file.endsWith('burrow-page-entry.ts')&&name==='./couple-journal')return{cachedCoupleJournal:()=>null,preparedCoupleJournalVersion:()=>undefined,prepareCoupleJournal:async()=>{}};
      if(file.endsWith('burrow-page-entry.ts')&&name==='./use-love-notes')return{prepareLoveNotes:async()=>{},loveNotesReady:()=>true};
      if(file.endsWith('burrow-page-entry.ts')&&name==='./burrow-attention')return{unreadBurrowUpdateIds:()=>[]};
      if(file.endsWith('burrow-foreground-prewarm.ts')&&name==='./burrow-route-modules')return{burrowRouteModuleJobs:()=>[]};
      if(file.endsWith('burrow-sync-gate.tsx')&&name==='@/lib/burrow-notification-preparation')return{prepareBurrowNotifications:async()=>{}};
      if(['./ui-work-priority','@/lib/ui-work-priority','./interaction-timing','@/lib/interaction-timing',
        './retained-page-model','@/lib/home-design-handoff'].includes(name))
        return load('apps/mobile/src/lib/'+name.split('/').at(-1)+'.ts',{},globals);
      if(name==='@/lib/bunny-idle-scheduling')return load('apps/mobile/src/lib/bunny-idle-scheduling.ts',{},globals);
      // The actual RN AnimatedProps graph is covered separately against the
      // installed runtime; lifecycle tests keep the host as a plain element.
      if(name==='./retained-tab-scene')return{AnimatedTabScene:'AnimatedView'};
      if(['./ui-idle','@/lib/ui-idle'].includes(name))return {
        yieldToUi:async()=>{},
        afterUiSettles(task){let live=true;Promise.resolve().then(()=>{if(live)task();});return()=>{live=false;};},
        stageForegroundJobs(){return()=>{};},
      };
      if(['./user-error-message','@/lib/user-error-message'].includes(name))return load('apps/mobile/src/lib/user-error-message.ts');
      if(['./interaction-preferences','@/lib/interaction-preferences'].includes(name))return load('apps/mobile/src/lib/interaction-preferences.ts',{
        './storage':{storage:{getString(){},set(){}}},'../shared/storage/keys':{kInteractionPreferences:{name:'preferences'}}
      });
      if(['./room-edit-queue','./room-edit-design','@/lib/room-edit-design'].includes(name)){
        const base='apps/mobile/src/lib/';
        const presentation=imports['./burrow-presentation']??imports['@/lib/burrow-presentation']??load(base+'burrow-presentation.ts',{'@novame/engine':{}});
        return load(base+(name.endsWith('room-edit-queue')?'room-edit-queue':'room-edit-design')+'.ts',{'./burrow-presentation':presentation});
      }
      if(name==='@/lib/home-art-preparation')return {prepareHomeArt:async()=>{},isHomeArtPrepared:()=>false};
      if(name==='./api'&&file.endsWith('burrow-store.ts'))return{apiClient:{post:async()=>{throw Error('offline');}}};
      if(name==='./storage'&&file.endsWith('burrow-store.ts'))return{storage:{getString(){},set(){}}};
      if(name==='../shared/storage/keys'&&file.endsWith('burrow-store.ts'))return{kPersonalRoomEdits:{keyFor:owner=>'personal-room-edits:'+owner},kShopPurchases:{name:'burrow.shop-purchases.v1'},kLoveNoteOutbox:{keyFor:owner=>'love-note-outbox:'+owner},kFramePhotoOutbox:{keyFor:owner=>'frame-outbox:'+owner},kPlushiePhotoOutbox:{keyFor:owner=>'plushie-outbox:'+owner},kBurrowRoomEdits:{keyFor:owner=>'room-edits:'+owner}};
      if(name==='@/lib/personal-room-contract.mjs')return load('apps/api/src/lib/personal-room-contract.mjs');
      if(name==='./coin-purchase-prompt'&&file.endsWith('burrow-store.ts'))return{showCoinPurchaseSuccess(){},showCoinPurchaseNotice(){}};
      if(name==='./official-rating-milestones'&&file.endsWith('burrow-store.ts'))return{trackItemPurchaseForRating:p=>p};
      if(name==='./official-rating-milestones'&&file.endsWith('coin-command-outbox.ts'))return{recordRatingMilestone(){}};
      // Layered artwork has its own pixel/renderer tests; lifecycle tests keep
      // native image/decode boundaries inert unless explicitly provided.
      if(name==='./window-artwork')return{WindowArtwork:'WindowArtwork',SeasonalWindowArtwork:'SeasonalWindowArtwork'};
      if(['./coin-wallet','./coin-wallet-face','@/lib/coin-wallet-layout','./coin-wallet-context','@/lib/coin-wallet-registry',
        '@/components/layout/adaptive-app-frame','./coin-command-outbox','@/lib/coin-command-outbox'].includes(name)){
        coinSeams??=require('./coin-test-imports.cjs')(load,imports);return coinSeams[name];
      }
      assert.fail(name);
    }, ...globals });
  return module.exports;
}
function clock(initial = 10000) {
  let now = initial, next = 0;
  const timers = new Map();
  const globals = {
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return { globals, timers, advance(ms) {
    const end = now + ms;
    let count = 0;
    while (true) {
      const entry = [...timers].sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      assert.ok(count++ < 1000, 'timer loop'); now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = end;
  } };
}
function hooks() {
  const slots = [], effects = [];
  let cursor = 0;
  const react = {
    createContext(value){return {value,Provider:({children})=>children};},useContext(context){return context.value;},
    memo(component) { return component; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useCallback(fn, deps) { const i=cursor++, old=slots[i];
      if (!old || deps.some((v,n) => v !== old.deps[n])) slots[i] = { deps, fn }; return slots[i].fn; },
    useMemo(factory, deps) { const i=cursor++, old=slots[i];
      if (!old || deps.some((v,n) => v !== old.deps[n])) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useSyncExternalStore(_subscribe,getSnapshot) { return getSnapshot(); },
    useEffect(fn, deps) { const i=cursor++, old=slots[i];
      if (!old || deps.some((v,n) => v !== old.deps[n])) {
        const slot = slots[i] = { deps };
        effects.push(() => { old?.cleanup?.(); slot.cleanup=fn(); });
      } },
  };
  react.useLayoutEffect=react.useEffect;
  return { react, render(fn) { cursor=0; const result=fn(); effects.splice(0).forEach(fn=>fn()); return result; },
    unmount() { slots.forEach(slot=>slot?.cleanup?.()); } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
module.exports = { load, clock, hooks, deferred, flush: () => new Promise(setImmediate) };
