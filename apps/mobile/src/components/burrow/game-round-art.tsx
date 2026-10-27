import Svg,{G,Path,Rect,Ellipse,Circle} from 'react-native-svg';
/** Small vector illustrations keep the same warm card language as the supplied layouts. */
export function GameRoundArt({kind='guess',size=160}:{kind?:'guess'|'waiting'|'results';size?:number}){
  return <Svg width={size} height={size*.75} viewBox="0 0 240 180" accessible={false}>
    <Ellipse cx="116" cy="155" rx="92" ry="18" fill="#FCEBDD"/>
    <G rotation={-12} origin="82,93"><Rect x="42" y="29" width="77" height="121" rx="10" fill="#F8EDDE"/>
      {kind==='guess'?<Path d="M67 65c0-22 32-24 32-4 0 12-15 12-15 25" fill="none" stroke="#542811" strokeWidth="8" strokeLinecap="round"/>:kind==='waiting'?<Path d="m64 80 14 13 26-38" fill="none" stroke="#BE522E" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>:<Path d="M82 91C48 68 57 42 74 48l8 7 8-7c24-9 33 24-8 43" fill="#C75C36"/>}
      {kind==='guess'&&<Circle cx="84" cy="98" r="4" fill="#542811"/>}
      <Path d="M58 117h40m-40 13h25" stroke="#E2D0B6" strokeWidth="5" strokeLinecap="round"/>
    </G>
    <G rotation={12} origin="148,112"><Rect x="108" y="55" width="76" height="117" rx="10" fill={kind==='guess'?'#EBAA85':'#F9E4C8'}/>
      {kind==='guess'?<><Path d="M132 90c0-19 28-21 28-3 0 10-13 10-13 22" fill="none" stroke="#C3653D" strokeWidth="7" strokeLinecap="round"/><Circle cx="147" cy="119" r="4" fill="#C3653D"/></>:kind==='waiting'?<><Circle cx="130" cy="108" r="4" fill="#F4A425"/><Circle cx="146" cy="108" r="4" fill="#F4A425"/><Circle cx="162" cy="108" r="4" fill="#F4A425"/></>:<Path d="M146 126c-34-23-25-49-8-43l8 7 8-7c24-9 33 24-8 43" fill="#F5B137"/>}
      {kind==='guess'&&<Path d="M124 140h39" stroke="#FFF3E1" strokeWidth="5" strokeLinecap="round"/>}
    </G>
    {kind==='guess'?<G><Ellipse cx="191" cy="30" rx="31" ry="23" fill="#FCEBDD"/><Circle cx="178" cy="30" r="3" fill="#C36940"/><Circle cx="191" cy="30" r="3" fill="#C36940"/><Circle cx="204" cy="30" r="3" fill="#C36940"/></G>:<Path d="m196 16 2-12m12 18 8-10" stroke="#FFEACB" strokeWidth="6" strokeLinecap="round"/>}
  </Svg>;
}
