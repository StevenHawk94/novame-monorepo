/** Deterministic, original placeholder tones. No external media/licensed samples.
 * Replace these bundle files later while preserving the catalog bundle keys. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const output = resolve('apps/mobile/assets/burrow');
mkdirSync(output, { recursive: true });
for (const [name, notes] of Object.entries({ calm: [261.63,329.63,392,329.63], dream: [293.66,369.99,440,369.99] })) {
  const rate = 22050, seconds = 8, samples = rate * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
  wav.write('data',36); wav.writeUInt32LE(samples*2,40);
  for (let i=0; i<samples; i++) {
    const t=i/rate, beat=t%2, hz=notes[Math.floor(t/2)];
    const envelope=Math.min(1,beat/.04)*Math.exp(-beat*2.8)*Math.min(1,(2-beat)/.1);
    const value=(Math.sin(t*hz*2*Math.PI)+.2*Math.sin(t*hz*4*Math.PI))*envelope*.22;
    wav.writeInt16LE(Math.round(value*32767),44+i*2);
  }
  writeFileSync(resolve(output,`${name}.wav`),wav);
  console.log(`${name}.wav: ${wav.length} bytes, ${seconds}s mono placeholder`);
}
