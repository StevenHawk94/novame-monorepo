// Refresh bundled originals, face cutouts and the catalog in one deterministic pass.
// Never resizes/re-encodes supplied artwork or rewrites historical migrations.
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sharp=require(require.resolve('sharp',{paths:[path.dirname(require.resolve('next/package.json',{paths:[path.join(root,'apps/api')]}))]}));
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
function simplify(points,tolerance=.8){
 if(points.length<3)return points;
 const a=points[0],b=points.at(-1),dx=b[0]-a[0],dy=b[1]-a[1],norm=dx*dx+dy*dy;
 let far=0,index=0;
 for(let i=1;i<points.length-1;i++){
  const p=points[i],t=norm?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/norm)):0;
  const distance=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  if(distance>far){far=distance;index=i;}
 }
 return far>tolerance?[...simplify(points.slice(0,index+1),tolerance).slice(0,-1),...simplify(points.slice(index),tolerance)]:[a,b];
}
async function cutout(file){
 const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true}),w=info.width,h=info.height;
 if(w!==h)throw Error('Square frame required: '+file);
 const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let best=[];
 for(let i=0;i<seen.length;i++){
  if(seen[i]||data[i*4+3]>=128)continue;
  let count=1,head=0,border=false;queue[0]=i;seen[i]=1;
  while(head<count){const j=queue[head++],x=j%w,y=j/w|0;
   if(x===0||y===0||x===w-1||y===h-1)border=true;
   for(const k of [x>0?j-1:-1,x<w-1?j+1:-1,y>0?j-w:-1,y<h-1?j+w:-1])
    if(k>=0&&!seen[k]&&data[k*4+3]<128){seen[k]=1;queue[count++]=k;}
  }
  if(!border&&count>best.length)best=Array.from(queue.slice(0,count));
 }
 // These two wreaths have an intentionally open seam; a calibrated round mask
 // closes only that seam, without ever filling exterior transparent margins.
 const open={'21_Four_Leaf_Clover.webp':[377,395,133],'41_Olive_Branch.webp':[384,401,136]};
 if(best.length<10000){
  const circle=open[path.basename(file)];if(!circle)throw Error('No enclosed face opening: '+file);
  const [cx,cy,r]=circle,f=512/w,points=Array.from({length:96},(_,i)=>[f*(cx+r*Math.cos(i*Math.PI/48)),f*(cy+r*Math.sin(i*Math.PI/48))]);
  return {bounds:[(cx-r)*f,(cy-r)*f,2*r*f,2*r*f],path:points.map((p,i)=>(i?'L':'M')+p.map(x=>+x.toFixed(2)).join(',')).join('')+'Z'};
 }
 const mask=new Uint8Array(w*h);best.forEach(i=>mask[i]=1);
 const edges=new Map(),add=(x,y,a,b)=>edges.set(y*(w+1)+x,[a,b]);
 let minX=w,minY=h,maxX=0,maxY=0;
 for(const i of best){const x=i%w,y=i/w|0;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+1);maxY=Math.max(maxY,y+1);
  if(!mask[i-w])add(x,y,x+1,y);if(!mask[i+1])add(x+1,y,x+1,y+1);
  if(!mask[i+w])add(x+1,y+1,x,y+1);if(!mask[i-1])add(x,y+1,x,y);
 }
 let longest=[];
 while(edges.size){const start=edges.keys().next().value;let key=start,points=[];
  do{points.push([key%(w+1),key/(w+1)|0]);const next=edges.get(key);if(!next)break;edges.delete(key);key=next[1]*(w+1)+next[0];}while(key!==start);
  if(points.length>longest.length)longest=points;
 }
 const f=512/w,points=simplify([...longest,longest[0]].map(p=>p.map(x=>x*f)));
 return {bounds:[minX*f,minY*f,(maxX-minX)*f,(maxY-minY)*f],path:points.map((p,i)=>(i?'L':'M')+p.map(x=>+x.toFixed(2)).join(',')).join('')+'Z'};
}
// The runtime send list contains current frames only. Storage must still permit
// existing historical rows to be opened without altering or deleting their media.
function frameStorageConstraintSql(ids){
 return `do $frames$ declare previous text; begin
 select pg_get_expr(conbin,conrelid) into previous from pg_constraint
 where conrelid='public.burrow_surprises'::regclass and conname='burrow_surprises_frame_check';
 alter table public.burrow_surprises drop constraint if exists burrow_surprises_frame_check;
 execute format('alter table public.burrow_surprises add constraint burrow_surprises_frame_check check ((%s) or frame = any (%L::text[]))',coalesce(previous,'false'),array[${ids.map(q).join(',')}]::text[]);
end $frames$;`;
}
module.exports={frameStorageConstraintSql,cutout};
// Preserve the geometry algorithm, but never rediscover IDs or publish a second
// independent catalog from filenames. The manifest owns every binding now.
if(require.main===module)require('./sync-shop-catalog.cjs').sync({check:process.argv.includes('--check')});
