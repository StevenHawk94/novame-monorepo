import { View } from 'react-native';
import { BURROW_SHOP_ICONS, BURROW_SHOP_ICON_BOUNDS, BURROW_SHOP_ICON_SOURCE_SIZE } from '@/lib/burrow-shop-icons';
import { Image } from './burrow-image';

// The kettle's former 38pt canvas contains ~31pt of visible artwork. Match
// that silhouette size, not the differently padded source-image canvases.
export const SHOP_CATEGORY_ICON_SIZE = 31;
export const SHOP_CATEGORY_ICON_COLORS = { selected: '#C9552C', idle: '#A57C65' } as const;

export function ShopCategoryIcon({ category, selected }: { category: string; selected: boolean }) {
  const size = SHOP_CATEGORY_ICON_SIZE;
  const color = SHOP_CATEGORY_ICON_COLORS[selected ? 'selected' : 'idle'];
  const key=category as keyof typeof BURROW_SHOP_ICONS;
  const source=BURROW_SHOP_ICONS[key],bounds=BURROW_SHOP_ICON_BOUNDS[key];
  if(!source||!bounds)return <View pointerEvents="none" style={{width:size,height:size}}/>;
  const [left,top,right,bottom]=bounds;
  const scale=size/Math.max(right-left,bottom-top);
  return <View pointerEvents="none" style={{width:size,height:size,overflow:'hidden'}}>
    <Image pointerEvents="none" source={source} contentFit="contain" tintColor={color}
      transition={0} cachePolicy="memory-disk"
      style={{position:'absolute',width:BURROW_SHOP_ICON_SOURCE_SIZE*scale,height:BURROW_SHOP_ICON_SOURCE_SIZE*scale,
        left:(size-(right-left)*scale)/2-left*scale,top:(size-(bottom-top)*scale)/2-top*scale}}/>
  </View>;
}
