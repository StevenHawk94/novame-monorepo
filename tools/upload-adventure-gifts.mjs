// Immutable R2 upload: never delete assets and never overwrite differing bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'apps/admin/package.json'));
const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(path.join(root, 'apps/admin'), false, { info: () => {}, error: console.error });
const allGifts = fs.readdirSync(path.join(root,'apps/api/src/data/adventure-friends')).flatMap(file =>
  JSON.parse(fs.readFileSync(path.join(root,'apps/api/src/data/adventure-friends',file))).gifts);
if (allGifts.length !== 483 || new Set(allGifts.map(g => g.id)).size !== 483) throw Error('Unexpected gift manifest');
const friend = process.argv.find(arg => arg.startsWith('--friend='))?.slice(9);
if (friend && !/^[A-Z]{2}$/.test(friend)) throw Error('Invalid friend code');
const gifts = friend ? allGifts.filter(g => g.friendId === `adventure_friend_${friend.toLowerCase()}`) : allGifts;
if (!gifts.length || (friend === 'HZ' && gifts.length !== 32)) throw Error('Unexpected selected gifts');
for (const g of gifts) {
  const bytes = fs.readFileSync(path.join(root,'apps/mobile/assets/burrow-webp/Gift Collection Webp',g.file));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== g.sha256) throw Error(`Changed asset: ${g.id}`);
}
if (!process.argv.includes('--upload')) {
  console.log(JSON.stringify({mode:'dry-run',gifts:gifts.length,bytes:gifts.reduce((n,g)=>n+g.bytes,0)}));
} else {
  for (const key of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME']) if (!process.env[key]) throw Error(`Missing ${key}`);
  const client = new S3Client({region:'auto',endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},forcePathStyle:true});
  let done=0,uploaded=0;
  const queue=[...gifts];
  await Promise.all([0,1].map(async()=>{
    while(queue.length) {
      const g=queue.shift(),params={Bucket:process.env.R2_BUCKET_NAME,Key:g.key};
      let existing;
      try { existing=await client.send(new HeadObjectCommand(params)); }
      catch(error) { if(error.$metadata?.httpStatusCode!==404) throw error; }
      if (existing && (existing.ContentLength!==g.bytes || existing.Metadata?.sha256!==g.sha256)) throw Error(`R2 collision: ${g.id}`);
      if (!existing) {
        await client.send(new PutObjectCommand({...params,Body:fs.readFileSync(path.join(root,'apps/mobile/assets/burrow-webp/Gift Collection Webp',g.file)),
          ContentType:'image/webp',CacheControl:'public, max-age=31536000, immutable',Metadata:{sha256:g.sha256},IfNoneMatch:'*'}));
        const verified=await client.send(new HeadObjectCommand(params));
        if(verified.ContentLength!==g.bytes||verified.Metadata?.sha256!==g.sha256) throw Error(`Upload verification failed: ${g.id}`);
        uploaded++;
      }
      done++;if(done%50===0)console.log(`Verified ${done}/${gifts.length}`);
    }
  }));
  console.log(JSON.stringify({verified:done,uploaded,bytes:gifts.reduce((n,g)=>n+g.bytes,0)}));
}
