// Offline art/layout proof, using the shipped alpha geometry. Not device QA.
const fs = require('node:fs'), path = require('node:path');
const { load } = require('./lifecycle-test-utils.cjs');
const bounds = require('../apps/mobile/src/lib/adventure-friend-bounds.json');
const model = load('apps/mobile/src/lib/adventure-encounter-layout.ts');
const source = fs.readFileSync('apps/mobile/src/lib/burrow-ui-assets.ts', 'utf8');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function textLines(text, x, y, size, lineHeight, width, centered = false) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const word of words) {
    if ((line + ' ' + word).length * size * .52 > width && line) { lines.push(line); line = ''; }
    line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines.map((line, i) => `<text x="${x}" y="${y + i * lineHeight}" font-size="${size}" font-weight="700" text-anchor="${centered ? 'middle' : 'start'}">${escape(line)}</text>`).join('');
}
async function main() {
  const { default: sharp } = await import('../node_modules/.pnpm/sharp@0.35.0/node_modules/sharp/dist/index.mjs');
  const uri = async file => 'data:image/png;base64,' + (await sharp(file).png().toBuffer()).toString('base64');
  const tiles = [];
  const sizes = [[320,568,20,0], [390,844,47,34], [430,932,59,34]];
  for (const [w, h, topInset, bottomInset] of sizes) for (const [name, mode] of [['Arlo','invite'],['Mr Mole','dialogue'],['Dillon','choice']]) {
    const row = source.split('\n').find(line => line.startsWith(`  "${name}":`));
    const files = [...row.matchAll(/require\("([^\"]+)"\)/g)].map(m => m[1]);
    const answered = mode === 'dialogue', bodyTop = topInset + 42, height = h - bodyTop - bottomInset - 16;
    const l = model.adventureEncounterLayout(w, height, bounds[name], answered), panelTop = bodyTop + l.panelTop;
    const background = await uri('apps/mobile/assets/burrow-webp/adventure finish-bg.webp.webp');
    const character = await uri(path.resolve('apps/mobile/src/lib', files[answered ? 1 : 0]));
    let content = '';
    if (mode === 'invite') {
      content += textLines('Let’s be friend', w/2, panelTop+55, 29, 36, w-52, true);
      content += textLines(`You ran into ${name} down in the burrow.`, w/2, panelTop+105, 22, 31, w-52, true);
      content += `<rect x="${w*.14}" y="${panelTop+l.panelHeight-78}" width="${w*.72}" height="56" rx="28" fill="#C45637"/><text x="${w/2}" y="${panelTop+l.panelHeight-43}" font-size="20" font-weight="700" text-anchor="middle" fill="white">Talk to her</text>`;
    } else if (mode === 'dialogue') {
      content += textLines('I keep the little stories people almost forget. Every day has one worth saving.', 26, panelTop+48, 22, 31, w-52);
      content += `<text x="${w/2}" y="${panelTop+l.panelHeight-51}" font-size="38" text-anchor="middle" fill="#C45A37">⌄</text><text x="${w/2}" y="${panelTop+l.panelHeight-23}" font-size="16" text-anchor="middle" fill="#997A63">Tap to continue</text>`;
    } else {
      content += textLines('What kind of leap feels right today?', 26, panelTop+40, 22, 31, w-52);
      for (const [i, label] of ['Try something new','Reach out to someone','Take a needed rest'].entries()) {
        const y = panelTop+84+i*58;
        content += `<rect x="26" y="${y}" width="${w-52}" height="48" rx="17" fill="#F8E6D9" stroke="#C8663A" stroke-width="1.5"/><text x="${w/2}" y="${y+31}" font-size="19" font-weight="700" text-anchor="middle" fill="#1E1712">${label}</text>`;
      }
    }
    const heading = mode === 'invite' ? 'You met a new friend!' : `${name} is hanging around.`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Arial" fill="#4F2C19"><defs><clipPath id="body"><rect x="0" y="${bodyTop+l.headingBottom}" width="${w}" height="${height-l.headingBottom}"/></clipPath><clipPath id="panel"><rect x="6" y="${panelTop}" width="${w-12}" height="${l.panelHeight-5}" rx="26"/></clipPath></defs><image href="${background}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/><image clip-path="url(#body)" href="${character}" x="${l.image.left}" y="${bodyTop+l.image.top}" width="${l.image.width}" height="${l.image.height}"/><g fill="#FFF9EF">${textLines(heading,w/2,bodyTop+42,25,32,w-72,true)}</g><rect x="6" y="${panelTop+5}" width="${w-12}" height="${l.panelHeight-5}" rx="26" fill="#D99B66"/><rect x="6" y="${panelTop}" width="${w-12}" height="${l.panelHeight-5}" rx="26" fill="#FFF6E9"/><g clip-path="url(#panel)">${content}</g></svg>`;
    const tile = await sharp(Buffer.from(svg)).resize(320, 694, { fit: 'contain', background: '#28160f' }).png().toBuffer();
    tiles.push({ input: tile, left: (tiles.length % 3)*320, top: Math.floor(tiles.length / 3)*694 });
  }
  const output = process.argv[2] ?? '/private/tmp/adventure-encounter-layout-preview.png';
  await sharp({ create: { width: 960, height: 2082, channels: 4, background: '#28160f' } }).composite(tiles).png().toFile(output);
  console.log(output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
