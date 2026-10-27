// Code-derived layout proof using real JSX, assets and fonts; not native device QA.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process');
const file=path.resolve('tools/test-onboarding-feature-layout.cjs'),req=createRequire(file),mod={exports:{}};
vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports={render,design};',{
 module:mod,exports:mod.exports,require:name=>name==='node:test'?{test(){}}:req(name),console,setTimeout,clearTimeout});
const {render,design}=mod.exports,escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const unitless=new Set(['flex','flexGrow','flexShrink','opacity','zIndex','fontWeight']);
function css(style){if(typeof style==='function')style=style({pressed:false});
 if(Array.isArray(style))style=Object.assign({},...style.flat(Infinity).filter(Boolean));
 const out={};for(const [key,value]of Object.entries(style??{})){if(value==null||key==='transform')continue;
 for(const k of key==='paddingHorizontal'?['paddingLeft','paddingRight']:key==='paddingVertical'?['paddingTop','paddingBottom']:[key])out[k]=value;}
 return Object.entries(out).map(([k,v])=>k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+(typeof v==='number'&&!unitless.has(k)?v+'px':v)).join(';');}
function html(node){if(node==null||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(html).join('');
 if(typeof node!=='object')return escape(node);const p=node.props??{};
 if(typeof node.type==='function')return node.type.name==='Curve'?'':html(node.type(p));
 if(node.type==='Art')return `<img style="object-fit:contain;${p.style?.right===0&&p.style?.bottom===0?'width:100%;height:100%;':''}${css(p.style)}" src="file://${path.resolve('apps/mobile/src/lib',p.source)}"/>`;
 if(node.type==='ScrollView')return `<div class="view" style="overflow:auto;${css(p.style)}"><div class="view" style="${css(p.contentContainerStyle)}">${html(p.children)}</div></div>`;
 if(node.type==='Text')return `<div class="text" style="${css(p.style)}">${html(p.children)}</div>`;
 return `<div class="view" style="${node.type==='Gradient'?'background:linear-gradient(135deg,#64351E,#4B2717,#63331C);':''}${css(p.style)}">${html(p.children)}</div>`;
}
(async()=>{
 const dir=process.argv[2]??'/private/tmp/burrow-onboarding-intro-proof';fs.mkdirSync(dir,{recursive:true});
 const fonts=['400Regular','500Medium','700Bold','800ExtraBold'].map(n=>`@font-face{font-family:Inter_${n};src:url('file://${path.resolve('apps/mobile/node_modules/@expo-google-fonts/inter',n,'Inter_'+n+'.ttf')}')}`).join('');
 const ids=['start',...design.ONBOARDING_FEATURES.map(f=>f.id)],shots=[];
 for(const [width,height,top,bottom]of [[390,844,47,34],[320,568,20,0]])for(const id of ids){
  const page=render(width,height,top,bottom,id).page(id),name=width+'-'+id,output=dir+'/'+name+'.html';
  fs.writeFileSync(output,`<!doctype html><meta charset="utf-8"><style>${fonts}*{box-sizing:border-box;border:0 solid transparent}html,body{margin:0;width:${width}px;height:${height}px;background:${design.ONBOARDING_CREAM}}body>.view{height:${height}px}.view{display:flex;flex-direction:column;position:relative;flex-shrink:0;min-width:0;min-height:0}.text{white-space:pre-wrap;flex-shrink:0;font-family:Inter_400Regular}img{flex-shrink:0}</style>${html(page)}`);
  const shot=spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--hide-scrollbars','--no-sandbox','--user-data-dir='+dir+'/chrome-profile','--screenshot='+dir+'/'+name+'.png','--window-size='+width+','+height,'--force-device-scale-factor=1','--run-all-compositor-stages-before-draw','--virtual-time-budget=1000','file://'+output],{encoding:'utf8'});
  if(shot.status!==0)throw Error(shot.stderr);if(width===390)shots.push(name);
 }
 const {sharp}=require('../apps/mobile/plugins/branding-assets.cjs');
 await sharp({create:{width:390*4,height:844*2,channels:3,background:design.ONBOARDING_CREAM}})
  .composite(shots.map((n,i)=>({input:dir+'/'+n+'.png',left:i%4*390,top:Math.floor(i/4)*844}))).png().toFile(dir+'/all.png');
 console.log(dir+'/all.png');
})().catch(error=>{console.error(error);process.exitCode=1;});
