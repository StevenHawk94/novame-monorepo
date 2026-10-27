// Real component JSX/styles/assets, rendered as a layout proof (not native QA).
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {load}=require('./lifecycle-test-utils.cjs');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function css(style){if(typeof style==='function')style=style({pressed:false});if(Array.isArray(style))style=Object.assign({},...style.flat(Infinity).filter(Boolean));
 const out={};for(const [k,v]of Object.entries(style??{})){
  if(k==='transform'){out.transform=v.map(t=>Object.entries(t).map(([a,b])=>`${a}(${b})`).join(' ')).join(' ');continue;}
  for(const key of k==='paddingHorizontal'?['paddingLeft','paddingRight']:k==='paddingVertical'?['paddingTop','paddingBottom']:[k])out[key]=v;}
 return Object.entries(out).map(([k,v])=>k.replace(/[A-Z]/g,s=>'-'+s.toLowerCase())+':'+(typeof v==='number'&&!['flex','flexGrow','flexShrink','zIndex','fontWeight','opacity'].includes(k)?v+'px':v)).join(';');}
function html(t){if(t==null||typeof t==='boolean')return'';if(Array.isArray(t))return t.map(html).join('');if(typeof t!=='object')return esc(t);const p=t.props;
 if(t.type==='Image')return`<img style="object-fit:${p.contentFit==='cover'?'cover':'contain'};object-position:top;${p.contentFit==='cover'?'width:100%;height:100%;':''}${css(p.style)}" src="file://${p.source}">`;
 if(t.type==='Svg')return`<svg width="${p.width}" height="${p.height}" viewBox="${p.viewBox}" style="flex-shrink:0;${css(p.style)}">${html(p.children)}</svg>`;
 if(t.type==='Path')return`<path fill="${p.fill}" d="${p.d}"></path>`;
 if(t.type==='Back')return'<div class="back">‹</div>';
 if(t.type==='ScrollView')return`<div class="view" style="overflow:auto;${css(p.style)}"><div class="view" style="${css(p.contentContainerStyle)}">${html(p.children)}</div></div>`;
 return`<div class="${t.type==='Text'?'text':'view'}" style="${css(p.style)}">${html(p.children)}</div>`;
}
async function main(){const dir=process.argv[2]??'/private/tmp/burrow-affection-limit-proof';fs.mkdirSync(dir,{recursive:true});
 for(const [width,height,top,bottom]of [[390,844,47,34],[320,568,20,0]])for(const hasPlus of [false,true]){
  const jsx=(type,props)=>({type,props});
  const {AffectionLimitScreen}=load('apps/mobile/src/components/burrow/affection-limit-screen.tsx',{
   react:{useRef:x=>({current:x})},'react/jsx-runtime':{jsx,jsxs:jsx},'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},
   'react-native':{Pressable:'Button',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:x=>x,absoluteFillObject:{position:'absolute',top:0,bottom:0,left:0,right:0}},useWindowDimensions:()=>({width,height})},
   '@/lib/retained-tab-navigation':{},'expo-router':{},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top,bottom})},
   '@/lib/burrow-art-assets':{BURROW_BACKGROUNDS:{affectionSend:path.resolve('apps/mobile/assets/burrow-webp/affection-send-bg.webp')}},
   '@/lib/burrow-ui-assets':{BURROW_DAILY_ENTRY_ART:{plus:path.resolve('apps/mobile/assets/burrow-webp/affection page icons/plus.webp')}},
   './burrow-image':{Image:'Image'},'./burrow-back-button':{BurrowBackButton:'Back'},
  });
  const fonts=[[400,'400Regular'],[800,'800ExtraBold']].map(([weight,name])=>`@font-face{font-family:Inter;src:url('file://${path.resolve('apps/mobile/node_modules/@expo-google-fonts/inter',name,'Inter_'+name+'.ttf')}');font-weight:${weight}}`).join('');
  const name=`${width}-${hasPlus?'plus':'free'}`;
  fs.writeFileSync(dir+'/'+name+'.html',`<!doctype html><meta charset="utf-8"><style>${fonts}*{box-sizing:border-box;border:0 solid transparent}html,body{margin:0;width:${width}px;height:${height}px}body>.view{height:100%}.view{display:flex;flex-direction:column;position:relative;flex-shrink:0;min-width:0;min-height:0}.text{white-space:pre-wrap;flex-shrink:0;font-family:Inter;font-weight:400}img{flex-shrink:0}.back{display:flex;width:44px;height:44px;border-radius:50%;align-items:center;justify-content:center;background:#fff6e8;color:#4c2b1e;font:48px Arial}</style>${html(AffectionLimitScreen({hasPlus}))}`);
  const started=Date.now(),output=dir+'/'+name+'.png';
  const shot=spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--hide-scrollbars','--no-sandbox','--user-data-dir='+dir+'/chrome','--screenshot='+output,'--window-size='+width+','+height,'--force-device-scale-factor=1','--run-all-compositor-stages-before-draw','--virtual-time-budget=1000','file://'+dir+'/'+name+'.html'],{encoding:'utf8',timeout:20000,killSignal:'SIGKILL'});
  if(shot.status!==0&&(!fs.existsSync(output)||fs.statSync(output).mtimeMs<started))throw Error(shot.stderr||String(shot.error));
 }
 const {sharp}=require('../apps/mobile/plugins/branding-assets.cjs');await sharp({create:{width:780,height:844,channels:3,background:'#fff'}}).composite(['free','plus'].map((tier,n)=>({input:dir+'/390-'+tier+'.png',left:n*390,top:0}))).png().toFile(dir+'/both.png');console.log(dir+'/both.png');
}main().catch(error=>{console.error(error);process.exitCode=1;});
