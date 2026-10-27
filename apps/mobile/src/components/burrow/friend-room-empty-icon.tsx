import Svg,{Circle,Path,Rect} from 'react-native-svg';

/** Local vector, available immediately; no network or platform emoji glyph. */
export function FriendRoomEmptyIcon(){
  return <Svg accessible={false} width={88} height={88} viewBox="0 0 100 100">
    <Circle cx={50} cy={53} r={45} fill="#F8E8D1"/>
    <Path d="M50 17V6M31 22L24 13M69 22L76 13" stroke="#E99B3D" strokeWidth={6} strokeLinecap="round"/>
    <Path d="M31 66V49Q31 35 50 35Q69 35 69 49V66Z" fill="#875339"/>
    <Rect x={30} y={61} width={40} height={20} rx={6} fill="#79472F"/>
    <Path d="M31 76V86M69 76V86" stroke="#75442E" strokeWidth={6} strokeLinecap="round"/>
    <Path d="M29 75V61Q29 54 34 55Q39 55 39 62V69M71 75V61Q71 54 66 55Q61 55 61 62V69" fill="#875339" stroke="#F8E8D1" strokeWidth={2}/>
  </Svg>;
}
