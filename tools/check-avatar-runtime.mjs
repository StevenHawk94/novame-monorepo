// Run after Next build. A passing local codec test alone does not prove that
// Vercel's traced function contains libvips. No credentials or user bytes used.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {normalizeProfileAvatar} from '../apps/api/src/lib/profile-avatar-image.mjs';
const sharp=createRequire(new URL('../apps/api/package.json',import.meta.url))('sharp');
const root=path.resolve(import.meta.dirname,'..'),file=root+'/apps/api/.next/server/app/api/upload-avatar/route.js.nft.json';
const files=JSON.parse(fs.readFileSync(file)).files;
const native=files.filter(f=>f.includes('@img+sharp-')&&f.endsWith('.node'));
const vips=files.filter(f=>f.includes('@img+sharp-libvips-')&&/\.(so|dylib|dll)(\.\d+)*$/.test(f));
assert.ok(native.length,'Avatar trace is missing Sharp native binary');
assert.ok(vips.length,'Avatar trace is missing libvips shared library');
for(const f of [...native,...vips])assert.ok(fs.existsSync(path.resolve(path.dirname(file),f)),'Missing traced native file');
const png=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer();
const output=await normalizeProfileAvatar(png);
assert.equal((await sharp(output).metadata()).format,'jpeg');
console.log(JSON.stringify({avatarRuntime:{nativeFiles:native.length,sharedLibraries:vips.length,codec:true}}));
