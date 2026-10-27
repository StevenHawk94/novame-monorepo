// Code-derived web layout proof of the actual JSX and styles; not native/device QA.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process');
const file=path.resolve('tools/test-burrow-game-room-local-content.cjs'),req=createRequire(file),mod={exports:{}};
vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports={screenHarness,content,progress};',{
 module:mod,exports:mod.exports,__dirname:path.dirname(file),require:name=>name==='node:test'?{test(){}}:req(name),console,setTimeout,clearTimeout,
});
const {screenHarness,content,progress}=mod.exports;
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const unitless=new Set(['flex','flexGrow','flexShrink','opacity','zIndex','fontWeight','elevation']);
function css(style){
 if(typeof style==='function')style=style({pressed:false});
 if(Array.isArray(style))style=Object.assign({},...style.flat(Infinity).filter(Boolean));
 const out={};for(const [key,value]of Object.entries(style??{})){
  if(value==null||key.startsWith('shadow')||['elevation','transform'].includes(key))continue;
  for(const k of key==='paddingHorizontal'?['paddingLeft','paddingRight']:key==='paddingVertical'?['paddingTop','paddingBottom']:key==='marginHorizontal'?['marginLeft','marginRight']:key==='marginVertical'?['marginTop','marginBottom']:[key])out[k]=value;
 }
 return Object.entries(out).map(([k,v])=>k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+(typeof v==='number'&&!unitless.has(k)?v+'px':v)).join(';');
}
const images={1:'rule-1.webp',2:'rule-2.webp',3:'rule-3.webp',4:'waiting-page.webp'};
function html(node){
 if(node==null||typeof node==='boolean')return '';
 if(Array.isArray(node))return node.map(html).join('');
 if(typeof node!=='object')return escape(node);
 const p=node.props??{};if(typeof node.type==='function')return html(node.type(p));
 const style=css(p.style);
 if(node.type==='Fragment')return html(p.children);
 if(node.type==='Image')return `<img src="file://${path.resolve('apps/mobile/assets/burrow-webp/game room',images[p.source]??'rule-1.webp')}" style="object-fit:contain;${style}"/>`;
 if(node.type==='UserAvatar')return `<div class="avatar" style="width:${p.size}px;height:${p.size}px;border-radius:50%;background:${p.userId==='a'?'#FFC547':'#80513C'}">${p.userId==='a'?'P':'A'}</div>`;
 if(node.type==='BackButton')return '<div class="back">‹</div>';
 if(node.type==='Icon')return `<span style="color:${p.color};font-size:${p.size}px">${p.name==='check'?'✓':p.name==='x'?'×':'♙'}</span>`;
 if(node.type==='Confetti')return '';
 if(node.type==='ScrollView')return `<div class="view" style="overflow:auto;${style}"><div class="view" style="${css(p.contentContainerStyle)}">${html(p.children)}</div></div>`;
 if(node.type==='Transition')return `<div class="view" style="flex:1;overflow:hidden">${html(p.children)}</div>`;
 return `<div class="${node.type==='Text'?'text':'view'}" style="${style}">${html(p.children)}</div>`;
}
async function main(){
 const dir=process.argv[2]??'/private/tmp/game-room-redesign-proof';fs.mkdirSync(dir,{recursive:true});
 const game=content.GAME_ROOM_GAMES[1],base={...content.localGameSession(progress),gameId:game.id},overview=content.localGameOverview({paired:true,availableIds:[game.id]});
 const modes=[['intro',null],['own',{...base,ownAnswers:[0]}],['transition',{...base,ownAnswers:Array(6).fill(0)}],['guess',{...base,ownAnswers:Array(6).fill(0),guesses:[0]}],
  ['waiting',{...base,ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0)}],['results',{...base,ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),partnerOwnCount:6,partnerGuessCount:6,partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(1),completedAt:'2026-10-21',result:{mine:6,partner:0,outcome:'win'}}]];
 for(const [name,session]of modes){
  const h=screenHarness(session?.id,{initialGameId:game.id,session,overview,width:390,height:844,insets:{top:47,bottom:34}});
  const output=path.join(dir,name+'.html');
  fs.writeFileSync(output,`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box;border:0 solid transparent}html,body{margin:0;width:390px;height:844px;background:#401608;font-family:Arial}body>.view{height:844px}.view{display:flex;flex-direction:column;position:relative;flex-shrink:0;min-width:0;min-height:0}.text{white-space:pre-wrap;flex-shrink:1}.avatar{display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:24px;font-weight:bold;color:white}.back{display:flex;width:44px;height:44px;border-radius:50%;background:#ffffff30;color:white;align-items:center;justify-content:center;font-size:42px}</style>${html(h.render())}`);
  h.unmount();const shot=spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--hide-scrollbars','--no-sandbox','--user-data-dir='+path.join(dir,'chrome-profile'),'--screenshot='+path.join(dir,name+'.png'),'--window-size=390,844','--force-device-scale-factor=1','file://'+output],{encoding:'utf8'});
  if(shot.status!==0)throw Error(shot.stderr);
 }
 const sharp=require(require.resolve('sharp',{paths:[path.dirname(require.resolve('next/package.json',{paths:[path.resolve('apps/admin')]}))]}));
 await sharp({create:{width:390*3,height:844*2,channels:4,background:'#401608'}}).composite(modes.map(([name],i)=>({input:path.join(dir,name+'.png'),left:i%3*390,top:Math.floor(i/3)*844}))).png().toFile(path.join(dir,'all.png'));
 console.log(path.join(dir,'all.png'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
