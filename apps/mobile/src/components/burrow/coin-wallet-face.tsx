import {Pressable,StyleSheet,View,type StyleProp,type ViewStyle} from 'react-native';
import type {SharedValue} from 'react-native-reanimated';
import {CoinIcon,CoinAddIcon} from './coin-ui';
import {AnimatedCoinBalance} from './animated-coin-balance';
import {coinWalletMetrics} from '@/lib/coin-wallet-layout';
import {formatAnimatedCoins} from '@/lib/burrow-motion';
/** The sole wallet appearance, in-place, promoted, or temporary fallback. */
export function CoinWalletFace({count,balance,fontSize=18,onPress,disabled,style,showAdd=true}: {
 count:SharedValue<number>;balance:number;fontSize?:number;onPress:()=>void;disabled?:boolean;style?:StyleProp<ViewStyle>;showAdd?:boolean;
}){
 const m=coinWalletMetrics(fontSize);
 return <Pressable accessibilityRole="button" accessibilityLabel={`Coin Shop. Balance ${formatAnimatedCoins(balance)}`}
  hitSlop={{left:6,right:6}}
  disabled={disabled} onPress={onPress} testID="coin-wallet-face"
  style={({pressed})=>[{height:m.touchHeight,justifyContent:'center',alignSelf:'flex-start'},style,pressed&&!disabled&&{opacity:.8}]}>
  <View pointerEvents="none" style={[s.wallet,{height:m.height,paddingHorizontal:m.padding,gap:m.gap,borderRadius:m.height/2}]}>
  <CoinIcon size={m.iconSize}/><AnimatedCoinBalance value={count} from={balance} target={balance} fontSize={fontSize}/>
  {showAdd&&<View pointerEvents="none" style={{width:m.iconSize,height:m.iconSize,alignItems:'center',justifyContent:'center'}}><CoinAddIcon size={m.addSize}/></View>}
  </View>
 </Pressable>;
}
const s=StyleSheet.create({wallet:{backgroundColor:'#FFF9ED',flexDirection:'row',alignItems:'center',alignSelf:'flex-start'}});
