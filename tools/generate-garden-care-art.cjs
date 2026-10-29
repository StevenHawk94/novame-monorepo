// Mechanical conversion of the user-approved, self-contained SVG reference.
// Run with an explicit HTML input; never execute its script or fetch resources.
const fs=require('node:fs'),crypto=require('node:crypto');
const input=process.argv[2];if(!input)throw Error('Supply garden-interactions.html');
const html=fs.readFileSync(input,'utf8');
const allowed=new Set(['svg','defs','mask','rect','g','path','circle','ellipse','linearGradient','radialGradient','stop']);
function parse(xml){
 const stack=[],roots=[];
 for(const token of xml.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<([^>]+)>/g)){
  const raw=token[1];if(raw.startsWith('/')){stack.pop();continue;}
  const tag=raw.match(/^([\w]+)/)?.[1];if(!allowed.has(tag))throw Error('Unsupported SVG '+tag);
  const props={};for(const a of raw.matchAll(/([\w-]+)="([^"]*)"/g)){
   if(['aria-hidden','class'].includes(a[1]))continue;
   const key=a[1].replace(/-([a-z])/g,(_,s)=>s.toUpperCase());
   props[key]=a[2];
  }
  const node={tag,props,children:[]};(stack.length?stack.at(-1).children:roots).push(node);
  if(!raw.endsWith('/'))stack.push(node);
 }
 if(stack.length||roots.length!==1)throw Error('Invalid SVG nesting');return roots[0];
}
const art={};for(const [kind,id]of Object.entries({leaf:'leafButton',fertilizer:'fertButton',carrot:'carrotButton',water:'waterButton'})){
 const button=html.match(new RegExp('<button[^>]*id="'+id+'"[\\s\\S]*?</button>'))?.[0];
 if(!button)throw Error('Missing '+id);art[kind]=parse(button.slice(button.indexOf('<svg'),button.lastIndexOf('</svg>')+6));
}
fs.writeFileSync('apps/mobile/src/lib/garden-care-art.json',JSON.stringify({sourceSha256:crypto.createHash('sha256').update(html).digest('hex'),art},null,2)+'\n');
console.log('Generated four original SVG trees; no scripts, external images or fonts.');
