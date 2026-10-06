import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

/** Warm illustrated icons, drawn locally rather than substituting font glyphs. */
export function PlusBenefitIcon({ kind, size }: { kind: number; size: number }) {
  const cream = '#FFF2DB', gold = '#FFC261', rust = '#D77752', brown = '#59311D';
  return <Svg width={size} height={size} viewBox="0 0 100 100">
    {kind === 0 && <>
      {[{ x: 3, fill: cream }, { x: 50, fill: '#D9A97B' }].map(({ x, fill }) => <G key={x} transform={`translate(${x},16)`}>
        <Ellipse cx="17" cy="28" rx="6" ry="18" fill={fill} transform="rotate(-15 17 28)"/>
        <Ellipse cx="33" cy="26" rx="6" ry="19" fill={fill} transform="rotate(14 33 26)"/>
        <Ellipse cx="25" cy="57" rx="23" ry="21" fill={fill}/>
        <Circle cx="17" cy="55" r="3" fill={brown}/><Circle cx="32" cy="55" r="3" fill={brown}/>
        <Path d="M22 63 Q25 67 28 63" stroke={brown} strokeWidth="3" fill="none" strokeLinecap="round"/>
      </G>)}
      <Path d="M50 29 C24 12 36 0 50 11 C65 -1 76 13 50 29" fill={rust}/>
    </>}
    {kind === 1 && <>
      {[{ x: 12, y: 25 }, { x: 12, y: 37 }, { x: 12, y: 49 }, { x: 48, y: 54 }, { x: 48, y: 66 }].map(({ x, y }, i) => <G key={i}>
        <Path d={`M${x} ${y} v12 c0 16 43 16 43 0 v-12Z`} fill="#E7A443" stroke="#B46D31" strokeWidth="2"/>
        <Ellipse cx={x + 21.5} cy={y} rx="21.5" ry="10" fill={gold} stroke="#B46D31" strokeWidth="2"/>
      </G>)}
    </>}
    {kind === 2 && <>
      <Rect x="23" y="20" width="55" height="47" rx="18" fill={rust}/>
      <Rect x="13" y="47" width="18" height="38" rx="9" fill={rust}/><Rect x="70" y="47" width="18" height="38" rx="9" fill={rust}/>
      <Rect x="24" y="61" width="52" height="22" rx="9" fill="#E6926F" stroke={brown} strokeWidth="2"/>
      <Path d="M22 82 v10 M78 82 v10" stroke={rust} strokeWidth="7" strokeLinecap="round"/>
    </>}
    {kind === 3 && <G transform="rotate(-10 50 50)">
      <Rect x="8" y="25" width="84" height="58" rx="6" fill={cream}/>
      <Path d="M9 27 L50 56 L91 27 M11 80 L36 56 M89 80 L66 56" fill="none" stroke="#DABEA0" strokeWidth="3"/>
      <Path d="M50 69 C20 50 32 34 50 46 C68 34 80 50 50 69" fill={rust}/>
    </G>}
    {kind === 4 && <>
      <Path d="M16 34 Q12 26 22 21 L44 10 Q50 7 57 11 L80 22 Q88 27 86 35 L83 73 Q81 81 73 84 L54 94 Q49 96 43 93 L20 81 Q15 78 15 70Z" fill={cream}/>
      <Path d="M17 28 L50 44 L85 28 M50 44 v49" fill="none" stroke="#E4D0B6" strokeWidth="2"/>
      <Ellipse cx="49" cy="24" rx="6" ry="4" fill={brown}/>
      <Ellipse cx="29" cy="43" rx="4" ry="6" fill={brown} transform="rotate(-15 29 43)"/>
      <Ellipse cx="37" cy="73" rx="4" ry="6" fill={brown} transform="rotate(-15 37 73)"/>
      {[{ x: 61, y: 48 }, { x: 76, y: 42 }, { x: 61, y: 80 }, { x: 76, y: 72 }].map(({ x, y }) => <Ellipse key={`${x}${y}`} cx={x} cy={y} rx="4" ry="5" fill={brown}/>)}
    </>}
    {kind === 5 && <>
      <Circle cx="50" cy="12" r="8" fill="none" stroke={gold} strokeWidth="5"/>
      <Circle cx="50" cy="58" r="36" fill={cream} stroke={gold} strokeWidth="10"/>
      <Path d="M68 37 L58 65 L33 80 L43 51Z" fill="#E7C69E"/>
      <Path d="M68 37 L58 65 L43 51Z" fill={rust}/>
      <Circle cx="50" cy="58" r="3" fill={brown}/>
    </>}
    {kind === 6 && <>
      <Path d="M42 40 L47 17 Q54 -1 69 11 Q87 23 71 43 L66 51" fill="none" stroke={brown} strokeWidth="16" strokeLinecap="round"/>
      <Path d="M42 40 L47 17 Q54 -1 69 11 Q87 23 71 43 L66 51" fill="none" stroke="#EB984C" strokeWidth="10" strokeLinecap="round"/>
      <Path d="M53 95 C-5 57 28 31 53 48 C82 25 108 58 53 95Z" fill={gold} stroke={brown} strokeWidth="3"/>
      <Path d="M52 63 v12" stroke={brown} strokeWidth="5" strokeLinecap="round"/><Circle cx="52" cy="62" r="6" fill={brown}/>
    </>}
  </Svg>;
}
