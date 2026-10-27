// Read-only live checks. No purchases, grants or personal photos.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const request=async(path,statusOnly=false)=>{
 const {stdout}=await run('curl',['--silent','--show-error','--retry','2','--connect-timeout','10','--max-time','30',
  ...(process.env.ALL_PROXY?.startsWith('socks5:')?['--proxy',process.env.ALL_PROXY.replace(/^socks5:/,'socks5h:')]:[]),
  ...(statusOnly?['--output','/dev/null','--write-out','%{http_code}']:['--fail']),origin+path],
  {encoding:statusOnly?'utf8':'buffer',maxBuffer:4*1024*1024});
 return stdout;
};
const origin='https://novame-monorepo-admin.vercel.app';
const manifest=JSON.parse(fs.readFileSync(new URL('../apps/admin/src/generated/shop-art.json',import.meta.url)));
const windows=manifest.categories.windows;assert.equal(windows.length,39);
const urls=[...new Set(windows.flatMap(row=>[row.url,row.landscapeUrl]))];assert.equal(urls.length,40);
let index=0;
await Promise.all(Array.from({length:4},async()=>{
 while(index<urls.length){const url=urls[index++];
  const bytes=await request(url);
  assert.equal(url,`/shop-art/${createHash('sha256').update(bytes).digest('hex').slice(0,24)}.webp`);
 }
}));
const login=Number(await request('/admin/login',true));assert.equal(login,200);
const privateRoute=Number(await request('/api/admin/shop-pricing',true));
assert.ok([401,403,307,308].includes(privateRoute),'Admin pricing must remain protected');
console.log(JSON.stringify({admin:origin,windowPreviews:39,landscapes:1,byteIdenticalLiveFiles:40,login,pricingProtected:privateRoute}));
