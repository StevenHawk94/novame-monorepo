import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { showInsufficientCoins } from '@/lib/insufficient-coins';
import { useCoinPurchaseConfirmation } from '@/lib/use-coin-purchase-confirmation';
import { burrowErrorMessage, getBurrowSnapshot, enqueueBurrowPlushie, refreshBurrow,
  enqueueBurrowRoomEdit, useBurrow } from '@/lib/burrow-store';
import { roomSlots } from '@/lib/burrow-presentation';
import { toyCollectionItems, toyRoomLoadout, toyScope, toyShopItems } from '@/lib/toy-collection';
import { sessionEpoch } from '@/lib/session-lifecycle';
import { haptics } from '@/lib/haptics';
import { openPreparedBurrow } from '@/lib/burrow-page-entry';
import { BurrowBackButton } from './burrow-back-button';
import { ToyPortrait } from './toy-portrait';
import { CoinLabel } from './coin-ui';
import {CoinWallet} from './coin-wallet';
import {coinWalletWidth,homeWalletFontSize} from '@/lib/coin-wallet-layout';
import { toyPhotoFor } from '@/lib/burrow-toy-photos';
import { ShopItemPrice } from './shop-item-price';

const brown = '#4C2B1E';
function Action({ label, onPress, disabled, gold = false }: {
  label: string; onPress: () => void; disabled?: boolean; gold?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    accessibilityState={{disabled:!!disabled}}
    style={({ pressed }) => [s.action, gold && s.goldAction, (disabled || pressed) && { opacity: .5 }]}>
    <CoinLabel style={[s.actionText, gold && { color: brown }]}>{label}</CoinLabel>
  </Pressable>;
}

export function ToyCollectionScreen({ shop = false }: { shop?: boolean }) {
  const { data, loading } = useBurrow(false,shop?'shop':'plushie');
  const insets = useSafeAreaInsets();
  if (!data) return <View style={[s.root, { paddingTop: insets.top }]}>
    <BurrowBackButton onPress={() => router.back()}/><View style={s.center}>
      {loading ? <ActivityIndicator color={brown}/> : <><Text style={s.description}>Your toys could not load.</Text>
        <Pressable onPress={() => void refreshBurrow()}><Text style={s.link}>Retry</Text></Pressable></>}
    </View>
  </View>;
  return <Collection key={`${toyScope(data)}:${shop}`} data={data} shop={shop}/>;
}

function Collection({ data, shop }: { data: MajorUpdateBootstrap; shop: boolean }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const contentWidth = Math.min(width, 540);
  const walletFontSize=homeWalletFontSize(width,height);
  // Equal side lanes center the title on the screen, not in the space left by
  // an asymmetric back button and wallet. Shrink the title on narrow phones.
  const headerSideWidth=shop?Math.max(44,coinWalletWidth(data.wallet.balance,walletFontSize,false)):44;
  const owned = toyCollectionItems(data), available = toyShopItems(data);
  const current = roomSlots(data, data.profile.id).couple_doll?.stable_id;
  const [selected, setSelected] = useState<string | null>(() => owned.some(item => item.stable_id === current) ? current! : owned[0]?.stable_id ?? null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false), mounted = useRef(true), scope = toyScope(data), epoch = sessionEpoch();
  const checkout = useCoinPurchaseConfirmation(scope);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (messageTimer.current) clearTimeout(messageTimer.current); }; }, []);
  useEffect(() => {
    if (!owned.some(item => item.stable_id === selected)) setSelected(owned[0]?.stable_id ?? null);
  }, [data.inventory, data.catalog, selected]);
  const stillSameAccount = () => {
    const latest = getBurrowSnapshot().data;
    return epoch === sessionEpoch() && !!latest && toyScope(latest) === scope;
  };
  const showMessage = (text: string, transient = false) => {
    if (!mounted.current) return;
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage(text);
    if (transient) messageTimer.current = setTimeout(() => setMessage(''), 2500);
  };
  const photoFor = (toyId: string) => toyPhotoFor(data.roomPhotos, data.profile.id, toyId);
  const detail = data.catalog.find(item => item.stable_id === detailId);
  const detailOwned = !!detail && owned.some(item => item.stable_id === detail.stable_id);

  async function switchToy() {
    if (!selected || lock.current) return;
    let queued=false;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const latest = getBurrowSnapshot().data;
      if (!latest || !stillSameAccount()) return;
      const ids = toyRoomLoadout(latest, selected);
      // Reuse Decorate's durable, scoped queue. An owned switch never waits
      // for the network and never purchases an unowned toy as a side effect.
      enqueueBurrowRoomEdit(ids, [], 'Plushie', 0);
      queued=true;
      void haptics.success();
      if (mounted.current) router.back();
    } catch (error) { if (stillSameAccount()) showMessage(burrowErrorMessage(error instanceof Error ? error.message : 'network_error')); }
    finally { if(!queued)lock.current=false;if (mounted.current) setBusy(false); }
  }

  async function buyToy() {
    if (!detail || detailOwned || lock.current) return;
    const item = available.find(row => row.stable_id === detail.stable_id);
    if (!item) return;
    if (item.plus_only && !data.hasPlus) { router.push('/(main)/(modals)/subscription-paywall'); return; }
    if ((item.price ?? 0) > 0 && (item.price ?? 0) > data.wallet.balance) {
      showInsufficientCoins(); return;
    }
    lock.current = true;
    try {
      if((item.price??0)>0&&!await checkout.confirm({name:item.title,price:item.price!,
        artwork:<ToyPortrait item={item} width={140} height={175}/>}))return;
      if(!checkout.isCurrent()||!stillSameAccount())return;
      setBusy(true); setMessage('');
      enqueueBurrowPlushie(item.stable_id);
      void haptics.success();
    } catch(error) {
      if(stillSameAccount()){
        if(error instanceof Error&&error.message==='insufficient_balance')showInsufficientCoins();
        else showMessage(burrowErrorMessage(error instanceof Error?error.message:'network_error'));
      }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  const cardWidth = (contentWidth - 24 - 3 * 8) / 4;
  const cellWidth = (contentWidth - 24 - 2 * 9) / 3;
  const toyHeight = cellWidth * 1.3;
  // Empty collection slots are decorative, not locked products or ownership.
  const cells = Array.from({length:Math.max(12,Math.ceil(owned.length/3)*3)},(_,index)=>owned[index]??null);
  const goBack = () => {
    if (detailId && !busy) { setDetailId(null); setMessage(''); }
    else if (!busy) router.back();
  };
  return <View style={s.root}>
    <View style={[s.header,{paddingTop:insets.top,height:insets.top+64}]}>
      <View style={{width:headerSideWidth}}><BurrowBackButton light onPress={goBack}/></View>
      <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.6}
        style={s.title}>{shop ? 'Plushies Shop' : 'Plushies Collection'}</Text>
      <View style={{width:headerSideWidth,alignItems:'flex-end'}}>{shop&&<CoinWallet balance={data.wallet.balance} fontSize={walletFontSize} showAdd={false} onPress={()=>router.push('/(main)/coin-shop')}/>}</View></View>
    <View style={[s.body, { maxWidth: 540 }]}>
      {!shop ? <>
        <FlatList style={s.collectionGrid} data={cells} numColumns={3} keyExtractor={(item,index)=>item?.stable_id??`empty:${index}`}
          bounces={false} alwaysBounceVertical={false} overScrollMode="never" showsVerticalScrollIndicator={false}
          initialNumToRender={12} maxToRenderPerBatch={9} windowSize={5}
          contentContainerStyle={s.collectionList} columnWrapperStyle={s.collectionRow}
          renderItem={({ item }) => !item?<View pointerEvents="none" accessible={false} accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants" style={[s.toyCell,{width:cellWidth,minHeight:toyHeight+46}]}/>:<Pressable disabled={busy}
                accessibilityRole="button" accessibilityLabel={`Select ${item.title}`} accessibilityState={{ selected: item.stable_id === selected }}
                onPress={() => { setSelected(item.stable_id); setMessage(''); void haptics.selection(); }}
                style={[s.toyCell, { width: cellWidth,minHeight:toyHeight+46 }]}>
                <ToyPortrait item={item} photo={photoFor(item.stable_id)} width={cellWidth - 12} height={toyHeight}/>
                {item.stable_id === selected && <View style={s.check}><Feather name="check" color="#FFF8EC" size={17}/></View>}
                <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={.85} style={s.toyName}>{item.title}</Text>
              </Pressable>}/>
        {!!message && <Text accessibilityRole="alert" style={s.message}>{message}</Text>}
        <View style={[s.footer, {paddingHorizontal:contentWidth*.09,paddingBottom: Math.max(16, insets.bottom) }]}>
          <Action label="Buy More" gold disabled={busy} onPress={() => openPreparedBurrow('/(main)/toy-shop')}/>
          <Action label={busy ? 'Switching…' : 'Switch'} disabled={busy || !selected || selected === current} onPress={() => void switchToy()}/>
        </View>
      </> : <>
        <View style={s.shopIntro}><Text style={s.description}>Each Plushie gets its own photo of Babe.</Text></View>
        {detail ? <ScrollView bounces={false} overScrollMode="never" contentContainerStyle={s.detail} showsVerticalScrollIndicator={false}>
          <ToyPortrait item={detail} photo={photoFor(detail.stable_id)} width={Math.min(290, contentWidth - 48)} height={Math.min(340, Math.max(160, (height - insets.top - insets.bottom) * .42))}/>
          <Text style={s.detailTitle}>{detail.title}</Text><Text style={s.description}>{detail.description}</Text>
          {!!message && <Text accessibilityRole="alert" style={s.message}>{message}</Text>}
          <View style={[s.detailFooter, { paddingBottom: Math.max(14, insets.bottom) }]}>
            <Action label={busy ? 'Buying…' : detailOwned ? 'View collection' : `Buy · {coin} ${detail.price ?? 0}${detail.plus_only && !data.hasPlus ? ' · Plus' : ''}`}
              disabled={busy} onPress={() => detailOwned ? router.back() : void buyToy()}/>
            <Text style={s.small}>Purchasing adds it to your collection and places it in your room.</Text>
          </View>
        </ScrollView> : <FlatList data={available} numColumns={4} keyExtractor={item => item.stable_id}
          bounces={false} overScrollMode="never" showsVerticalScrollIndicator={false} initialNumToRender={16} maxToRenderPerBatch={8} windowSize={5}
          contentContainerStyle={[s.shopList, { paddingBottom: insets.bottom + 24 }]} columnWrapperStyle={s.shopRow}
          ListEmptyComponent={<View style={s.empty}><Feather name="heart" size={35} color={brown}/><Text style={s.detailTitle}>Collection complete!</Text><Text style={s.description}>You own every toy currently available.</Text></View>}
          renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.title}, ${item.price} carrots`}
            onPress={() => { setDetailId(item.stable_id); setMessage(''); }} style={[s.shopCard, { width: cardWidth }]}>
            <ToyPortrait item={item} photo={photoFor(item.stable_id)} width={cardWidth - 12} height={cardWidth * 1.35}/>
            <Text numberOfLines={2} style={s.shopName}>{item.title}</Text>
            <ShopItemPrice item={item} hasPlus={data.hasPlus} owned={false} fontSize={11}/>
          </Pressable>}/>}</>}
    </View>
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF6E8' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  body: { flex: 1, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, gap:8, backgroundColor:brown },
  title: { flex:1,minWidth:0,fontSize:20,fontWeight:'800',color:'#FFFFFF',textAlign:'center' },
  collectionGrid:{flex:1},collectionList:{paddingHorizontal:12,paddingTop:16,paddingBottom:12,gap:9},collectionRow:{gap:9},
  toyCell: { alignItems: 'center', borderRadius: 18, backgroundColor:'#F6EADB',paddingHorizontal:6,paddingVertical:8 },
  check: { position: 'absolute', right: 5, top: 5, borderRadius: 14, width: 25, height: 25, backgroundColor: '#C66B4B', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF6E8' },
  toyName: { color: brown, fontSize: 12,lineHeight:15,minHeight:26,fontWeight:'800',textAlign:'center',marginTop:4,width:'100%' },
  footer: { flexDirection: 'row', gap: 24,paddingTop:14, backgroundColor: '#FFF6E8' }, action: { flex: 1, minHeight: 52, backgroundColor: '#50351D', borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  goldAction:{backgroundColor:'#F5C76D'},actionText: { fontSize: 17, fontWeight: '800', color: '#FFF8EC', textAlign: 'center' },
  description: { color: '#745541', fontSize: 15, lineHeight: 22, textAlign: 'center' }, link: { color: brown, fontWeight: '700', padding: 12 }, message: { color: '#86432C', fontSize: 14, lineHeight: 20, textAlign: 'center', padding: 10 },
  shopIntro: { padding: 18, gap: 12, alignItems: 'center' },
  shopList: { paddingHorizontal: 12, gap: 10, flexGrow: 1 }, shopRow: { gap: 8 }, shopCard: { borderRadius: 14, backgroundColor: '#F6EADB', alignItems: 'center', padding: 6, gap: 6 }, shopName: { color: brown, fontSize: 11,lineHeight:14,minHeight:28,fontWeight: '700', textAlign: 'center' },
  detail: { flexGrow: 1, paddingHorizontal: 24, alignItems: 'center', gap: 14, paddingTop: 12 }, detailTitle: { color: brown, fontWeight: '800', fontSize: 25, textAlign: 'center' }, detailFooter: { marginTop: 'auto', paddingTop:16,width: '100%', gap: 12 }, small: { fontSize: 12, lineHeight: 18, color: '#94745C', textAlign: 'center' }, empty: { padding: 30, alignItems: 'center', gap: 18 },
});
