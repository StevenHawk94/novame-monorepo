#!/usr/bin/env node

/**
 * Losslessly remove optional colour/profile metadata from WebP containers.
 *
 * Some Android image decoders fail to render otherwise valid WebP assets that
 * contain embedded ICC/EXIF/XMP chunks. This script only rewrites the RIFF
 * container: VP8/VP8L/ALPH/ANIM/ANMF image bytes are kept byte-for-byte.
 */

const fs = require('node:fs');
const path = require('node:path');

const METADATA_CHUNKS = new Set(['ICCP', 'EXIF', 'XMP ']);
const METADATA_FLAGS = 0x20 | 0x08 | 0x04;

function collectWebpFiles(target, output) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      collectWebpFiles(path.join(target, entry), output);
    }
    return;
  }
  if (path.extname(target).toLowerCase() === '.webp') output.push(target);
}

function stripMetadata(filePath) {
  const input = fs.readFileSync(filePath);
  if (
    input.length < 12 ||
    input.toString('ascii', 0, 4) !== 'RIFF' ||
    input.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error(`Not a valid RIFF WebP file: ${filePath}`);
  }

  const chunks = [];
  let offset = 12;
  let changed = false;

  while (offset + 8 <= input.length) {
    const type = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const paddedSize = size + (size % 2);
    const chunkEnd = offset + 8 + paddedSize;
    if (chunkEnd > input.length) {
      throw new Error(`Malformed ${type} chunk in ${filePath}`);
    }

    if (METADATA_CHUNKS.has(type)) {
      changed = true;
    } else {
      const chunk = Buffer.from(input.subarray(offset, chunkEnd));
      if (type === 'VP8X' && size >= 1) {
        const originalFlags = chunk[8];
        chunk[8] &= ~METADATA_FLAGS;
        if (chunk[8] !== originalFlags) changed = true;
      }
      chunks.push(chunk);
    }
    offset = chunkEnd;
  }

  if (!changed) return false;

  const header = Buffer.from(input.subarray(0, 12));
  const output = Buffer.concat([header, ...chunks]);
  output.writeUInt32LE(output.length - 8, 4);

  const tempPath = `${filePath}.metadata-tmp`;
  const mode = fs.statSync(filePath).mode;
  fs.writeFileSync(tempPath, output, { mode });
  fs.renameSync(tempPath, filePath);
  return true;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node tools/strip-webp-metadata.cjs <file-or-directory> [...]');
  process.exit(1);
}

const files = [];
for (const target of targets) collectWebpFiles(path.resolve(target), files);

let changedCount = 0;
for (const file of files) {
  if (stripMetadata(file)) changedCount += 1;
}

console.log(`Checked ${files.length} WebP files; normalized ${changedCount}.`);
