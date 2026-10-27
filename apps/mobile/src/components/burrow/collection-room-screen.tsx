import { memo, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { collectionGridLayout, collectionRoomModel, type CollectionEntry, type CollectionFilter, type CollectionTab } from '@/lib/collection-room-model';
import { BURROW_BACKGROUNDS, burrowArtForItem } from '@/lib/burrow-art-assets';
import { SeasonalWindowArtwork } from './window-artwork';
import { burrowFriendArt } from '@/lib/burrow-ui-assets';
import { FRAME_ART_REFERENCE_BOUNDS } from '@/lib/room-photo-crop';
import { BURROW_SHOP_CATEGORIES, burrowShopCategoryName } from '@/lib/burrow-shop-categories';
import { Image } from './burrow-image';
import { BurrowBackButton } from './burrow-back-button';
import { OutfitBunny } from './outfit-bunny';
import {OutfitThumbnail} from './outfit-thumbnail';
import { ShopCategoryIcon } from './shop-category-icon';
import { AdventureGiftCollection } from './adventure-gift-collection';
import { ROOM_TITLE_STYLE } from '@/lib/room-header-typography';

const cream = '#FFF5E3', brown = '#482010', rust = '#C65B2E', muted = '#906447', silhouette = '#BDA38B';
const title = (value: string) => value[0].toUpperCase() + value.slice(1);
function CollectionBackdrop() {
  return <Svg width="100%" height={180} viewBox="0 0 400 180" preserveAspectRatio="xMidYMin slice" style={StyleSheet.absoluteFillObject} pointerEvents="none">
    <Path d="M-5 155Q9 84 48 18M3 116Q-15 90 0 77Q17 83 12 104M17 86Q0 59 12 49Q31 57 27 68M30 57Q20 30 33 22Q46 29 40 40M20 80Q41 62 52 76Q45 96 20 91M37 48Q56 23 69 35Q63 55 37 57" fill="#37200E" stroke="#37200E" strokeWidth="3" opacity="0.65"/>
    <Path d="M405 175Q383 118 367 39M392 144Q364 156 355 139Q365 121 385 131M379 101Q350 109 348 90Q362 78 375 87M369 60Q347 52 352 36Q368 35 371 48M383 114Q387 85 400 92Q410 109 392 130" fill="#37200E" opacity="0.65"/>
    <Path d="M379 10Q354 18 355 70H390Q392 25 379 10Z" fill="#351D0B"/><Path d="M374 39Q363 47 365 66H383Q386 46 374 39Z" fill="#F6AF48"/><Path d="M374 42V67M365 54H383" stroke="#B76F2E" strokeWidth="2"/>
  </Svg>;
}
function TabIcon({ tab, active }: { tab: CollectionTab; active: boolean }) {
  const color = active ? '#FFF9EE' : brown;
  return <Svg width={23} height={23} viewBox="0 0 32 32" pointerEvents="none">
    {tab === 'items' ? <>
      <Rect x="6" y="5" width="20" height="17" rx="5" fill={color}/><Rect x="2" y="13" width="5" height="14" rx="2" fill={color}/><Rect x="25" y="13" width="5" height="14" rx="2" fill={color}/>
      <Rect x="6" y="23" width="20" height="5" rx="1" fill={color}/><Path d="M5 27V31M27 27V31" stroke={color} strokeWidth="3"/>
    </> : tab === 'gifts' ? <>
      <Path d="M16 10C4 10 5 0 10 2C14 3 16 10 16 10C16 10 19 1 24 2C30 4 26 10 16 10Z" fill="none" stroke={color} strokeWidth="2.5"/>
      <Rect x="3" y="11" width="26" height="7" rx="1" fill={color}/><Rect x="5" y="20" width="10" height="11" rx="1" fill={color}/><Rect x="17" y="20" width="10" height="11" rx="1" fill={color}/>
    </> : <>
      <Circle cx="16" cy="8" r="5" fill={color}/><Circle cx="5" cy="10" r="4" fill={color}/><Circle cx="27" cy="10" r="4" fill={color}/>
      <Path d="M8 29V23C8 13 24 13 24 23V29ZM0 29V24C0 19 3 16 7 17C5 20 5 24 5 29ZM27 29V24C27 21 26 18 25 17C30 16 32 20 32 24V29Z" fill={color}/>
    </>}
  </Svg>;
}

function MysteryArt({ id, size }: { id: string; size: number }) {
  const variant = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  return <Svg width={size} height={size} viewBox="0 0 100 100" pointerEvents="none">
    {variant === 0 ? <Path d="M15 52C1 31 19 17 27 26C18 6 47 5 50 20C62 0 86 13 76 29C97 20 104 47 86 53C107 68 86 87 73 76C76 97 46 98 42 81C21 101 4 75 20 66C5 66 3 52 15 52Z" fill={silhouette}/>
      : variant === 1 ? <Path d="M40 8H60V22L72 36V46C86 63 81 89 68 92H32C15 82 15 58 28 46V36L40 22Z" fill={silhouette}/>
      : variant === 2 ? <Path d="M50 8L63 35L93 40L71 61L76 92L50 78L24 92L29 61L7 40L37 35Z" fill={silhouette}/>
      : <Path d="M10 36H90V54H84V91H16V54H10ZM44 36C7 26 28 1 44 27ZM56 36C93 26 72 1 56 27Z" fill={silhouette}/>}
  </Svg>;
}

function CollectionArt({ entry, size, tab }: { entry: CollectionEntry; size: number; tab: CollectionTab }) {
  if (tab === 'items' && !entry.found) return <View style={[s.unknownItem, { width: size, height: size }]}><Text style={s.unknownItemMark}>?</Text></View>;
  const item = entry.item;
  const friendSource = entry.friend ? burrowFriendArt(entry.friend.name) : undefined;
  // Locked gifts use code-native silhouettes, never fetching the R2 reward.
  const asset = item && (entry.found || tab !== 'gifts') ? burrowArtForItem(item) : undefined;
  const localArt = asset && (entry.found || typeof asset.source === 'number') ? asset : undefined;
  if(asset===null||item?.status==='retired'&&!asset)return <View style={{width:size,height:size}}/>;
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    {friendSource ? <Image source={friendSource} contentFit="contain" allowDownscaling enforceEarlyResizing tintColor={entry.found ? undefined : silhouette} style={{ width: size, height: size }}/>
      : item?.category === 'outfits' ? <OutfitThumbnail outfit={item} size={size} tintColor={entry.found?undefined:silhouette}/>
      : localArt ? (() => {
        // Toy/kettle/outfit canvases keep their supplied proportions. Other local
        // decorations are fitted by visible bounds, just like Shop cards.
        if (item?.category === 'couple_dolls' || item?.category === 'dresser_plants' || item?.category === 'outfits' || tab === 'gifts') return <Image source={localArt.source} contentFit="contain" allowDownscaling enforceEarlyResizing
          tintColor={entry.found ? undefined : silhouette} style={{ width: size, height: size }}/>;
        if (item?.category === 'wallpapers') return <Image source={localArt.thumbnail ?? localArt.source} contentFit="cover" allowDownscaling enforceEarlyResizing style={{ width: size, height: size, borderRadius: 8 }}/>;
        const [left, top, right, bottom] = item?.category === 'frames' ? FRAME_ART_REFERENCE_BOUNDS : localArt.bounds;
        const scale = size / Math.max(right - left, bottom - top);
        if (item?.category === 'windows') return <View style={{ width: size, height: size, overflow: 'hidden' }}>
          <SeasonalWindowArtwork asset={localArt} style={{ position: 'absolute',
            left: (size - (right-left)*scale)/2-left*scale, top: (size-(bottom-top)*scale)/2-top*scale,
            width: localArt.width*scale, height: localArt.height*scale }}/>
        </View>;
        return <View style={{ width: size, height: size, overflow: 'hidden' }}><Image source={localArt.source} contentFit="contain" allowDownscaling enforceEarlyResizing
          tintColor={entry.found ? undefined : silhouette} style={{ position: 'absolute', left: (size - (right - left) * scale) / 2 - left * scale,
            top: (size - (bottom - top) * scale) / 2 - top * scale, width: localArt.width * scale, height: localArt.height * scale }}/></View>;
      })() : entry.found && item ? <ShopCategoryIcon category={item.category} selected={false}/> : <MysteryArt id={entry.id} size={size}/>}
    {!entry.found && <Text style={[s.question, { fontSize: Math.min(38, size * .5) }]}>?</Text>}
  </View>;
}

const CollectionCard = memo(function CollectionCard({ entry, tab, cardWidth, ownerId }: {
  entry: CollectionEntry; tab: CollectionTab; cardWidth: number; ownerId?: string;
}) {
  const canPlace = tab === 'items' && entry.found && !!entry.item?.metadata.slot;
  return <Pressable accessibilityRole={canPlace ? 'button' : undefined} accessibilityLabel={entry.found ? `${canPlace ? 'Decorate with ' : ''}${entry.title}` : tab === 'friends' ? 'Locked friend' : 'Undiscovered item'}
    accessibilityState={{ disabled: !canPlace }} disabled={!canPlace} onPress={() => {
      if (!entry.item || !canPlace) return;
      router.push({ pathname: '/(main)/burrow-detail', params: { section: 'decorate', category: entry.item.category, ownedOnly: '1', itemId: entry.id, ownerId } } as Href);
    }} style={[s.card, !entry.found && s.lockedCard, { width: cardWidth, minHeight: cardWidth + (tab === 'gifts' ? 48 : 20) }]}>
    <CollectionArt entry={entry} tab={tab} size={cardWidth - 12}/>
    {(entry.found || tab !== 'items') && <Text numberOfLines={entry.found ? 2 : 1} adjustsFontSizeToFit minimumFontScale={0.8} style={[s.cardTitle, tab === 'friends' && s.friendTitle,
      !entry.found && tab === 'gifts' && { fontSize: Math.min(11, (cardWidth - 12) / 6.5) }]}>{entry.found ? entry.title : tab === 'friends' ? 'Locked' : 'Undiscovered'}</Text>}
    {entry.found && tab === 'gifts' && <Text numberOfLines={2} style={s.origin}>{entry.origin}</Text>}
  </Pressable>;
});

const entryKey = (entry: CollectionEntry) => entry.id;
const CollectionGrid = memo(function CollectionGrid({ entries, tab, width, ownerId, empty }: {
  entries: CollectionEntry[]; tab: CollectionTab; width: number; ownerId?: string; empty: string;
}) {
  const layout = collectionGridLayout(width, tab);
  return <FlatList data={entries} numColumns={layout.columns} keyExtractor={entryKey} style={s.list}
    showsVerticalScrollIndicator={false} initialNumToRender={tab === 'friends' ? 9 : 12} maxToRenderPerBatch={8} windowSize={3} removeClippedSubviews={false}
    columnWrapperStyle={{ gap: layout.gap }} contentContainerStyle={{ paddingHorizontal: layout.padding, paddingBottom: 24, gap: layout.gap }}
    ListEmptyComponent={<Text style={s.empty}>{empty}</Text>}
    renderItem={({ item: entry }) => <CollectionCard entry={entry} tab={tab} cardWidth={layout.cardWidth} ownerId={ownerId}/>}/>;
});

const emptyEntries: CollectionEntry[] = [];
export function CollectionRoomScreen({ data, loading, error, busy, onRefresh, onClaimGift }: {
  data: MajorUpdateBootstrap | null; loading?: boolean; error?: string | null; busy?: boolean;
  onRefresh: () => void; onClaimGift: (id: string) => void;
}) {
  const { width } = useWindowDimensions(), insets = useSafeAreaInsets();
  const [tab, setTab] = useState<CollectionTab>('items');
  const [filter, setFilter] = useState<CollectionFilter>('wallpapers');
  const ownerId = data?.profile.id;
  // Build from the shared cached bootstrap, not from a tab-triggered request.
  const models = useMemo(() => data && ownerId ? {
    items: collectionRoomModel(data, ownerId, 'items', filter),
    gifts: collectionRoomModel(data, ownerId, 'gifts'),
    friends: collectionRoomModel(data, ownerId, 'friends'),
  } : null, [data, ownerId, filter]);
  const model = models?.[tab];
  const empty = !data ? loading ? 'Loading your collection…' : 'Your collection will appear when you reconnect.' : 'Your next adventure could bring something new.';
  const layout = collectionGridLayout(width, tab);
  return <View style={s.root}>
    <Image source={BURROW_BACKGROUNDS.common} contentFit="cover" style={StyleSheet.absoluteFillObject} pointerEvents="none"/>
    <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(48,23,10,0.5)' }]} pointerEvents="none"/>
    <CollectionBackdrop/>
    <View style={[s.frame, { width: Math.min(width, 560), paddingTop: insets.top, paddingBottom: Math.max(12, insets.bottom) }]}>
      <View style={s.header}>
        <BurrowBackButton light onPress={() => router.back()} style={s.back}/>
        <View style={s.titleRow}><Text accessibilityRole="header" style={[s.title,ROOM_TITLE_STYLE]} adjustsFontSizeToFit numberOfLines={1}>Collection Room</Text></View>
      </View>
      <View style={[s.board, { width: layout.boardWidth }]}>
        <View style={s.controls}>
          <View style={s.tabs}>{(['items', 'gifts', 'friends'] as const).map(value => <Pressable key={value}
            accessibilityRole="button" accessibilityLabel={title(value)} accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)}
            style={[s.tab, tab === value && s.activeTab]}><TabIcon tab={value} active={tab === value}/><Text style={[s.tabText, tab === value && s.activeTabText]}>{title(value)}</Text></Pressable>)}</View>
          <View style={s.headingRow}><Text accessibilityRole="header" numberOfLines={2} style={[s.heading,{fontSize:20,lineHeight:25,flex:1}]}>{tab==='items'?burrowShopCategoryName(filter):tab==='gifts'?'Gifts from Burrow Friends':'Friends met in adventure'}</Text>
            <Text style={s.count}>{model ? tab === 'friends' ? `${model.count} / ${model.totalFriends} met` : `${model.count} ${tab === 'gifts' ? 'received' : 'collected'}` : '—'}</Text></View>
          {tab === 'items' && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.itemRail} contentContainerStyle={s.itemRailContent}>
            {BURROW_SHOP_CATEGORIES.map(category => <Pressable key={category} accessibilityRole="button"
              accessibilityLabel={burrowShopCategoryName(category)} accessibilityState={{ selected: filter === category }}
              onPress={() => setFilter(category)} style={[s.itemCategory, filter === category && s.itemCategorySelected]}>
              <ShopCategoryIcon category={category} selected={filter === category}/>
            </Pressable>)}
          </ScrollView>}
          {ownerId === data?.profile.id && !!data?.gifts.length && <View style={s.pending}>{data.gifts.map(gift => <Pressable key={gift.id} accessibilityRole="button" disabled={busy}
            accessibilityLabel="Open received gift" onPress={() => onClaimGift(gift.id)}><Text style={s.pendingText}>Open gift · {data.catalog.find(item => item.stable_id === gift.item_id)?.title ?? 'A little gift'}</Text></Pressable>)}</View>}
        </View>
        <View style={s.panels}>
          {/* Stable keys and full-size hidden panels preserve rows, decoded art
              and each tab's scroll position instead of rebuilding on every tap. */}
          {(['items', 'gifts', 'friends'] as const).map(value => <View key={`${ownerId}:${value}`}
            pointerEvents={tab === value ? 'auto' : 'none'} accessibilityElementsHidden={tab !== value}
            importantForAccessibility={tab === value ? 'auto' : 'no-hide-descendants'}
            style={[StyleSheet.absoluteFillObject, tab !== value && s.hiddenPanel]}>
            {value==='gifts'&&data&&ownerId?<AdventureGiftCollection embedded data={data} ownerId={ownerId}
              onBack={()=>{}} onOpenCategory={category=>router.push({pathname:'/(main)/gift-library',params:{category,returnTo:'collection'}} as Href)}/>
              :<CollectionGrid entries={models?.[value].entries ?? emptyEntries} tab={value} width={width} ownerId={ownerId} empty={empty}/>}
          </View>)}
        </View>
        {!!error && <Pressable accessibilityRole="button" accessibilityLabel="Retry collection refresh" onPress={onRefresh} style={s.retry}><Text style={s.origin}>Couldn’t refresh. Tap to retry.</Text></Pressable>}
      </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#57301B' }, frame: { flex: 1, minHeight: 0, alignSelf: 'center' },
  header: { paddingHorizontal: 22, paddingTop: 54, paddingBottom: 26 }, back: { position: 'absolute', left: 12, top: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, title: { flex: 1, color: '#FFF8EA', fontSize: 34, fontWeight: '900' },
  board: { flex: 1, minHeight: 0, alignSelf: 'center', borderRadius: 25, backgroundColor: cream, paddingTop: 26, paddingBottom: 8 },
  controls: { paddingHorizontal: 12, gap: 10, paddingBottom: 10 }, tabs: { flexDirection: 'row', borderWidth: 1, borderColor: '#F0CCA4', padding: 3, borderRadius: 18 },
  tab: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14 }, activeTab: { backgroundColor: rust }, tabText: { color: brown, fontSize: 14, fontWeight: '800' }, activeTabText: { color: '#FFF8EC' },
  headingRow: { flexDirection: 'row', minHeight:50, alignItems: 'center', justifyContent: 'space-between',gap:8 }, heading: { fontSize: 20,lineHeight:25, fontWeight: '900', color: '#3D1C0E' }, count: { fontSize: 13,lineHeight:18,flexShrink:0,maxWidth:100,textAlign:'right', fontWeight: '600', color: muted },
  itemRail: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: '#E9DDD1' }, itemRailContent: { alignItems: 'center', paddingHorizontal: 9 },
  itemCategory: { width: 62, height: 61, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' }, itemCategorySelected: { borderBottomColor: rust },
  giftCategories: { gap: 6, paddingBottom: 2 }, giftCategory: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#F3E5CF' }, giftCategorySelected: { backgroundColor: '#E7C89F' }, giftCategoryText: { color: brown, fontSize: 11 },
  panels: { flex: 1, minHeight: 0 }, hiddenPanel: { opacity: 0 }, list: { flex: 1, minHeight: 0 }, card: { backgroundColor: '#FFF7E9', borderColor: '#F6E4C9', borderWidth: 1, borderRadius: 12, padding: 5, alignItems: 'center', gap: 3 }, lockedCard: { backgroundColor: '#F7EBD8', borderColor: 'transparent' },
  cardTitle: { width: '100%', color: brown, fontSize: 11, lineHeight: 14, fontWeight: '700', textAlign: 'center', minHeight: 28 }, friendTitle: { fontSize: 13, lineHeight: 17, minHeight: 17 },
  question: { position: 'absolute', color: '#FFF9EC', fontWeight: '900', textAlign: 'center' }, unknownItem: { alignItems: 'center', justifyContent: 'center' }, unknownItemMark: { color: silhouette, fontSize: 38, fontWeight: '900' }, origin: { color: muted, fontSize: 10, lineHeight: 13, textAlign: 'center' },
  empty: { padding: 24, color: muted, lineHeight: 21, textAlign: 'center' }, pending: { gap: 4 }, pendingText: { color: rust, fontSize: 12, fontWeight: '700' }, retry: { padding: 9 },
});
