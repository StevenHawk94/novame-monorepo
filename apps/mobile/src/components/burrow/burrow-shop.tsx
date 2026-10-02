import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image as NativeImage, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BURROW_DECOR_SHOP_CATEGORIES } from '@novame/domain';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { purchaseCatalogItem, purchaseRoomLoadout, saveBunnyOutfit, saveRoomLoadout } from '@/lib/app-major-update-api';
import { refreshBurrow, runBurrowAction, setBurrowLoadoutLocally } from '@/lib/burrow-store';
import { roomSlots } from '@/lib/burrow-presentation';
import { decorationOptions } from '@/lib/burrow-collection-options';
import { BURROW_BACKGROUNDS, burrowArtForItem } from '@/lib/burrow-art-assets';
import { BURROW_SHOP_ICONS } from '@/lib/burrow-shop-icons';
import { BurrowBackButton } from './burrow-back-button';
import { BunnyActor } from './bunny-actor';
import { HomeArtPreview } from './home-art-preview';

const cream = '#FFF9EF';
const brown = '#4A281E';
const rust = '#C9552C';
const categories = ['rooms', 'outfits', ...BURROW_DECOR_SHOP_CATEGORIES] as const;
type Category = typeof categories[number];
type Detail = { kind: 'item'; item: MajorUpdateCatalogItem } | { kind: 'room'; index: number };
type RoomLook = { title: string; art: number; ordinal: number };
const looks: RoomLook[] = [
  { title: 'Cozy Cave', art: 0, ordinal: 2 },
  { title: 'Forest Nook', art: 1, ordinal: 3 },
  { title: 'Moonlit Cave', art: 2, ordinal: 4 },
  { title: 'Golden Glow', art: 3, ordinal: 5 },
  { title: 'Cozy Corner', art: 4, ordinal: 6 },
  { title: 'Rosy Retreat', art: 5, ordinal: 7 },
  { title: 'Mossy Den', art: 6, ordinal: 8 },
  { title: 'Ocean Grotto', art: 7, ordinal: 9 },
  { title: 'Autumn Burrow', art: 8, ordinal: 1 },
];
const roomArt = [
  require('../../../assets/burrow-shop-rooms/cozy-cave.png'),
  require('../../../assets/burrow-shop-rooms/forest-nook.png'),
  require('../../../assets/burrow-shop-rooms/moonlit-cave.png'),
  require('../../../assets/burrow-shop-rooms/golden-glow.png'),
  require('../../../assets/burrow-shop-rooms/cozy-corner.png'),
  require('../../../assets/burrow-shop-rooms/rosy-retreat.png'),
  require('../../../assets/burrow-shop-rooms/mossy-den.png'),
  require('../../../assets/burrow-shop-rooms/ocean-grotto.png'),
  require('../../../assets/burrow-shop-rooms/autumn-burrow.png'),
];
const categorySlot: Record<string, string> = {
  cushions: 'cushion', tables: 'table', rugs: 'rug', vases: 'vase', lamps: 'lamp',
  windows: 'window', cabinets: 'cabinet', shelves: 'shelf', shelf_decor: 'shelf_decor',
  music_players: 'music_player', frames: 'frame', posters: 'poster',
  couple_dolls: 'couple_doll', light_strings: 'light_string', ladders: 'ladder',
  dresser_plants: 'dresser_plant', outfits: 'outfit',
};
const name = (category: string) => ({ rooms: 'Rooms', shelf_decor: 'Decorations',
  dresser_plants: 'Succulents', light_strings: 'String lights', couple_dolls: 'Couple dolls',
  music_players: 'Music players', frames: 'Photo frames' }[category] ??
  category.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()));

function Artwork({ item, size }: { item: MajorUpdateCatalogItem; size: number }) {
  if (item.category === 'outfits') return <View style={{ width: size, height: size }}>
    <BunnyActor outfit={item} standalone standaloneSize={{ width: size, height: size }} />
  </View>;
  const asset = burrowArtForItem(item);
  if (!asset) return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <NativeImage source={BURROW_SHOP_ICONS[item.category as keyof typeof BURROW_SHOP_ICONS] ?? BURROW_SHOP_ICONS.outfits}
      resizeMode="contain" style={{ width: size * .55, height: size * .55 }} />
  </View>;
  const [left, top, right, bottom] = asset.bounds;
  const ratio = Math.min(size / (right - left), size / (bottom - top));
  return <View style={{ width: size, height: size, overflow: 'hidden' }}>
    <Image source={asset.source} contentFit="fill" style={{ position: 'absolute',
      left: (size - (right - left) * ratio) / 2 - left * ratio,
      top: (size - (bottom - top) * ratio) / 2 - top * ratio,
      width: asset.width * ratio, height: asset.height * ratio }} />
  </View>;
}

function Button({ label, onPress, outline = false, disabled = false }: {
  label: string; onPress: () => void; outline?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, outline && styles.outlineButton, (pressed || disabled) && { opacity: .55 }]}>
    <Text style={[styles.buttonText, outline && styles.outlineButtonText]}>{label}</Text>
  </Pressable>;
}

function CategoryRail({ includeRooms, selected, onChange }: {
  includeRooms: boolean; selected: Category; onChange: (category: Category) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  useEffect(() => {
    const index = (includeRooms ? categories : categories.slice(1)).indexOf(selected);
    if (index >= 0) ref.current?.scrollTo({ x: Math.max(0, index * 62 - width / 2 + 31), animated: true });
  }, [includeRooms, selected, width]);
  return <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} style={styles.rail}
    contentContainerStyle={styles.railItems}>
    {(includeRooms ? categories : categories.slice(1)).map(cat => <Pressable key={cat} accessibilityRole="button"
      accessibilityLabel={name(cat)} accessibilityState={{ selected: selected === cat }}
      onPress={() => onChange(cat)} style={[styles.railItem, selected === cat && styles.railSelected]}>
      {cat === 'rooms' ? <Image source={require('../../../assets/burrow-webp/home tab icons/home-selected.webp')}
        contentFit="contain" style={styles.railIcon} />
        : <NativeImage source={BURROW_SHOP_ICONS[cat]} resizeMode="contain"
          style={[styles.railIcon, { tintColor: selected === cat ? rust : '#A57C65' }]} />}
    </Pressable>)}
  </ScrollView>;
}

function RoomPreset(data: MajorUpdateBootstrap, current: Record<string, MajorUpdateCatalogItem>, index: number) {
  const next = { ...current };
  // Bundles are real combinations of published Home decorations, not a
  // screenshot pretending that an unavailable theme can be purchased.
  const used = ['windows', 'cushions', 'rugs', 'vases', 'lamps', 'cabinets', 'shelves'];
  for (let position = 0; position < used.length; position++) {
    const category = used[position];
    const options = data.catalog.filter(item => item.category === category && item.metadata.slot)
      .sort((a, b) => (a.metadata.artOrdinal ?? 0) - (b.metadata.artOrdinal ?? 0));
    if (!options.length) continue;
    const chosen = options[(looks[index].ordinal - 1 + position) % options.length];
    next[chosen.metadata.slot!] = chosen;
  }
  return next;
}

export function BurrowShop({ data, section, initialCategory, away, initialDetail, ownedOnly = false, initialItemId, collectionOwnerId }: {
  data: MajorUpdateBootstrap;
  section: 'shop' | 'decorate';
  initialCategory: string;
  away: boolean;
  initialDetail?: { itemId?: string; roomIndex?: number };
  ownedOnly?: boolean;
  initialItemId?: string;
  collectionOwnerId?: string;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const viewOwnerId = ownedOnly && data.partner && collectionOwnerId === data.partner.id ? data.partner.id : data.profile.id;
  const readOnly = viewOwnerId !== data.profile.id;
  const [category, setCategory] = useState<Category>(section === 'decorate'
    ? (categories.includes(initialCategory as Category) ? initialCategory as Category : 'windows') : 'rooms');
  const [detail, setDetail] = useState<Detail | null>(() => initialDetail?.roomIndex != null &&
    initialDetail.roomIndex >= 0 && initialDetail.roomIndex < looks.length
    ? { kind: 'room', index: initialDetail.roomIndex }
    : initialDetail?.itemId ? (() => { const item = data.catalog.find(entry => entry.stable_id === initialDetail.itemId);
      return item ? { kind: 'item' as const, item } : null; })() : null);
  const [draft, setDraft] = useState<Record<string, MajorUpdateCatalogItem> | null>(() => {
    if (!ownedOnly || !initialItemId) return null;
    const item = data.catalog.find(entry => entry.stable_id === initialItemId);
    if (!item?.metadata.slot || !categories.includes(item.category as Category) ||
      !data.inventory.some(row => row.owner_id === viewOwnerId && row.item_id === item.stable_id)) return null;
    return { ...roomSlots(data, viewOwnerId), [item.metadata.slot]: item };
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const saved = useMemo(() => roomSlots(data, viewOwnerId), [data, viewOwnerId]);
  const selectedSlots = draft ?? saved;
  const preview = detail?.kind === 'room' ? RoomPreset(data, saved, detail.index)
    : detail?.kind === 'item' && detail.item.metadata.slot
      ? { ...saved, [detail.item.metadata.slot]: detail.item } : saved;
  const inventory = useMemo(() => new Set(data.inventory.filter(row => row.owner_id === data.profile.id || row.owner_id === data.partner?.id)
    .map(row => row.item_id)), [data.inventory, data.profile.id, data.partner?.id]);
  const mine = useMemo(() => new Set(data.inventory.filter(row => row.owner_id === data.profile.id).map(row => row.item_id)), [data.inventory, data.profile.id]);
  const nonPlaceable = ownedOnly && initialItemId ? data.catalog.find(item =>
    item.stable_id === initialItemId && (!item.metadata.slot || !categories.includes(item.category as Category))) : undefined;
  const unowned = (slots: Record<string, MajorUpdateCatalogItem>) => Object.entries(slots)
    .filter(([slot, item]) => slot !== 'outfit' && !!item.metadata.slot && !inventory.has(item.stable_id))
    .map(([, item]) => item);
  const changedOutfit = (slots: Record<string, MajorUpdateCatalogItem>) => slots.outfit?.stable_id !== saved.outfit?.stable_id ? slots.outfit : undefined;
  const cost = (slots: Record<string, MajorUpdateCatalogItem>) => unowned(slots)
    .reduce((sum, item) => sum + (item.price ?? 0), 0) +
    (changedOutfit(slots) && !mine.has(slots.outfit.stable_id) ? slots.outfit.price ?? 0 : 0);
  const total = ownedOnly ? 0 : cost(selectedSlots);
  const detailPrice = detail?.kind === 'item' && detail.item.category === 'outfits'
    ? mine.has(detail.item.stable_id) ? 0 : detail.item.price ?? 0 : cost(preview);
  const fullRoomIds = (slots: Record<string, MajorUpdateCatalogItem>) => Object.fromEntries(Object.entries(slots)
    .filter(([slot, item]) => slot !== 'outfit' && item.item_type === 'decor' && !!item.metadata.slot)
    .map(([slot, item]) => [slot, item.stable_id]));
  const openDetail = (next: Detail) => router.push({ pathname: '/(main)/shop-detail', params: next.kind === 'room'
    ? { roomIndex: String(next.index) } : { itemId: next.item.stable_id } } as Href);
  const collection = () => router.push({ pathname: '/(main)/burrow-detail', params: { section: 'collection' } } as Href);
  const carrots = () => router.push({ pathname: '/(main)/burrow-detail', params: { section: 'carrot_shop' } } as Href);
  const changeCategory = (next: Category) => { setCategory(next); setMessage(null); };
  const chooseSlot = (slot: string) => {
    const found = categories.find(item => categorySlot[item] === slot);
    if (found) setCategory(found);
  };

  async function applyRoom(slots: Record<string, MajorUpdateCatalogItem>) {
    if (readOnly) { router.back(); return; }
    if (saving) return;
    const missing = unowned(slots);
    const outfit = changedOutfit(slots);
    if (ownedOnly && (missing.length > 0 || (outfit && !mine.has(outfit.stable_id)))) {
      setMessage('This collection view can only place items you already own.');
      return;
    }
    if ([...missing, ...(outfit && !mine.has(outfit.stable_id) ? [outfit] : [])].some(item => item.plus_only && !data.hasPlus)) {
      router.push('/(main)/(modals)/subscription-paywall' as Href); return;
    }
    if (cost(slots) > data.wallet.balance) { carrots(); return; }
    setSaving(true); setMessage(null);
    const ids = fullRoomIds(slots);
    try {
      const succeeded = await runBurrowAction(`room-checkout:${Object.values(ids).join(',')}:${outfit?.stable_id ?? ''}`,
        key => missing.length || outfit ? purchaseRoomLoadout(ids, key, outfit?.stable_id) : saveRoomLoadout('home', ids), { silent: true });
      if (!succeeded) { setMessage('Could not finish this room. No incomplete purchase was applied. Please try again.'); return; }
      setBurrowLoadoutLocally(ids, data.profile.id);
      if (outfit) setBurrowLoadoutLocally({ outfit: outfit.stable_id }, data.profile.id, true);
      setDetail(null); setDraft(null);
      router.navigate('/(main)/(tabs)' as Href);
      void refreshBurrow({ silent: true });
    } finally { setSaving(false); }
  }

  async function buyOutfit(item: MajorUpdateCatalogItem) {
    if (saving) return;
    if (item.plus_only && !data.hasPlus) { router.push('/(main)/(modals)/subscription-paywall' as Href); return; }
    if (!mine.has(item.stable_id) && (item.price ?? 0) > data.wallet.balance) { carrots(); return; }
    setSaving(true); setMessage(null);
    try {
      if (!mine.has(item.stable_id)) {
        const bought = await runBurrowAction(`outfit-buy:${item.stable_id}`,
          key => purchaseCatalogItem(item.stable_id, data.profile.id, key), { silent: true });
        if (!bought) { setMessage('The outfit could not be purchased. Please try again.'); return; }
      }
      const savedOutfit = await runBurrowAction(`outfit-equip:${item.stable_id}`,
        () => saveBunnyOutfit(item.stable_id), { silent: true });
      if (!savedOutfit) { setMessage('The outfit was purchased, but could not be equipped yet. Try again.'); return; }
      setBurrowLoadoutLocally({ outfit: item.stable_id }, data.profile.id, true);
      router.navigate('/(main)/(tabs)' as Href);
    } finally { setSaving(false); }
  }

  function giftItem(item: MajorUpdateCatalogItem) {
    if (!data.partner) { Alert.alert('Connect first', 'Connect with your person to send a gift.'); return; }
    if (!item.tradable) { Alert.alert('Not giftable', 'This item is only for your room.'); return; }
    Alert.alert('Gift my partner?', `${item.title} · 🥕 ${item.price ?? 0}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send gift', onPress: () => {
        setSaving(true); setMessage(null);
        void runBurrowAction(`gift:${item.stable_id}:${data.partner!.id}`,
          key => purchaseCatalogItem(item.stable_id, data.partner!.id, key), { silent: true })
          .then(succeeded => {
            if (succeeded) { setDetail(null); Alert.alert('Gift sent', `${item.title} is on its way to your person.`); }
            else setMessage('The gift could not be sent. Please try again.');
          }).finally(() => setSaving(false));
      } },
    ]);
  }

  const selectedItems = decorationOptions(data.catalog, category, ownedOnly, viewOwnerId, data.inventory);
  const column = (width - 40 - 16) / 3;

  if (section === 'decorate') {
    const panelHeight = Math.min(355, Math.max(260, height * .41));
    const previewHeight = Math.max(210, height - insets.top - insets.bottom - 72 - panelHeight);
    return <View style={styles.root}>
      <View style={[styles.decorateHeader, { height: 72 + insets.top, paddingTop: insets.top + 6 }]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.cancel}><Text style={styles.cancelText}>‹  Cancel</Text></Pressable>
        <Text style={styles.decorateTitle}>Decorate</Text>
        <Pressable accessibilityRole="button" onPress={() => nonPlaceable ? router.back() : void applyRoom(selectedSlots)} disabled={saving || total > 0}
          style={[styles.doneButton, (saving || total > 0) && { opacity: .45 }]}><Text style={styles.doneText}>Done</Text></Pressable>
      </View>
      <View style={[styles.decoratePreview, { height: previewHeight }]}>
        <HomeArtPreview slots={selectedSlots} photos={data.roomPhotos} ownerId={viewOwnerId} away={away}
          availableHeight={previewHeight} onSlot={chooseSlot} />
        <Pressable accessibilityRole="button" onPress={() => { setDraft(null); setMessage(null); }} style={styles.reset}>
          <Text style={styles.resetText}>↶  Reset</Text>
        </Pressable>
      </View>
      <View style={[styles.decoratePanel, { height: panelHeight + insets.bottom, paddingBottom: insets.bottom + 8 }]}>
        {nonPlaceable ? <View style={styles.collectiblePreview}>
          <Artwork item={nonPlaceable} size={94} />
          <Text style={styles.optionName}>{nonPlaceable.title}</Text>
          <Text style={styles.optionPrice}>✓ Owned · this collectible has no Home placement slot</Text>
        </View> : <>
          <CategoryRail includeRooms={false} selected={category} onChange={changeCategory} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
            {selectedItems.map(item => <Pressable key={item.stable_id} accessibilityRole="button"
              accessibilityLabel={`Preview ${item.title}`} accessibilityState={{ selected: selectedSlots[item.metadata.slot ?? '']?.stable_id === item.stable_id }}
              onPress={() => { if (item.metadata.slot) setDraft({ ...selectedSlots, [item.metadata.slot]: item }); }}
              style={[styles.optionCard, selectedSlots[item.metadata.slot ?? '']?.stable_id === item.stable_id && styles.optionSelected]}>
              <Artwork item={item} size={74} /><Text numberOfLines={1} style={styles.optionName}>{item.title.replace(/^.* · /, '')}</Text>
              <Text style={styles.optionPrice}>{inventory.has(item.stable_id) ? '✓ Owned' : item.plus_only ? '✦ PLUS' : `🥕 ${item.price ?? '—'}`}</Text>
            </Pressable>)}
          </ScrollView>
        </>}
        {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
        <View style={styles.totalRow}><Text style={styles.total}>{ownedOnly ? readOnly ? 'Partner’s collection' : 'Your collection' : `Total: 🥕 ${total}`}</Text>
          {!ownedOnly&&<Pressable accessibilityRole="button" disabled={saving || total === 0} onPress={() => void applyRoom(selectedSlots)}
            style={[styles.pay, (saving || total === 0) && { opacity: .45 }]}><Text style={styles.payText}>{saving ? 'Saving…' : total ? 'Pay' : 'Owned'}</Text></Pressable>}</View>
      </View>
    </View>;
  }

  if (detail) {
    const detailName = detail.kind === 'room' ? looks[detail.index].title : detail.item.title;
    const previewHeight = Math.max(295, height - insets.top - insets.bottom - 285);
    const variants = detail.kind === 'room' ? looks.map((look, index) => ({ title: look.title, index })) :
      data.catalog.filter(item => item.category === detail.item.category && (item.price != null || item.metadata.starter))
        .map(item => ({ title: item.title, item }));
    return <View style={styles.root}>
      <View style={[styles.detailPreview, { height: previewHeight + insets.top }]}>
        <HomeArtPreview slots={preview} photos={data.roomPhotos} ownerId={data.profile.id} away={away}
          availableHeight={previewHeight + insets.top} />
        <View style={[styles.detailTop, { top: insets.top + 7 }]}>
          <BurrowBackButton light onPress={() => router.back()} />
          <Pressable accessibilityRole="button" onPress={carrots} style={styles.wallet}><Text style={styles.walletText}>🥕 {data.wallet.balance.toLocaleString()}  ✚</Text></Pressable>
        </View>
      </View>
      <View style={[styles.detailSheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handle} /><Text numberOfLines={1} style={styles.detailTitle}>{detailName}  <Text style={styles.price}>🥕 {detailPrice}</Text></Text>
        {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
        <Button label={saving ? 'Saving…' : detailPrice ? `Buy for 🥕 ${detailPrice}` : 'Place in my room'}
          disabled={saving} onPress={() => void (detail.kind === 'item' && detail.item.category === 'outfits'
            ? buyOutfit(detail.item) : applyRoom(preview))} />
        {detail.kind === 'item' && <Button outline label="Gift My Partner" disabled={saving || !detail.item.tradable || !detail.item.price}
          onPress={() => giftItem(detail.item)} />}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.variants}>
          {variants.map((choice, index) => <Pressable key={choice.title + index} accessibilityRole="button"
            accessibilityLabel={`Preview ${choice.title}`} onPress={() => setDetail('index' in choice ? { kind: 'room', index: choice.index } : { kind: 'item', item: choice.item! })}
            style={[styles.variant, index === (detail.kind === 'room' ? detail.index : variants.findIndex(v => 'item' in v && v.item?.stable_id === detail.item.stable_id)) && styles.variantSelected]}>
            {'index' in choice ? <Image source={roomArt[choice.index]} contentFit="cover" style={styles.variantImage} />
              : <Artwork item={choice.item!} size={68} />}
          </Pressable>)}
        </ScrollView>
      </View>
    </View>;
  }

  return <View style={styles.root}>
    <View style={[styles.shopHeader, { height: 103 + insets.top, paddingTop: insets.top + 6 }]}>
      <Image source={BURROW_BACKGROUNDS.home} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFillObject} />
      <View style={styles.headerWash} />
      <BurrowBackButton onPress={() => router.back()} />
      <Text style={[styles.shopTitle, { top: 47 + insets.top }]}>Shop</Text>
      <Pressable accessibilityRole="button" onPress={carrots} style={styles.wallet}><Text style={styles.walletText}>🥕 {data.wallet.balance.toLocaleString()}  ✚</Text></Pressable>
    </View>
    <CategoryRail includeRooms selected={category} onChange={changeCategory} />
    <ScrollView style={styles.list} contentContainerStyle={{ padding: 18, paddingBottom: 30 }}>
      <Text style={styles.sectionTitle}>{name(category)}</Text>
      <Text style={styles.subtitle}>Make your burrow feel like yours.</Text>
      <View style={styles.grid}>
        {category === 'rooms' ? looks.map((look, index) => {
          const amount = cost(RoomPreset(data, saved, index));
          return <Pressable key={look.title} accessibilityRole="button" accessibilityLabel={`Preview ${look.title}`}
            onPress={() => openDetail({ kind: 'room', index })} style={[styles.product, { width: column }]}>
            <Image source={roomArt[look.art]} contentFit="cover" style={[styles.roomThumb, { height: column * 1.13 }]} />
            <Text numberOfLines={2} style={styles.productTitle}>{look.title}</Text>
            <Text style={styles.productPrice}>{amount ? `🥕 ${amount}` : '✓ Owned'}</Text>
          </Pressable>;
        }) : selectedItems.map(item => <Pressable key={item.stable_id} accessibilityRole="button"
          accessibilityLabel={`Preview ${item.title}`} onPress={() => openDetail({ kind: 'item', item })}
          style={[styles.product, { width: column }]}><Artwork item={item} size={column - 12} />
          <Text numberOfLines={2} style={styles.productTitle}>{item.title}</Text>
          <Text style={styles.productPrice}>{(item.category === 'outfits' ? mine : inventory).has(item.stable_id) ? '✓ Owned' : item.plus_only ? '✦ PLUS' : `🥕 ${item.price ?? '—'}`}</Text>
        </Pressable>)}
      </View>
      {category !== 'rooms' && !selectedItems.length && <Text style={styles.empty}>More designs are coming soon.</Text>}
    </ScrollView>
    <View style={[styles.shopFooter, { paddingBottom: insets.bottom + 10 }]}>
      <View style={{ flex: 1 }}><Button outline label="My collection" onPress={collection} /></View>
      <View style={{ flex: 1 }}><Button label="Decorate room" onPress={() => router.push({ pathname: '/(main)/burrow-detail', params: { section: 'decorate' } } as Href)} /></View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: cream },
  shopHeader: { height: 103, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, overflow: 'hidden' },
  headerWash: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(127,47,22,.38)' },
  shopTitle: { position: 'absolute', left: 0, right: 0, textAlign: 'center', top: 47, color: '#FFF', fontSize: 28, fontWeight: '900' },
  wallet: { backgroundColor: cream, paddingHorizontal: 12, minHeight: 43, borderRadius: 24, justifyContent: 'center' },
  walletText: { color: '#231B17', fontSize: 15, fontWeight: '900' },
  rail: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: '#E9DDD1', backgroundColor: '#FFFBF5' },
  railItems: { alignItems: 'center', paddingHorizontal: 9 },
  railItem: { width: 62, height: 61, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  railSelected: { borderBottomColor: rust },
  railIcon: { width: 38, height: 38 },
  list: { flex: 1 },
  sectionTitle: { fontSize: 28, fontWeight: '900', color: brown, marginTop: 4 },
  subtitle: { fontSize: 14, color: '#947262', marginTop: 2, marginBottom: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  product: { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#F2E8DB', borderRadius: 15, padding: 5,
    alignItems: 'center', gap: 4, overflow: 'hidden' },
  roomThumb: { width: '100%', borderRadius: 10 },
  productTitle: { fontSize: 12, fontWeight: '800', color: brown, textAlign: 'center', minHeight: 31 },
  productPrice: { fontSize: 12, fontWeight: '800', color: '#2D8E69', paddingBottom: 3 },
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
  price: { fontSize: 17, fontWeight: '800' },
  variants: { gap: 9, alignItems: 'center', paddingVertical: 4 },
  variant: { width: 72, height: 78, borderRadius: 10, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  variantSelected: { borderColor: rust },
  variantImage: { width: '100%', height: '100%' },
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
  optionRow: { gap: 9, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  optionCard: { width: 105, height: 126, backgroundColor: '#FFFCF7', borderRadius: 13, borderWidth: 1, borderColor: '#F1E5D7', alignItems: 'center', justifyContent: 'center' },
  optionSelected: { borderColor: rust, borderWidth: 2 },
  optionName: { color: brown, fontSize: 11, fontWeight: '800', marginTop: 2 },
  optionPrice: { color: '#2B9469', fontSize: 11, fontWeight: '700', marginTop: 3 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 7 },
  total: { color: brown, fontSize: 19, fontWeight: '900' },
  pay: { backgroundColor: rust, minWidth: 103, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  payText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
  error: { color: '#A43E2A', fontSize: 12, textAlign: 'center' },
});
