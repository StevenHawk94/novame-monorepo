const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),crypto=require('node:crypto');
const {load,hooks,deferred,flush,clock}=require('./lifecycle-test-utils.cjs');
const presentation=load('apps/mobile/src/lib/paywall-presentation.ts');
const iosProduct=(value=3,unit='day',count=1)=>({id:'novame.plus.yearly',displayPrice:'$69.99',price:69.99,currency:'USD',introductoryPricePaymentModeIOS:'free-trial',
  subscriptionInfoIOS:{subscriptionGroupId:'group',introductoryOffer:{period:{unit,value},periodCount:count}}});
const phase=(period='P3D',cycles=1,price='0')=>({priceAmountMicros:price,billingPeriod:period,billingCycleCount:cycles,formattedPrice:price==='0'?'$0.00':'$69.99',priceCurrencyCode:'USD'});
const offer=(phases)=>({pricingPhasesAndroid:{pricingPhaseList:phases},offerTokenAndroid:'native-token',displayPrice:'$0.00',price:0,currency:'USD'});
for(const [v,u,c,label] of [[3,'day',1,'3 Days'],[1,'week',1,'1 Week'],[7,'day',1,'7 Days'],[1,'month',2,'2 Months'],[1,'year',1,'1 Year']])test(`iOS trial duration comes from the store: ${label}`,()=>{
  assert.equal(presentation.trialDurationText(presentation.iosTrialDuration(iosProduct(v,u,c)),true),label);
});
test('iOS handles current standardized and legacy trial metadata without a 3-day fallback',()=>{
  assert.equal(presentation.trialDurationText(presentation.iosTrialDuration({subscriptionOffers:[{type:'promotional',paymentMode:'free-trial',period:{unit:'day',value:100}},
    {type:'introductory',paymentMode:'free-trial',period:{unit:'week',value:2},periodCount:1}]})),'2 weeks');
  assert.equal(presentation.trialDurationText(presentation.iosTrialDuration({introductoryPriceSubscriptionPeriodIOS:'day',introductoryPriceNumberOfPeriodsIOS:'5'})),'5 days');
  for(const p of [null,{},iosProduct(0),iosProduct(-1),iosProduct(1,'unknown'),iosProduct(3,'day',0)])assert.equal(presentation.iosTrialDuration(p),null);
});
for(const [period,cycles,label] of [['P3D',1,'3 Days'],['P1W',1,'1 Week'],['P7D',2,'14 Days'],['P1M',1,'1 Month'],['P1M7D',1,'1 Month + 7 Days']])test(`Android trial duration comes from its selected offer: ${label}`,()=>{
  const value=presentation.androidTrialDuration(offer([phase(period,cycles),phase('P1Y',0,'69990000')]));
  assert.equal(presentation.trialDurationText(value,true),label);
});
test('Android rejects missing/invalid periods, unknown cycle counts and paid introductory phases',()=>{
  for(const phases of [[],[phase('')],[phase('P')],[phase('P0D')],[phase('P3D',0)],[phase('PT3H')],[phase('P3D',1,'100')],[{priceAmountMicros:'0'}]])
    assert.equal(presentation.androidTrialDuration(offer(phases)),null);
  assert.equal(presentation.trialDurationText(presentation.androidTrialDuration(offer([phase('P1W'),phase('P3D')]))),'1 week + 3 days');
});

const iapSource=fs.readFileSync('apps/mobile/src/lib/iap.ts','utf8'),iapAst=ts.createSourceFile('iap.ts',iapSource,99,true);
const functionNode=name=>iapAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
test('purchase, restore and offer selection stay frozen; receipt handler matches the approved IAP isolation revision',()=>{
  const before={isIOSIntroTrialEligible:'2f8e8c2dec594884e8ed848023910c156e242e1256288f41233d1c2eff83539d',isAndroidIntroTrialEligible:'c3b64c33721987089381290570017fae7e35f502ffe632cf94a647fb346165de',
    selectAndroidOffer:'3a0fd7e34bfcbc6e7144d238a5397d76dd3cdb9fc8238ccb87b639cfe74d6070',getSubscriptionPlanPricing:'c8fafcce75b1f3abe62239d56d1fb73dfb2f95aa76087fdb875295db4cb08fd4',
    purchaseSubscription:'aec35a7e6a7875b7577b7be1201be14c0c160580ecff2d8c337ad0de1a880aaf',restoreSubscriptions:'9f40542adc9cde7dd927aa073de1037c0b6a45f15003df9156a542c831406ac5',
    // User approved silent recovery isolation on 2026-10-24; executable cases
    // live in test-coin-iap-isolation.cjs rather than hiding this body change.
    handlePurchaseUpdate:'d0b4668fb33d13a665deb424b75b1063a066c5621e9304285df6235b3aaeecf1'};
  for(const [name,hash] of Object.entries(before))assert.equal(crypto.createHash('sha256').update(functionNode(name).body.getText(iapAst)).digest('hex'),hash,name);
});
function pricingModel(platform,products,eligible=true){
  const names=['hasFreePhase','isIOSIntroTrialEligible','isAndroidIntroTrialEligible','selectAndroidOffer','getSubscriptionPlanPricing','formatStoreCurrency','fetchStoreSubscriptionPricing'];
  const source=names.map(n=>functionNode(n).getText(iapAst)).join('\n')+'\nexports.pricing=fetchStoreSubscriptionPricing;';
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={},groups=[];
  vm.runInNewContext(code,{exports,Platform:{OS:platform},...presentation,fetchSubscriptionProducts:async()=>products,
    isEligibleForIntroOfferIOS:async id=>{groups.push(id);if(eligible instanceof Error)throw eligible;return eligible;},Intl,console:{warn(){}}});
  return {get:exports.pricing,groups};
}
for(const eligible of [true,false,new Error('store offline')])test(`iOS pricing and trial eligibility remain store-owned (${String(eligible)})`,async()=>{
  const h=pricingModel('ios',[iosProduct(1,'week'),{id:'novame.plus.monthly',displayPrice:'$9.99',price:9.99,currency:'USD'}],eligible),p=await h.get();
  assert.equal(p.yearly.displayPrice,'$69.99');assert.equal(p.monthlyAnnualized,'$119.88');assert.equal(p.yearlyPerMonth,'$5.83');
  assert.equal(p.yearlyTrialEligible,eligible===true);assert.equal(presentation.trialDurationText(p.yearlyTrialDuration),eligible===true?'1 week':null);assert.deepEqual(h.groups,['group']);
});
test('Android display uses the SAME selected offer as billing, not a different promotional period or trial price',async()=>{
  const p=await pricingModel('android',[{id:'novame.plus.yearly',currency:'JPY',subscriptionOffers:[offer([phase('P1Y',0,'69990000')]),offer([phase('P7D'),phase('P1Y',0,'69990000')])]},
    {id:'novame.plus.monthly',subscriptionOffers:[offer([phase('P1M',0,'9990000')])]}]).get();
  assert.equal(p.yearly.displayPrice,'$69.99');assert.equal(p.yearlyTrialEligible,true);assert.equal(presentation.trialDurationText(p.yearlyTrialDuration),'7 days');
});
test('non-USD prices are never replaced with sample screenshot amounts; missing store products reject',async()=>{
  const p=await pricingModel('ios',[{...iosProduct(),price:12000,displayPrice:'¥12,000',currency:'JPY'},{id:'novame.plus.monthly',price:1200,displayPrice:'¥1,200',currency:'JPY'}],false).get();
  assert.equal(p.yearly.displayPrice,'¥12,000');assert.ok(p.yearlyPerMonth.includes('1,000'));assert.ok(p.monthlyAnnualized.includes('14,400'));
  await assert.rejects(pricingModel('ios',[]).get(),/prices are temporarily unavailable/);
});

const jsx=(type,props)=>({type,props});
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(typeof x.type==='function'&&x.type.name==='Button'?x.type(x.props):x.props?.children)]:[];
const copy=x=>nodes(x).filter(n=>n.type==='Text').map(n=>typeof n.props.children==='string'?n.props.children:'').join(' ');
const pricing={yearly:{price:69.99,displayPrice:'$69.99',currency:'USD'},monthly:{price:9.99,displayPrice:'$9.99',currency:'USD'},monthlyAnnualized:'$119.88',yearlyPerMonth:'$5.83',yearlyTrialEligible:true,yearlyTrialDuration:[{unit:'day',value:3}]};
test('per-user estimates divide the actual unrounded store amount by two users and the billing months',()=>{
 assert.equal(presentation.perUserMonthlyPrice({price:39.99,currency:'USD'},'yearly'),'$1.67');
 assert.equal(presentation.perUserMonthlyPrice({price:6.99,currency:'USD'},'monthly'),'$3.50');
 assert.equal(presentation.perUserMonthlyPrice({price:69.99,currency:'USD'},'yearly'),'$2.92');
 assert.match(presentation.perUserMonthlyPrice({price:12000,currency:'JPY'},'yearly'),/500/);
 assert.match(presentation.perUserMonthlyPrice({price:48,currency:'EUR'},'yearly'),/2[.,]00/);
 assert.throws(()=>presentation.perUserMonthlyPrice({price:NaN,currency:'USD'},'monthly'));
});
function page(platform='ios',width=390,height=844,insets={top:20,bottom:platform==='ios'?20:0}){
  const source=fs.readFileSync('apps/mobile/src/components/paywall/burrow-paywall-page.tsx','utf8'),assets=Object.fromEntries([...source.matchAll(/require\('([^']+)'\)/g)].map(m=>[m[1],m[1]])),calls=[];
  const api=load('apps/mobile/src/components/paywall/burrow-paywall-page.tsx',{
    "../burrow/burrow-back-button":{BackIcon:'BackIcon',BurrowBackButton:'BackButton'},
    ...assets,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{...Object.fromEntries(['ActivityIndicator','Pressable','ScrollView','Text','View'].map(k=>[k,k])),Linking:{openURL:url=>calls.push(url)},Platform:{OS:platform},StyleSheet:{create:x=>x,hairlineWidth:1},useWindowDimensions:()=>({width,height})},
    'expo-image':{Image:'Image'},'@expo/vector-icons':{Feather:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>insets},'@/lib/paywall-presentation':presentation,
  });
  const props={phase:'benefits',pricing,plan:'yearly',onSelectPlan:p=>calls.push(p),onClose:()=>calls.push('close'),onBack:()=>calls.push('back'),onContinue:()=>calls.push('continue'),onPurchase:()=>calls.push('purchase'),onRestore:()=>calls.push('restore'),onRetry:()=>calls.push('retry')};
  const render=overrides=>api.BurrowPaywallPage({...props,...overrides});
  return {api,calls,render,props,button:(label,overrides)=>nodes(render(overrides)).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label)};
}
test('Choose Plan shows two-user totals, calculated per-user rows and truthful yearly savings, not screenshot sample prices',()=>{
 const h=page(),tree=h.render({phase:'plans'}),text=copy(tree);
 assert.ok(h.button('Yearly',{phase:'plans'}));assert.ok(h.button('Monthly',{phase:'plans'}));
 assert.match(text,/Yearly.*Best Deal.*\$69\.99 for 2 Users.*\$2\.92 per user\/month/);
 assert.match(text,/Monthly.*\$9\.99 for 2 Users.*\$5\.00 per user\/month/);
 assert.doesNotMatch(text,/12 Months|every month|\$39\.99|\$1\.67/);
 for(const price of [120,130])assert.doesNotMatch(copy(h.render({phase:'plans',pricing:{...pricing,yearly:{...pricing.yearly,price}}})),/Best Deal/);
 assert.doesNotMatch(copy(h.render({phase:'plans',pricing:{...pricing,yearly:{...pricing.yearly,currency:'EUR'}}})),/Best Deal/);
 const monthly=h.button('Monthly',{phase:'plans'});monthly.props.onPress();assert.equal(h.calls.at(-1),'monthly');
 const selected=h.button('Yearly',{phase:'plans'});assert.equal(selected.props.accessibilityState.selected,true);
 assert.equal(selected.props.style[0].backgroundColor,'#FFFFFF');assert.equal(selected.props.style[1].borderColor,'#583724');
});
for(const platform of ['ios','android'])for(const [width,height] of [[320,568],[390,844],[430,932]])test(`${platform} ${width}×${height}: nine benefits and plans scroll independently of a bounded footer`,()=>{
  const h=page(platform,width,height),benefits=h.render(),plans=h.render({phase:'plans'});
  assert.equal(h.api.PAYWALL_BENEFITS.length,9);for(const b of h.api.PAYWALL_BENEFITS)assert.ok(copy(benefits).includes(b.title),b.title);
  assert.ok(nodes(benefits).some(n=>n.type==='Image'&&n.props.source.endsWith('ob1-1.webp')));assert.ok(nodes(plans).some(n=>n.type==='Image'&&n.props.source.endsWith('ob1.webp')));
  const icons=nodes(benefits).filter(n=>n.type==='Image'&&n.props.source.includes('/paywall/'));
  assert.equal(icons.length,9);
  for(const icon of icons){
    assert.equal(icon.props.style.width,Math.max(44,110*Math.min(width/900,.6))*.85,'only benefit artwork shrinks by 15%, including the former minimum size');
    assert.equal(icon.props.style.height,icon.props.style.width);
    assert.equal(icon.props.contentFit,'contain');
  }
  const wordmark=nodes(benefits).find(n=>n.type==='Image'&&n.props.source.endsWith('ob1-1.webp'));
  assert.equal(wordmark.props.style.width,width*.59,'header artwork does not shrink');
  for(const tree of [benefits,plans]){
    const scroll=nodes(tree).find(n=>n.type==='ScrollView');assert.equal(scroll.props.style.flex,1);
    assert.ok(!nodes(scroll).some(n=>n.type==='Pressable'&&['Try For Free','Start Free Trial'].includes(n.props.accessibilityLabel)),'CTA stays outside scrolling content');
  }
  h.button('Close Plus offer').props.onPress();h.button('Back to Plus offer',{phase:'plans'}).props.onPress();assert.deepEqual(h.calls,['close','back']);
});
test('benefits header removes only transparent pixels, reduces the visual Plus gap 30%, and preserves logo scale',()=>{
  for(const [width,height]of [[320,568],[375,667],[390,844],[430,932],[440,956]]){
    const h=page('ios',width,height),tree=h.render(),metrics=h.api.paywallBenefitsHeader(width,height);
    const logo=nodes(tree).find(n=>n.type==='Image'&&n.props.source.endsWith('ob1-1.webp'));
    assert.equal(logo.props.style.width,width*.59);assert.equal(logo.props.style.height,width*.245);
    const frame=nodes(tree).find(n=>n.type==='View'&&n.props.style?.overflow==='hidden');
    assert.equal(frame.props.style.height,metrics.visibleHeight);
    assert.equal(-logo.props.style.top,metrics.cropTop);
    assert.ok(Math.abs(metrics.visibleHeight+metrics.cropTop+metrics.artHeight*.25-metrics.artHeight)<1e-9);
    assert.equal(metrics.plusGap,(metrics.artHeight*.25+8)*.7);
    const tag=nodes(tree).find(n=>n.type==='View'&&nodes(n).some(t=>t.type==='Text'&&t.props.children==='PLUS')&&Array.isArray(n.props.style));
    assert.equal(tag.props.style[1].marginTop,metrics.plusGap);
    assert.equal(tag.props.style[0].marginBottom,22*.7);
    assert.equal(nodes(tree).find(n=>n.type==='ScrollView').props.contentContainerStyle.paddingBottom,12);
  }
});
test('Pro Max default-size benefits fit above the fixed safe-area footer without reducing fonts or icons',()=>{
  for(const [width,height,top]of [[430,932,59],[440,956,62]]){
    const bottom=34,h=page('ios',width,height,{top,bottom}),tree=h.render(),all=nodes(tree);
    const metric=h.api.paywallBenefitsHeader(width,height),tag=all.find(n=>n.type==='View'&&Array.isArray(n.props.style)&&n.props.style[0]?.backgroundColor==='#FFCA4B');
    const rows=all.filter(n=>n.type==='View'&&Array.isArray(n.props.style)&&n.props.style[0]?.flexDirection==='row');
    assert.equal(rows.length,9);
    // Current English copy fits one title/description line per item except
    // Shape your home, whose description wraps to two at these widths.
    const rowHeight=rows.reduce((sum,row,index)=>{
      const icon=nodes(row).find(n=>n.type==='Image'),pad=row.props.style.at(-1).paddingVertical;
      const copyHeight=18+2+16*(index===8?2:1);
      return sum+Math.max(icon.props.style.height,copyHeight)+2*pad+(index<8?1:0);
    },0);
    const content=metric.marginTop+metric.visibleHeight+metric.plusGap+28+tag.props.style[0].marginBottom+rowHeight+6+12;
    const viewport=height-top-54-(10+54+15+28+bottom);
    assert.ok(content<=viewport,`${width}x${height}: ${content}pt content exceeds ${viewport}pt viewport`);
    for(const title of all.filter(n=>n.type==='Text'&&n.props.style?.lineHeight===18))assert.equal(title.props.style.fontSize,13);
  }
});
test('all trial promises depend on eligibility AND a valid dynamic duration, including old promotion entries',()=>{
  const h=page();assert.ok(h.button('Try For Free'));assert.ok(h.button('Start Free Trial',{phase:'plans'}));assert.match(copy(h.render({phase:'plans'})),/3 Days Free Trial/);
  const week={...pricing,yearlyTrialDuration:[{unit:'week',value:1}]};assert.match(copy(h.render({phase:'plans',pricing:week})),/1 Week Free Trial.*Free for 1 week/);
  for(const p of [{...pricing,yearlyTrialEligible:false},{...pricing,yearlyTrialDuration:null},{...pricing,yearlyTrialDuration:[]}]){
    assert.ok(h.button('Continue',{pricing:p}));assert.ok(h.button('Start My Plan',{phase:'plans',pricing:p}));assert.doesNotMatch(copy(h.render({phase:'plans',pricing:p})),/Free Trial|Free for/);
  }
  assert.ok(h.button('Start My Plan',{phase:'plans',plan:'monthly'}));assert.doesNotMatch(copy(h.render({phase:'plans',plan:'monthly'})),/Free for 3 days/);
  assert.ok(h.button('Manage Subscription',{phase:'plans',isPaid:true}));assert.doesNotMatch(copy(h.render({phase:'plans',isPaid:true})),/Free Trial/);
});
test('unknown prices never promise a trial or allow purchase; pending operations disable navigation and checkout',()=>{
  const h=page();assert.ok(h.button('Continue',{pricing:null}));assert.equal(h.button('Start My Plan',{phase:'plans',pricing:null}).props.disabled,true);
  for(const busy of ['purchasing','restoring','closing','openingPlans']){
    assert.equal(h.button('Close Plus offer',{[busy]:true}).props.disabled,true);assert.equal(h.button('Start Free Trial',{phase:'plans',[busy]:true}).props.disabled,true);
  }
  assert.ok(h.button('Retry prices',{pricing:null,priceError:true}));
});
test('restoration and legal controls are available in both platforms; platform-specific disclosure is accurate',()=>{
  for(const platform of ['ios','android']){
    const h=page(platform),tree=h.render({phase:'plans'});assert.match(copy(tree),platform==='ios'?/App Store settings/:/Google Play settings/);
    const links=nodes(tree).filter(n=>n.type==='Pressable'&&n.props.accessibilityRole==='link');links.forEach(n=>n.props.onPress());
    assert.deepEqual(h.calls,['https://www.burrow-app.com/privacy','https://www.burrow-app.com/terms']);
    const restore=nodes(tree).find(n=>n.type==='Pressable'&&copy(n)==='Restore purchases');restore.props.onPress();assert.equal(h.calls.at(-1),'restore');
  }
});

function controller(options={}){
  const h=hooks(),time=clock(),calls=[],alerts=[];let completed,failed;
  const module=load('apps/mobile/app/(main)/(modals)/subscription-paywall.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Platform:{OS:options.platform??'ios'},Linking:{openURL:url=>calls.push(url)}},
    '@/components/ui/app-dialog':{appAlert:(...a)=>alerts.push(a)},'expo-router':{router:{back:()=>calls.push('back'),canGoBack:()=>true,push:path=>calls.push(path)}},
    '@/lib/haptics':{haptics:{light(){},medium(){},pageOpen(){}}},'@/lib/iap':{onPurchaseComplete:fn=>{completed=fn;return()=>calls.push('offComplete');},onPurchaseError:fn=>{failed=fn;return()=>calls.push('offError');},
      purchaseSubscription:async sku=>{calls.push(sku);return options.outcome??{kind:'cancelled'};},restoreSubscriptions:async()=>options.restore??{restored:false}},
    '@/lib/subscription':{getCachedSubscription:()=>({tier:options.paid?'plus':'free'})},'@/lib/supabase':{supabase:{auth:{getUser:async()=>({data:{user:options.anonymous?{is_anonymous:true}:{email:'safe@example.com'}}})}}},
    '@/lib/home-refresh-signal':{emitHomeRefresh:()=>calls.push('refresh')},'@/lib/notification-settings':{shouldPromptNotifAfterPurchase:()=>true,markNotifPromptedAfterPurchase(){throw Error('Post-purchase notification must not be queued');}},
    '@/components/paywall/burrow-paywall-page':{BurrowPaywallPage:'Page'},'@/hooks/use-store-subscription-pricing':{useStoreSubscriptionPricing:()=>({pricing:options.pricing===null?null:pricing,status:'ready',load:()=>options.load??Promise.resolve(null),retry:async()=>calls.push('retry')})},
  },time.globals);
  const render=()=>h.render(()=>module.default({onContinue:()=>calls.push('analytics'),onClose:()=>calls.push('close')})).props;
  return {render,calls,alerts,h,time,complete:()=>completed(),fail:()=>failed({code:'pending',message:'Wait for store'})};
}
for(const platform of ['ios','android'])test(`${platform}: verified purchase keeps account safety but never opens or queues notification setup`,async()=>{
 const bound=controller({platform});bound.render();bound.complete();await flush();bound.time.advance(1000);
 assert.deepEqual(bound.calls,['refresh','back']);assert.equal(bound.alerts.length,0);bound.h.unmount();
 const guest=controller({platform,anonymous:true});guest.render();guest.complete();await flush();guest.time.advance(450);
 const first=guest.alerts.at(-1);assert.equal(first[0],'Keep your Plus safe');
 first[2].find(x=>x.text==='Later').onPress();guest.time.advance(150);
 const second=guest.alerts.at(-1);assert.equal(second[0],'Keep your account safe');
 const close=second[2].find(x=>x.text==='Close Anyway');close.onPress?.();guest.time.advance(1000);
 assert.deepEqual(guest.calls,['refresh','back']);
 second[2].find(x=>x.text==='Connect Account').onPress();
 const route=guest.calls.at(-1);assert.equal(route.pathname,'/(main)/(modals)/connect-account');
 assert.deepEqual(JSON.parse(JSON.stringify(route.params)),{source:'post-purchase'});
 assert.equal(guest.calls.some(x=>String(x).includes('notification-settings')),false);guest.h.unmount();
});
for(const platform of ['ios','android'])test(`${platform}: every main entry starts at benefits; back preserves selected plan, checkout still uses original SKUs`,async()=>{
  const h=controller({platform});let p=h.render();assert.equal(p.phase,'benefits');assert.equal(p.plan,'yearly');
  p.onContinue();await flush();p=h.render();assert.equal(p.phase,'plans');assert.deepEqual(h.calls,['analytics']);
  p.onSelectPlan('monthly');h.render().onBack();assert.equal(h.render().phase,'benefits');assert.equal(h.render().plan,'monthly');
  h.render().onContinue();await flush();h.render().onPurchase();await flush();assert.ok(h.calls.includes('novame.plus.monthly'));assert.equal(h.render().purchasing,false);
  h.render().onSelectPlan('yearly');h.render().onPurchase();await flush();assert.ok(h.calls.includes('novame.plus.yearly'));h.h.unmount();assert.equal(h.calls.filter(c=>c==='offComplete').length,1);
});
test('failed store loading stays on benefits without a purchasable placeholder; restore and purchase callbacks retain original routing',async()=>{
  const bad=controller({pricing:null});bad.render().onContinue();await flush();assert.equal(bad.render().phase,'benefits');assert.equal(bad.alerts[0][0],'Prices unavailable');bad.h.unmount();
  const good=controller({restore:{restored:true,tier:'plus'}});good.render().onRestore();await flush();assert.equal(good.alerts[0][0],'Restored');good.alerts[0][2][0].onPress();assert.ok(good.calls.includes('back'));good.h.unmount();
  const buy=controller({outcome:{kind:'completed'}});buy.render().onPurchase();await flush();assert.equal(buy.render().purchasing,true,'only verified completion may close');buy.complete();assert.equal(buy.render().purchasing,false);assert.ok(buy.calls.includes('refresh'));assert.ok(buy.calls.includes('back'));buy.h.unmount();
  const pending=controller({outcome:{kind:'completed'}});pending.render().onPurchase();await flush();pending.fail();assert.equal(pending.render().purchasing,false);assert.equal(pending.alerts.at(-1)[0],'Payment Pending');pending.h.unmount();
});
test('legacy promotional paths retain bookkeeping but neither Admin text nor variant params can produce another UI',()=>{
  const h=hooks(),calls=[];
  const reflection=load('apps/mobile/app/(main)/(modals)/reflection-plus-paywall.tsx',{react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'./subscription-paywall':{__esModule:true,default:'Unified'},
    '@/lib/reflection-paywall-count':{recordReflectionPaywallVariantShown:v=>{calls.push(v);}},'expo-router':{useLocalSearchParams:()=>({variant:'2'})}});
  assert.equal(h.render(reflection.default).type,'Unified');assert.deepEqual(calls,['2']);h.unmount();
  const r=hooks(),assignment={headline:'Do not render Admin variant copy'},partner=load('apps/mobile/app/(main)/(modals)/partner-reflect-paywall.tsx',{react:r.react,'react/jsx-runtime':{jsx,jsxs:jsx},'./subscription-paywall':{__esModule:true,default:'Unified'},
    'expo-router':{router:{back:()=>calls.push('back')}},'@/lib/partner-reflect-paywall':{getPartnerReflectPaywallAssignment:()=>assignment,clearPartnerReflectPaywallAssignment:()=>calls.push('clear'),recordPartnerReflectPaywallClick:a=>calls.push(a)}});
  const tree=r.render(partner.default);assert.equal(tree.type,'Unified');assert.doesNotMatch(JSON.stringify(tree),/Do not render/);tree.props.onContinue();assert.equal(calls.at(-2),assignment);r.unmount();
});
test('onboarding uses the same two presentations without another checkout controller or hardcoded trial days',()=>{
  const s=fs.readFileSync('apps/mobile/src/components/onboarding/burrow-onboarding-pages.tsx','utf8');assert.equal((s.match(/<BurrowPaywallPage/g)||[]).length,2);
  assert.match(s,/<BurrowPaywallPage phase="benefits"/);assert.match(s,/<BurrowPaywallPage phase="plans"/);assert.doesNotMatch(s,/3 Days Free Trial|3-day free trial|const BENEFITS/);
  assert.doesNotMatch(fs.readFileSync('apps/mobile/app/(main)/(modals)/subscription-paywall.tsx','utf8'),/params\.phase|GridBackground|plus-benefits/);
});
