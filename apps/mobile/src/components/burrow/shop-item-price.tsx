import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { shopItemPrice } from '@/lib/shop-item-price';
import { CoinIcon } from './coin-ui';

/** One Shop price treatment for product grids, decoration choices and detail. */
export const ShopItemPrice = memo(function ShopItemPrice({ item, hasPlus, owned, fontSize = 16, numberColor = '#4A281E' }: {
  item: Pick<MajorUpdateCatalogItem,'price'|'plus_only'>; hasPlus: boolean; owned: boolean; fontSize?: number; numberColor?: string;
}) {
  const offer = shopItemPrice(item,hasPlus,owned);
  if (offer.kind === 'plus') return <View accessible accessibilityLabel={offer.label} style={[s.badge,{minHeight:fontSize*1.9}]}>
    <Svg width={fontSize*1.4} height={fontSize*1.4} viewBox="0 0 24 24" accessible={false}>
      <Path fill="#FFD16B" d="M3 19 1.4 6.5a1 1 0 0 1 1.7-.8l4.4 4.4 3.6-7a1 1 0 0 1 1.8 0l3.6 7 4.4-4.4a1 1 0 0 1 1.7.8L21 19c-5.8 1.1-12.2 1.1-18 0Z"/>
    </Svg>
    <Text accessible={false} style={[s.plus,{fontSize:fontSize-1,lineHeight:fontSize*1.3}]}>PLUS</Text>
  </View>;
  if (offer.kind === 'owned') return <Text style={[s.owned,{fontSize:Math.min(fontSize,14)}]}>Owned</Text>;
  if (offer.price == null) return <Text style={[s.number,{fontSize,color:numberColor}]}>—</Text>;
  return <View accessible accessibilityLabel={offer.label} style={s.price}>
    <CoinIcon size={fontSize*1.55}/>
    <Text accessible={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8}
      style={[s.number,{fontSize,lineHeight:fontSize*1.55,color:numberColor}]}>{offer.price.toLocaleString()}</Text>
  </View>;
});
const s=StyleSheet.create({
  price:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4,flexShrink:1},
  number:{color:'#4A281E',fontWeight:'800',fontVariant:['tabular-nums'],flexShrink:1},
  owned:{color:'#4A281E',fontWeight:'700',textAlign:'center'},
  badge:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,paddingHorizontal:8,paddingVertical:3,
    borderRadius:30,backgroundColor:'#C65336'},
  plus:{color:'#FFFFFF',fontWeight:'800'},
});
