import Svg, { Ellipse, G, Polygon } from 'react-native-svg';

/** Native vector layers adapted from the supplied gift-box.html. The prize is
 * always actual catalogue art, never the demo's illustrated lantern. */
export function AdventureGiftBox({ layer }: { layer: 'base' | 'lid' }) {
  return <Svg width="100%" height="100%" viewBox="24 32 156 156">
    {layer === 'base' ? <>
      <Polygon points="40,98 114,112 116,180 44,166" fill="#FDB843"/>
      <Polygon points="114,112 166,90 163,160 116,180" fill="#F39A45"/>
      <Polygon points="40,98 114,112 114,120 40,106" fill="#E8902C" opacity={.3}/>
      <Polygon points="67,103 81,105.5 82.5,175 70,172.5" fill="#E85454"/>
      <Polygon points="136,103 149,98 147,166 135,170.5" fill="#BC3A3E"/>
    </> : <>
      <Polygon points="32,80 114,94 114,113 34,98" fill="#FBCB6A"/>
      <Polygon points="114,94 172,74 170,91 114,113" fill="#F1B45C"/>
      <Polygon points="32,80 100,62 172,74 114,94" fill="#FBCB6A"/>
      <Polygon points="66,85.8 80,88.2 143,69.2 129,66.8" fill="#E26565"/>
      <Polygon points="59.4,73.3 72.6,68.7 149.6,81.7 136.4,86.3" fill="#E26565"/>
      <Polygon points="66,85.8 80,88.2 80,107 67,104.5" fill="#E26565"/>
      <Polygon points="136.4,86.3 149.6,81.7 149.5,98 136.2,103.5" fill="#E26565"/>
      <G transform="translate(104 74)">
        <Ellipse cx={-20} cy={-16} rx={22} ry={13} transform="rotate(-18 -20 -16)" fill="#E06A6A"/>
        <Ellipse cx={20} cy={-17} rx={22} ry={13} transform="rotate(18 20 -17)" fill="#E06A6A"/>
        <Ellipse cx={-16} cy={-12} rx={12} ry={6} transform="rotate(-18 -16 -12)" fill="#BC3A3E"/>
        <Ellipse cx={16} cy={-13} rx={12} ry={6} transform="rotate(18 16 -13)" fill="#BC3A3E"/>
        <Ellipse cx={0} cy={-8} rx={9} ry={8} fill="#E26565"/>
      </G>
    </>}
  </Svg>;
}
