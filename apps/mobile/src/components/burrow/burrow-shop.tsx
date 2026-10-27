import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image as NativeImage, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { Image } from './burrow-image';
import { CoinLabel } from './coin-ui';
import {CoinWallet} from './coin-wallet';
import { router, type Href } from 'expo-router';
import { dismissToRetainedTab } from '@/lib/retained-tab-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BURROW_SHOP_CATEGORIES, burrowShopCategoryName } from '@/lib/burrow-shop-categories';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { enqueueBurrowRoomEdit, enqueueBurrowPlushie, enqueueBurrowPurchase, getBurrowSnapshot, refreshBurrow } from '@/lib/burrow-store';
import { prepareHomeArt } from '@/lib/home-art-preparation';
import { withRoomDesign, isCurrentRoomItem } from '@/lib/room-edit-design';
import { showInsufficientCoins } from '@/lib/insufficient-coins';
import { useCoinPurchaseConfirmation } from '@/lib/use-coin-purchase-confirmation';
import { homeDesignKey, waitForHomeDesignCommit } from '@/lib/home-design-handoff';
import { roomSlots } from '@/lib/burrow-presentation';
import { decorationOptions } from '@/lib/burrow-collection-options';
import { BURROW_BACKGROUNDS, burrowArtForItem } from '@/lib/burrow-art-assets';
import { FRAME_ART_REFERENCE_BOUNDS } from '@/lib/room-photo-crop';
import { BURROW_SHOP_ICONS } from '@/lib/burrow-shop-icons';
import { BackIcon, BurrowBackButton } from './burrow-back-button';
import { HomeArtPreview } from './home-art-preview';
import { ShopCategoryIcon } from './shop-category-icon';
import { shopPageIndex } from '@/lib/burrow-shop-paging';
import { LEFT_EDGE_BACK_WIDTH } from '@/lib/page-edge-gesture';
import { createShopThumbnailWarmer } from '@/lib/burrow-shop-thumbnails';
import { ShopItemPrice } from './shop-item-price';
import { SeasonalWindowArtwork } from './window-artwork';
import { ShopGiftInbox } from './shop-gift-inbox';

const cream = '#FFF9EF';
const brown = '#4A281E';
const rust = '#C9552C';
const categories = BURROW_SHOP_CATEGORIES;
type Category = typeof categories[number];
type Detail = { kind: 'item'; item: MajorUpdateCatalogItem };
const categorySlot: Record<string, string> = {
  cushions: 'cushion', tables: 'table', rugs: 'rug', vases: 'vase', lamps: 'lamp',
  windows: 'window', cabinets: 'cabinet', shelves: 'shelf', shelf_decor: 'shelf_decor',
  music_players: 'music_player', frames: 'frame', posters: 'poster',
  couple_dolls: 'couple_doll', light_strings: 'light_string', ladders: 'ladder',
  dresser_plants: 'dresser_plant', outfits: 'outfit', wallpapers: 'wallpaper',
};
const name = burrowShopCategoryName;
const isDefaultOutfit = (item: MajorUpdateCatalogItem) => item.category === 'outfits' && !!item.metadata.starter;

const Artwork = memo(function Artwork({ item, size }: { item: MajorUpdateCatalogItem; size: number }) {
  if (isDefaultOutfit(item)) {
    const diameter = size * .72, stroke = diameter * .12;
    return <View testID="default-outfit-icon" pointerEvents="none" style={{width:size,height:size,alignItems:'center',justifyContent:'center'}}>
      <View style={{width:diameter,height:diameter,borderRadius:diameter/2,borderWidth:stroke,borderColor:brown}}/>
      <View style={{position:'absolute',left:(size-diameter*.88)/2,top:(size-stroke)/2,width:diameter*.88,height:stroke,backgroundColor:brown,transform:[{rotate:'-45deg'}]}}/>
    </View>;
  }
  const asset = burrowArtForItem(item);
  if(asset===null||!asset&&item.status==='retired')return <View style={{width:size,height:size}}/>;
  if (!asset) return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <NativeImage source={BURROW_SHOP_ICONS[item.category as keyof typeof BURROW_SHOP_ICONS] ?? BURROW_SHOP_ICONS.outfits}
      resizeMode="contain" style={{ width: size * .55, height: size * .55 }} />
  </View>;
  if (item.category === 'wallpapers') return <Image source={asset.thumbnail ?? asset.source} contentFit="cover"
    contentPosition="center" style={{ width: size, height: size, borderRadius: 10 }} />;
  // Preserve the original canvas and relative artwork sizes across variants.
  if (item.category === 'dresser_plants' || item.category === 'couple_dolls' || item.tags.includes('adventure_v2_gift')) return <Image source={asset.source} contentFit="contain"
    style={{ width: size, height: size }} />;
  const [left, top, right, bottom] = item.category === 'frames' ? FRAME_ART_REFERENCE_BOUNDS : asset.bounds;
  const ratio = Math.min(size / (right - left), size / (bottom - top));
  const imageStyle = { position: 'absolute' as const,
    left: (size - (right - left) * ratio) / 2 - left * ratio,
    top: (size - (bottom - top) * ratio) / 2 - top * ratio,
    width: asset.width * ratio, height: asset.height * ratio };
  return <View style={{ width: size, height: size, overflow: 'hidden' }}>
    {item.category === 'windows' ? <SeasonalWindowArtwork asset={asset} style={imageStyle}/>
      : <Image source={asset.source} contentFit="fill" style={imageStyle}/>}
  </View>;
});

function Button({ label, onPress, outline = false, disabled = false }: {
  label: string; onPress: () => void; outline?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, outline && styles.outlineButton, (pressed || disabled) && { opacity: .55 }]}>
    <CoinLabel style={[styles.buttonText, outline && styles.outlineButtonText]}>{label}</CoinLabel>
  </Pressable>;
}

export const CategoryRail = memo(function CategoryRail({ selected, onChange }: {
  selected: Category; onChange: (category: Category) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const viewport = useRef(width);
  const browsing = useRef(false);
  const lastTarget = useRef<number | null>(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const centerSelected = useCallback(() => {
    if (browsing.current) return;
    const index = categories.indexOf(selectedRef.current);
    // Include the leading inset and clamp to the real scrollable range. Never
    // let automatic centering fight a finger browsing the category rail.
    const x = Math.min(Math.max(0, categories.length * 62 + 18 - viewport.current),
      Math.max(0, 9 + index * 62 + 31 - viewport.current / 2));
    if (index >= 0 && lastTarget.current !== x) {
      lastTarget.current = x; ref.current?.scrollTo({ x, animated: true });
    }
  }, []);
  useEffect(() => {
    centerSelected();
  }, [selected, centerSelected]);
  return <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} style={styles.rail}
    onLayout={event => { viewport.current = event.nativeEvent.layout.width; centerSelected(); }}
    onScrollBeginDrag={() => { browsing.current = true; lastTarget.current = null; }}
    onScrollEndDrag={event => { if (Math.abs(event.nativeEvent.velocity?.x ?? 0) < .01) browsing.current = false; }}
    onMomentumScrollEnd={() => { browsing.current = false; }}
    bounces={false} overScrollMode="never" directionalLockEnabled nestedScrollEnabled contentContainerStyle={styles.railItems}>
    {categories.map(cat => <Pressable key={cat} accessibilityRole="button"
      accessibilityLabel={name(cat)} accessibilityState={{ selected: selected === cat }}
      onPress={() => { browsing.current = false; onChange(cat); }} style={[styles.railItem, selected === cat && styles.railSelected]}>
      <ShopCategoryIcon category={cat} selected={selected === cat} />
    </Pressable>)}
  </ScrollView>;
});

type ProductPageProps = {
  category: Category; items: MajorUpdateCatalogItem[]; width: number;
  owned: ReadonlySet<string>; mine: ReadonlySet<string>; partnerOwned: ReadonlySet<string>;
  giftMode: boolean; hasPlus: boolean; partnerName: string; onOpen: (next: Detail) => void;
};
const ShopProductPage = memo(function ShopProductPage({ category, items, width, owned, mine, partnerOwned, giftMode, hasPlus, partnerName, onOpen }: ProductPageProps) {
  const column = (width - 40 - 16) / 3;
  return <View style={{width,height:'100%'}}>
    <FlatList style={styles.list} data={items} numColumns={3} nestedScrollEnabled directionalLockEnabled
      bounces={false} overScrollMode="never" removeClippedSubviews={false}
      keyExtractor={item=>item.stable_id} initialNumToRender={12} maxToRenderPerBatch={9} windowSize={5}
      columnWrapperStyle={{gap:8}} contentContainerStyle={{padding:18,paddingBottom:30}}
      ListHeaderComponent={<>
        <Text style={[styles.sectionTitle,!giftMode&&styles.sectionTitleAlone]}>{name(category)}</Text>
        {giftMode&&<Text style={styles.subtitle}>{`Choosing a gift for ${partnerName}.`}</Text>}
      </>}
      renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`Preview ${item.title}`}
        onPress={()=>onOpen({kind:'item',item})} style={[styles.product,{width:column,marginBottom:12}]}>
        <Artwork item={item} size={column-12}/><Text numberOfLines={2} style={styles.productTitle}>{item.title}</Text>
        <View style={styles.productOffer}><ShopItemPrice item={item} hasPlus={hasPlus} owned={(giftMode?partnerOwned:(item.category==='outfits'?mine:owned)).has(item.stable_id)}
          fontSize={Math.min(16,Math.max(13,column/7.4))}/></View>
      </Pressable>}
      ListEmptyComponent={<Text style={styles.empty}>More designs are coming soon.</Text>}/>
  </View>;
});

/** Keep the reserved edge OUT of both native scroll views' hit-test ancestry.
 * Waiting for JS onScrollBeginDrag is too late: the pager can already move
 * while its retained-tab/native-stack parent recognizes the back gesture.
 * This transparent sibling leaves taps/scrolling outside the edge unchanged. */
export function ShopCategoryBrowser({children}:{children:import('react').ReactNode}){
  return <View style={styles.categoryBrowser}>
    {children}
    <View testID="shop-edge-back-guard" collapsable={false} pointerEvents="auto" accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{position:'absolute',left:0,top:0,bottom:0,width:LEFT_EDGE_BACK_WIDTH,zIndex:2}}/>
  </View>;
}

/** Native horizontal paging keeps both lists moving with the finger. Only the
 * current + adjacent pages render; all products are from the same cached data. */
export function ShopCategoryPager({ selected, selectionRevision = 0, onChange, pages, width, ...pageProps }: Omit<ProductPageProps,'category'|'items'> & {
  selected: Category; selectionRevision?: number; onChange: (category: Category) => void; pages: Record<string, MajorUpdateCatalogItem[]>;
}) {
  const ref = useRef<FlatList<Category>>(null);
  const initialIndex = useRef(Math.max(0,categories.indexOf(selected))).current;
  const offset = useRef(initialIndex*width);
  const pageWidth = useRef(width);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const motion = useRef<'idle' | 'programmatic' | 'dragging' | 'settling'>('idle');
  const target = useRef(initialIndex * width);
  const instantJump = useRef(false);
  const latestEvent = useRef(0);
  const readEvent = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Native events queued before a newer gesture/scroll must not take ownership.
    if (event.timeStamp && event.timeStamp < latestEvent.current) return null;
    if (event.timeStamp) latestEvent.current = event.timeStamp;
    return event.nativeEvent.contentOffset.x;
  }, []);
  const commit = useCallback((x: number) => {
    offset.current = x; motion.current = 'idle';
    const next = categories[shopPageIndex(x, pageWidth.current, categories.length)];
    if (next !== selectedRef.current) onChange(next);
  }, [onChange]);
  useLayoutEffect(()=>{
    const nextIndex=Math.max(0,categories.indexOf(selected)),next=nextIndex*width;
    const previousIndex=shopPageIndex(offset.current,pageWidth.current,categories.length);
    const resized=pageWidth.current!==width; pageWidth.current=width;
    if(resized||Math.abs(offset.current-next)>1||motion.current!=='idle') {
      motion.current='programmatic'; target.current=next;
      // A tab tap is a destination, not a request to tour intermediate pages.
      // Adjacent taps retain the short slide; long jumps and resize are direct.
      const animated=!resized&&Math.abs(previousIndex-nextIndex)===1;
      instantJump.current=!animated;
      ref.current?.scrollToOffset({offset:next,animated});
      if(!animated)offset.current=next;
    }
  },[selected,width,selectionRevision]);
  return <FlatList ref={ref} style={styles.list} horizontal pagingEnabled data={categories} extraData={width}
    contentContainerStyle={{height:'100%'}}
    keyExtractor={category=>category} initialScrollIndex={initialIndex}
    getItemLayout={(_data,index)=>({length:width,offset:index*width,index})}
    initialNumToRender={3} maxToRenderPerBatch={1} windowSize={3} removeClippedSubviews={false}
    bounces={false} overScrollMode="never" directionalLockEnabled nestedScrollEnabled
    showsHorizontalScrollIndicator={false} decelerationRate="fast"
    scrollEventThrottle={16}
    onScroll={event=>{
      const x=readEvent(event);
      if(x!==null&&(!instantJump.current||Math.abs(x-target.current)<1))offset.current=x;
    }}
    onScrollBeginDrag={event=>{
      const x=readEvent(event); if(x===null)return;
      instantJump.current=false;offset.current=x; motion.current='dragging';
    }}
    onScrollEndDrag={event=>{
      const x=readEvent(event); if(x===null||motion.current!=='dragging')return;
      offset.current=x; motion.current='settling';
      const destination=event.nativeEvent.targetContentOffset?.x??x;
      // A stationary release at a page boundary need not emit momentum events.
      if(Math.abs(event.nativeEvent.velocity?.x??0)<.01&&Math.abs(destination-x)<1&&
        Math.abs(x-shopPageIndex(x,width,categories.length)*width)<1)commit(x);
    }}
    onMomentumScrollEnd={event=>{
      const x=readEvent(event); if(x===null)return;
      if(motion.current==='programmatic') {
        if(Math.abs(x-target.current)<1){offset.current=x;motion.current='idle';}
        return;
      }
      // Only a current user gesture may select a category. Animation completions
      // (including interrupted, older tab taps) never feed back into selection.
      if(motion.current==='settling'&&Math.abs(x-offset.current)<1)commit(x);
    }}
    renderItem={({item:category})=><ShopProductPage {...pageProps} width={width} category={category} items={pages[category]}/>}/>
}

const OPTION_WIDTH = 105, OPTION_GAP = 9, OPTION_INSET = 12;
const optionKey = (item: MajorUpdateCatalogItem) => item.stable_id;
// RN's cell contains its separator; its measured length must match the estimate,
// including when it is replaced by a virtual spacer during a fast fling.
const optionLayout = (data: ArrayLike<MajorUpdateCatalogItem> | null | undefined, index: number) => ({
  length: OPTION_WIDTH + (index < (data?.length ?? 0) - 1 ? OPTION_GAP : 0),
  offset: OPTION_INSET + index * (OPTION_WIDTH + OPTION_GAP), index });
const OptionSeparator = () => <View style={styles.optionSeparator} />;
const DecorationOption = memo(function DecorationOption({ item, selected, owned, hasPlus, onSelect }: {
  item: MajorUpdateCatalogItem; selected: boolean; owned: boolean; hasPlus: boolean;
  onSelect: (item: MajorUpdateCatalogItem) => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${item.title}`}
    accessibilityState={{ selected }} onPress={() => onSelect(item)}
    style={[styles.optionCard, selected && styles.optionSelected]}>
    <Artwork item={item} size={74} /><Text numberOfLines={1} style={styles.optionName}>{item.title.replace(/^.* · /, '')}</Text>
    <ShopItemPrice item={item} hasPlus={hasPlus} owned={owned} fontSize={12}/>
  </Pressable>;
});

/** A category owns its native offset. Changing category remounts only this small
 * rail, not the room. Fixed metrics avoid async gap/extent estimates on flings. */
export const DecorationOptions = memo(function DecorationOptions({ items, selectedId, owned, hasPlus, onSelect }: {
  items: MajorUpdateCatalogItem[]; selectedId?: string; owned: ReadonlySet<string>; hasPlus: boolean;
  onSelect: (item: MajorUpdateCatalogItem) => void;
}) {
  const warmer = useMemo(() => createShopThumbnailWarmer(), []);
  const live = useRef(false);
  useEffect(() => {
    live.current = true; warmer.warm(items.slice(0, 12));
    return () => { live.current = false; warmer.cancel(); };
  }, [items, warmer]);
  const itemsRef = useRef(items); itemsRef.current = items;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    if (!live.current) return;
    const first = viewableItems[0]?.index ?? 0;
    warmer.warm(itemsRef.current.slice(Math.max(0, first - 2), first + 12));
  }).current;
  const renderItem = useCallback(({ item }: { item: MajorUpdateCatalogItem }) => <DecorationOption item={item}
    selected={selectedId === item.stable_id} owned={owned.has(item.stable_id)} hasPlus={hasPlus} onSelect={onSelect}/>,
  [selectedId, owned, hasPlus, onSelect]);
  return <FlatList horizontal data={items} keyExtractor={optionKey} extraData={selectedId}
    getItemLayout={optionLayout} ItemSeparatorComponent={OptionSeparator}
    initialNumToRender={10} maxToRenderPerBatch={6} windowSize={5} updateCellsBatchingPeriod={16}
    removeClippedSubviews={false} bounces={false} overScrollMode="never" directionalLockEnabled
    onViewableItemsChanged={onViewableItemsChanged}
    showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow} renderItem={renderItem}/>;
});

export function BurrowShop({ data, section, initialCategory, away, initialDetail, ownedOnly = false, initialItemId, collectionOwnerId, giftRecipientId, giftActorId, retainedTab = false }: {
  data: MajorUpdateBootstrap;
  section: 'shop' | 'decorate';
  initialCategory: string;
  away: boolean;
  initialDetail?: { itemId?: string };
  ownedOnly?: boolean;
  initialItemId?: string;
  collectionOwnerId?: string;
  giftRecipientId?: string;
  giftActorId?: string;
  retainedTab?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const giftMode=!!giftRecipientId;
  const giftAllowed=giftMode&&giftActorId===data.profile.id&&giftRecipientId===data.partner?.id;
  const giftInFlight=useRef(false);
  const checkoutLock=useRef(false);
  const checkout=useCoinPurchaseConfirmation(`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}`);
  const viewOwnerId = giftAllowed ? giftRecipientId! : ownedOnly && data.partner && collectionOwnerId === data.partner.id ? data.partner.id : data.profile.id;
  const readOnly = viewOwnerId !== data.profile.id;
  const [category, setCategory] = useState<Category>(section === 'decorate'
    ? (categories.includes(initialCategory as Category) ? initialCategory as Category : 'windows') : categories[0]);
  const [categoryRevision, setCategoryRevision] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(() => initialDetail?.itemId ? (() => { const item = data.catalog.find(entry => entry.stable_id === initialDetail.itemId);
      return item && categories.includes(item.category as Category) ? { kind: 'item' as const, item } : null; })() : null);
  const [draft, setDraft] = useState<Record<string, MajorUpdateCatalogItem> | null>(() => {
    if (!ownedOnly || !initialItemId) return null;
    const item = data.catalog.find(entry => entry.stable_id === initialItemId);
    if (!item?.metadata.slot || !categories.includes(item.category as Category) ||
      !data.inventory.some(row => row.owner_id === viewOwnerId && row.item_id === item.stable_id)) return null;
    return { ...roomSlots(data, viewOwnerId), [item.metadata.slot]: item };
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    // Keep the chosen objects, but never retain a stale price after refresh.
    const current = new Map(data.catalog.map(item => [item.stable_id, item]));
    setDetail(old => old ? current.has(old.item.stable_id) ? current.get(old.item.stable_id)===old.item ? old : { ...old, item: current.get(old.item.stable_id)! } : null : old);
    setDraft(old => old && Object.values(old).some(item=>current.has(item.stable_id)&&current.get(item.stable_id)!==item)
      ? Object.fromEntries(Object.entries(old).map(([slot, item]) => [slot, current.get(item.stable_id) ?? item])) : old);
  }, [data.catalog]);
  const saved = useMemo(() => roomSlots(data, viewOwnerId), [data.catalog,data.loadouts,data.adventureCollection?.displays,data.profile.id,data.partner?.id,viewOwnerId]);
  const selectedSlots = draft ?? saved;
  const preview = detail?.item.metadata.slot
      ? { ...saved, [detail.item.metadata.slot]: detail.item } : saved;
  // Preview is local presentation, not a Home design commit. Its own bounded
  // static warmup must not prepare Skia suites/photos or replace Home's pins.
  // Keep full Home preparation exclusively in the existing apply/return path.
  const inventory = useMemo(() => new Set(data.inventory.filter(row => row.owner_id === data.profile.id)
    .map(row => row.item_id)), [data.inventory, data.profile.id]);
  const mine = useMemo(() => new Set(data.inventory.filter(row => row.owner_id === data.profile.id).map(row => row.item_id)), [data.inventory, data.profile.id]);
  const partnerOwned = useMemo(()=>new Set(data.inventory.filter(row=>row.owner_id===data.partner?.id).map(row=>row.item_id)),[data.inventory,data.partner?.id]);
  const nonPlaceable = ownedOnly && initialItemId ? data.catalog.find(item =>
    item.stable_id === initialItemId && (!item.metadata.slot || !categories.includes(item.category as Category))) : undefined;
  const unowned = (slots: Record<string, MajorUpdateCatalogItem>) => Object.entries(slots)
    .filter(([slot, item]) => slot !== 'outfit' && isCurrentRoomItem(item) && !inventory.has(item.stable_id))
    .map(([, item]) => item);
  const changedOutfit = (slots: Record<string, MajorUpdateCatalogItem>) => slots.outfit?.stable_id !== saved.outfit?.stable_id ? slots.outfit : undefined;
  const cost = (slots: Record<string, MajorUpdateCatalogItem>) => unowned(slots)
    .reduce((sum, item) => sum + (item.price ?? 0), 0) +
    (changedOutfit(slots) && !mine.has(slots.outfit.stable_id) ? slots.outfit.price ?? 0 : 0);
  const total = ownedOnly ? 0 : cost(selectedSlots);
  const inUse = Object.entries(selectedSlots).every(([slot,item])=>item.stable_id===saved[slot]?.stable_id);
  const canReplace = !saving && total === 0 && !inUse && !nonPlaceable && !readOnly;
  const detailPrice = giftMode ? detail?.item.price??0 : detail?.kind === 'item' && detail.item.category === 'outfits'
    ? mine.has(detail.item.stable_id) ? 0 : detail.item.price ?? 0 : cost(preview);
  const fullRoomIds = (slots: Record<string, MajorUpdateCatalogItem>) => Object.fromEntries(Object.entries(slots)
    .filter(([slot, item]) => slot !== 'outfit' && isCurrentRoomItem(item))
    .map(([slot, item]) => [slot, item.stable_id]));
  const openDetail = useCallback((next: Detail) => router.push({ pathname: '/(main)/shop-detail', params: { itemId: next.item.stable_id,
    ...(giftMode?{giftTo:giftRecipientId,giftFrom:giftActorId}:{}) } } as Href),[giftMode,giftRecipientId,giftActorId]);
  const collection = () => retainedTab ? router.navigate('/(main)/(tabs)/collection' as Href) : dismissToRetainedTab('/(main)/(tabs)/collection');
  const carrots = () => router.push('/(main)/coin-shop' as Href);
  const changeCategory = useCallback((next: Category) => {
    if (categories.includes(next)) { setCategory(next); setCategoryRevision(value => value + 1); setMessage(null); }
  },[]);
  const chooseSlot = useCallback((slot: string) => {
    const found = categories.find(item => categorySlot[item] === slot);
    if (found) setCategory(found);
  }, []);
  const selectDecoration = useCallback((item: MajorUpdateCatalogItem) => {
    const slot = item.metadata.slot;
    if (slot) setDraft(current => {
      const slots = current ?? saved;
      return slots[slot]?.stable_id === item.stable_id ? current : { ...slots, [slot]: item };
    });
  }, [saved]);

  async function failedPurchase(fallback: string) {
    const error = getBurrowSnapshot().error;
    if (error === 'insufficient_balance') { showInsufficientCoins(); return; }
    if (error === 'price_changed') {
      setMessage('The price changed. Refreshing prices… No carrots were spent.');
      await refreshBurrow({ silent: true });
      if (!checkout.isCurrent()) return;
      setMessage(getBurrowSnapshot().error
        ? 'Could not refresh prices. Check your connection and try again. No carrots were spent.'
        : 'Prices refreshed. Review the total and tap Pay / Buy again. No carrots were spent.');
    } else setMessage(error === 'price_confirmation_required' ? 'Please update the app before purchasing this item. No carrots were spent.' : fallback);
  }

  async function applyRoom(slots: Record<string, MajorUpdateCatalogItem>) {
    if (readOnly) { router.back(); return; }
    if (saving || checkoutLock.current) return;
    const missing = unowned(slots);
    const outfit = changedOutfit(slots);
    if (ownedOnly && (missing.length > 0 || (outfit && !mine.has(outfit.stable_id)))) {
      setMessage('This collection view can only place items you already own.');
      return;
    }
    if ([...missing, ...(outfit && !mine.has(outfit.stable_id) ? [outfit] : [])].some(item => item.plus_only && !data.hasPlus)) {
      router.push('/(main)/(modals)/subscription-paywall' as Href); return;
    }
    const total = cost(slots);
    if (total > 0 && total > data.wallet.balance) { showInsufficientCoins(); return; }
    checkoutLock.current=true;
    const ids = fullRoomIds(slots);
    const purchasedItems=[...missing,...(outfit&&!mine.has(outfit.stable_id)?[outfit]:[])];
    const purchaseName=purchasedItems.length===1?purchasedItems[0].title:`${purchasedItems.length} items`;
    try {
      if(total>0&&!await checkout.confirm({name:purchaseName,price:total,
        artwork:<View style={{flexDirection:'row',justifyContent:'center',flexWrap:'wrap'}}>{purchasedItems.slice(0,4).map(item=><Artwork key={item.stable_id} item={item} size={purchasedItems.length===1?155:80}/>)}</View>}))return;
      if(!checkout.isCurrent())return;
      setSaving(true); setMessage(null);
      const target={...ids,...(slots.outfit?{outfit:slots.outfit.stable_id}:{})};
      // Usually already resolved by selection warmup. This waits only for
      // local native resources, NEVER a network save/financial confirmation.
      await prepareHomeArt(withRoomDesign(data,target));
      if(!checkout.isCurrent())return;
      const changed=Object.entries(target).filter(([slot,id])=>saved[slot]?.stable_id!==id);
      if(changed.length===1&&changed[0][0]==='couple_doll')enqueueBurrowPlushie(changed[0][1]);
      else enqueueBurrowRoomEdit(target,purchasedItems.map(item=>item.stable_id),purchaseName,total);
      // Commit the hidden retained Home before the native pop reveals it.
      await waitForHomeDesignCommit(homeDesignKey(data.profile.id,data.partner?.id,data.pairVersion,target));
      if(!checkout.isCurrent())return;
      dismissToRetainedTab('/(main)/(tabs)');
    } catch(error) {
      if(error instanceof Error&&error.message==='insufficient_balance'){showInsufficientCoins();return;}
      setMessage(error instanceof Error&&error.message==='intent_not_saved'
        ?'Could not save this change on your device. Free some space and try again.'
        :'Could not prepare this room change. Please try again.');
    } finally { checkoutLock.current=false; setSaving(false); }
  }

  async function buyOutfit(item: MajorUpdateCatalogItem) {
    await applyRoom({...saved,outfit:item});
  }

  async function giftItem(item: MajorUpdateCatalogItem) {
    if(saving||giftInFlight.current||checkoutLock.current)return;
    if (!data.partner) { Alert.alert('Connect first', 'Connect with your person to send a gift.'); return; }
    if(giftMode&&!giftAllowed){setMessage('Your connection changed. Reopen your partner’s room.');return;}
    if (!item.tradable) { Alert.alert('Not giftable', 'This item is only for your room.'); return; }
    if(item.plus_only&&!data.hasPlus){router.push('/(main)/(modals)/subscription-paywall' as Href);return;}
    if((item.price??0)>0&&(item.price??0)>data.wallet.balance){showInsufficientCoins();return;}
    const actor=data.profile.id,recipient=data.partner.id,pairVersion=data.pairVersion;
    if(data.inventory.some(row=>row.owner_id===recipient&&row.item_id===item.stable_id)){
      setMessage('Your person already has this item. Choose another gift.');return;
    }
    giftInFlight.current=true;checkoutLock.current=true;
    try {
        if(!await checkout.confirm({name:item.title,price:item.price??0,artwork:<Artwork item={item} size={155}/>,description:`A gift for ${data.partner.display_name?.trim()||'your partner'}.`}))return;
        const current=getBurrowSnapshot().data;
        if(!checkout.isCurrent())return;
        if(current?.profile.id!==actor||current.partner?.id!==recipient||current.pairVersion!==pairVersion){setMessage('Your connection changed. Reopen your partner’s room.');return;}
        setSaving(true); setMessage(null);
        enqueueBurrowPurchase(item.stable_id,recipient,item.price??0,item.title);
        setDetail(null);
    } catch(error) {
      if(error instanceof Error&&error.message==='insufficient_balance')showInsufficientCoins();
      else await failedPurchase('The gift could not be saved on this device. Please try again.');
    } finally { giftInFlight.current=false;checkoutLock.current=false;setSaving(false); }
  }

  const selectedItems = useMemo(()=>decorationOptions(data.catalog, category, ownedOnly, viewOwnerId, data.inventory)
    .filter(item=>!giftMode||(item.tradable&&!!item.price)),[data.catalog,category,ownedOnly,viewOwnerId,data.inventory,giftMode]);
  const pages = useMemo(()=>Object.fromEntries(categories.map(category=>[category,
    decorationOptions(data.catalog,category,ownedOnly,viewOwnerId,data.inventory)
      .filter(item=>!isDefaultOutfit(item)&&(!giftMode||(item.tradable&&!!item.price)))])),[data.catalog,ownedOnly,viewOwnerId,data.inventory,giftMode]);

  if(giftMode&&!giftAllowed)return <View style={[styles.root,{paddingTop:insets.top+12,paddingHorizontal:18}]}>
    <BurrowBackButton onPress={()=>router.back()}/><Text style={styles.empty}>Your connection changed. Reopen your partner’s room to choose a gift.</Text>
  </View>;
  if (section === 'decorate') {
    const panelHeight = Math.min(355, Math.max(260, height * .41));
    const previewHeight = Math.max(210, height - insets.top - insets.bottom - 72 - panelHeight);
    return <View style={styles.root}>
      <View style={[styles.decorateHeader, { height: 72 + insets.top, paddingTop: insets.top + 6 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel decorating" onPress={() => router.back()} style={[styles.cancel,{flexDirection:'row',alignItems:'center'}]}><BackIcon/><Text style={styles.cancelText}>Cancel</Text></Pressable>
        <Text style={styles.decorateTitle}>Decorate</Text>
        <Pressable accessibilityRole="button" accessibilityState={{disabled:!canReplace}}
          onPress={() => {if(canReplace)void applyRoom(selectedSlots);}} disabled={!canReplace}
          style={[styles.doneButton, !canReplace && { opacity: .45 }]}><Text style={styles.doneText}>{inUse?'In use':'Replace'}</Text></Pressable>
      </View>
      <View style={[styles.decoratePreview, { height: previewHeight }]}>
          <HomeArtPreview timeZone={data.profile.timezone_name} slots={selectedSlots} photos={data.roomPhotos} ownerId={viewOwnerId} away={away}
          availableHeight={previewHeight} onSlot={chooseSlot} />
        <Pressable accessibilityRole="button" onPress={() => { setDraft(null); setMessage(null); }} style={styles.reset}>
          <Text style={styles.resetText}>↶  Reset</Text>
        </Pressable>
      </View>
      <View style={[styles.decoratePanel, { height: panelHeight + insets.bottom, paddingBottom: insets.bottom + 8 }]}>
        {nonPlaceable ? <View style={styles.collectiblePreview}>
          <Artwork item={nonPlaceable} size={94} />
          <Text style={styles.optionName}>{nonPlaceable.title}</Text>
          <Text style={styles.optionPrice}>Owned</Text>
          <Text style={styles.optionPrice}>This collectible has no Home placement slot</Text>
        </View> : <>
          <CategoryRail selected={category} onChange={changeCategory} />
          <DecorationOptions key={category} items={selectedItems}
            selectedId={selectedSlots[categorySlot[category]]?.stable_id} owned={category==='outfits'?mine:inventory}
            hasPlus={data.hasPlus} onSelect={selectDecoration}/>
        </>}
        {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
        <View style={styles.totalRow}><CoinLabel iconSize={22} style={styles.total}>{ownedOnly ? readOnly ? 'Partner’s collection' : 'Your collection' : `Total: {coin} ${total}`}</CoinLabel>
          {!ownedOnly&&<Pressable accessibilityRole="button" disabled={saving || total === 0} onPress={() => void applyRoom(selectedSlots)}
            style={[styles.pay, (saving || total === 0) && { opacity: .45 }]}><Text style={styles.payText}>{total ? 'Pay' : 'Owned'}</Text></Pressable>}</View>
      </View>
    </View>;
  }

  if (detail) {
    const detailName = detail.item.title;
    const previewHeight = Math.max(295, height - insets.top - insets.bottom - 285);
    const detailOwned=(giftMode?partnerOwned:(detail.item.category==='outfits'?mine:inventory)).has(detail.item.stable_id);
    const detailPlusLocked=detail.item.plus_only&&!data.hasPlus&&!detailOwned;
    const variants = decorationOptions(data.catalog,detail.item.category,false,viewOwnerId,data.inventory)
        .filter(item=>!isDefaultOutfit(item)&&(!giftMode||(item.tradable&&!!item.price)))
        .map(item => ({ title: item.title, item }));
    return <View style={styles.root}>
      <View style={[styles.detailPreview, { height: previewHeight + insets.top }]}>
        <HomeArtPreview timeZone={data.profile.timezone_name} slots={preview} photos={data.roomPhotos} ownerId={viewOwnerId} away={away}
          availableHeight={previewHeight + insets.top} />
        <View style={[styles.detailTop, { top: insets.top + 7 }]}>
          <BurrowBackButton light onPress={() => router.back()} />
          <CoinWallet balance={data.wallet.balance} onPress={carrots}/>
        </View>
      </View>
      <View style={[styles.detailSheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handle} /><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={[styles.detailTitle, { flexShrink: 1 }]}>{detailName}</Text>
          <ShopItemPrice item={detail.item} hasPlus={data.hasPlus} owned={detailOwned} fontSize={17}/>
        </View>
        {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
        <Button label={detailPlusLocked ? 'Try Plus' : giftMode ? `Gift ${data.partner?.display_name?.trim()||'your person'} · {coin} ${detailPrice}` : detailPrice ? `Buy for {coin} ${detailPrice}` : 'Place in my room'}
          disabled={saving || (giftMode&&(!detail.item.tradable||!detail.item.price))} onPress={() => {
            if(detailPlusLocked){router.push('/(main)/(modals)/subscription-paywall' as Href);return;}
            if(giftMode)giftItem(detail.item);else void (detail.kind === 'item' && detail.item.category === 'outfits'
            ? buyOutfit(detail.item) : applyRoom(preview));}} />
        {!giftMode&&detail.kind === 'item' && <Button outline label="Gift My Partner" disabled={saving || !detail.item.tradable || !detail.item.price}
          onPress={() => giftItem(detail.item)} />}
        <FlatList horizontal data={variants} keyExtractor={choice=>choice.item.stable_id} initialNumToRender={4} maxToRenderPerBatch={4} windowSize={3}
          directionalLockEnabled bounces={false} alwaysBounceVertical={false} alwaysBounceHorizontal={false} overScrollMode="never"
          showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.variants} renderItem={({item:choice}) => <Pressable accessibilityRole="button"
            accessibilityLabel={`Preview ${choice.title}`} onPress={() => setDetail({ kind: 'item', item: choice.item })}
            style={[styles.variant, choice.item.stable_id === detail.item.stable_id && styles.variantSelected]}>
            <Artwork item={choice.item} size={68} />
          </Pressable>}/>
      </View>
    </View>;
  }

  return <View style={styles.root}>
    {!giftMode&&!ownedOnly&&<ShopGiftInbox data={data} artwork={(item,size)=><Artwork item={item} size={size}/>}/>}
    <View style={[styles.shopHeader, { paddingTop: insets.top + 16 }]}>
      <Image source={BURROW_BACKGROUNDS.common} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject} />
      <View style={styles.headerWash} />
      <View style={styles.shopHeaderRow}>
        <BurrowBackButton onPress={() => router.back()} />
        <View pointerEvents="none" style={styles.shopTitleLayer}>
          <Text style={styles.shopTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.5}>{giftMode?'Gift Shop':'Shop'}</Text>
        </View>
        <CoinWallet balance={data.wallet.balance} onPress={carrots}/>
      </View>
    </View>
    <ShopCategoryBrowser>
      <CategoryRail selected={category} onChange={changeCategory} />
      <ShopCategoryPager selected={category} selectionRevision={categoryRevision} onChange={changeCategory} pages={pages} width={width} owned={inventory} mine={mine}
        partnerOwned={partnerOwned} giftMode={giftMode} hasPlus={data.hasPlus} partnerName={data.partner?.display_name?.trim()||'your person'} onOpen={openDetail}/>
    </ShopCategoryBrowser>
    <View style={[styles.shopFooter, { paddingBottom: insets.bottom + 10 }]}>
      <View style={{ flex: 1 }}><Button outline label="My collection" onPress={collection} /></View>
      <View style={{ flex: 1 }}><Button label="Decorate room" onPress={() => router.push({ pathname: '/(main)/burrow-detail', params: { section: 'decorate' } } as Href)} /></View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: cream },
  categoryBrowser:{flex:1},
  // Previously the controls began ~32pt below the safe area. Use half that
  // space and one shared row instead of an independently positioned title.
  shopHeader: { paddingHorizontal:18,paddingBottom:16,overflow:'hidden' },
  shopHeaderRow: { minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between' },
  shopTitleLayer: {...StyleSheet.absoluteFillObject,alignItems:'center',justifyContent:'center'},
  headerWash: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(127,47,22,.38)' },
  shopTitle: { maxWidth:'25%',textAlign:'center',color:'#FFF',fontSize:28,fontWeight:'900' },
  rail: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: '#E9DDD1', backgroundColor: '#FFFBF5' },
  railItems: { alignItems: 'center', paddingHorizontal: 9 },
  railItem: { width: 62, height: 61, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  railSelected: { borderBottomColor: rust },
  list: { flex: 1 },
  sectionTitle: { fontSize: 28, fontWeight: '900', color: brown, marginTop: 4 },
  sectionTitleAlone: { marginBottom:15 },
  subtitle: { fontSize: 14, color: '#947262', marginTop: 2, marginBottom: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  product: { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#F2E8DB', borderRadius: 15, padding: 5,
    alignItems: 'center', gap: 4, overflow: 'hidden' },
  productTitle: { fontSize: 12, fontWeight: '800', color: brown, textAlign: 'center', minHeight: 31 },
  productOffer: { minHeight: 32, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#8F7666', textAlign: 'center', marginTop: 35 },
  shopFooter: { flexDirection: 'row', gap: 9, paddingTop: 9, paddingHorizontal: 14, backgroundColor: cream,
    borderTopWidth: 1, borderTopColor: '#EFE2D5' },
  button: { width: '100%', minHeight: 45, backgroundColor: rust, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  buttonText: { color: '#FFF', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  outlineButton: { backgroundColor: '#FFFDF7', borderColor: '#C9957C', borderWidth: 1 },
  outlineButtonText: { color: '#A45235' },
  detailPreview: { backgroundColor: '#9B4A2B', alignItems: 'center', justifyContent: 'flex-end' },
  detailTop: { position: 'absolute', left: 16, right: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailSheet: { flex: 1, backgroundColor: cream, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 18, paddingTop: 9, gap: 7, marginTop: -12 },
  handle: { width: 45, height: 5, borderRadius: 4, backgroundColor: '#DDCDBD', alignSelf: 'center', marginBottom: 2 },
  detailTitle: { color: brown, fontSize: 25, fontWeight: '900', marginBottom: 3 },
  variants: { gap: 9, alignItems: 'center', paddingVertical: 4 },
  variant: { width: 72, height: 78, borderRadius: 10, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  variantSelected: { borderColor: rust },
  decorateHeader: { height: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: cream },
  cancel: { minWidth: 80, justifyContent: 'center' },
  cancelText: { color: brown, fontSize: 15, fontWeight: '800' },
  decorateTitle: { color: brown, fontSize: 23, fontWeight: '900' },
  doneButton: { backgroundColor: rust, paddingHorizontal: 20, paddingVertical: 9, borderRadius: 13 },
  doneText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
  decoratePreview: { backgroundColor: '#A55231', alignItems: 'center', justifyContent: 'center' },
  reset: { position: 'absolute', top: 12, right: 13, backgroundColor: cream, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  resetText: { color: brown, fontSize: 14, fontWeight: '800' },
  decoratePanel: { backgroundColor: cream, borderTopLeftRadius: 22, borderTopRightRadius: 22, marginTop: -10, overflow: 'hidden' },
  collectiblePreview: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  optionRow: { paddingHorizontal: OPTION_INSET, paddingTop: 12, paddingBottom: 8 },
  optionSeparator: { width: OPTION_GAP },
  optionCard: { width: 105, height: 126, backgroundColor: '#FFFCF7', borderRadius: 13, borderWidth: 1, borderColor: '#F1E5D7', alignItems: 'center', justifyContent: 'center' },
  optionSelected: { borderColor: rust, borderWidth: 2 },
  optionName: { color: brown, fontSize: 11, fontWeight: '800', marginTop: 2 },
  optionPrice: { color: brown, fontSize: 11, fontWeight: '700', marginTop: 3 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 7 },
  total: { color: brown, fontSize: 19, fontWeight: '900' },
  pay: { backgroundColor: rust, minWidth: 103, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  payText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
  error: { color: '#A43E2A', fontSize: 12, textAlign: 'center' },
});
