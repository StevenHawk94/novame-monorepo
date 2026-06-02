#!/usr/bin/env node
/**
 * gen-manifest.mjs — 一次性生成 NovaMe R2 资产 manifest v2。
 *
 * 做什么：
 *   1. 拉线上旧 manifest（仍是扁平根目录版）拿权威清单 + 元数据，避免手抄出错。
 *   2. 按已核实的 dir 归属规则给每条加 `dir`（物理目录前缀，根目录为 ""）。
 *   3. 对每一条 HEAD 校验：
 *        - 非 200 → 标 ✖ 路径错（dir 归属或文件名不对），汇总报错，不静默产出。
 *        - 读 origin（cache-buster）的真实 content-length = 你重压缩后的真实字节。
 *        - 同时读 edge（不带 buster，= app 实际下到的字节），两者不等 → ⚠️ CDN 陈旧，需 purge。
 *        - HEAD 无 content-length 时回退 GET 实测字节数。
 *   4. 顺带读 cards-background.webp 的真实字节数（不入 manifest，仅打印备用）。
 *   5. 干净 manifest → stdout；所有诊断 → stderr。
 *
 * 跑法（在你的 Mac 上，仓库根目录；CI/sandbox 访问不到 media.novameapp.com）：
 *   node scripts/gen-manifest.mjs > video-manifest.json 2> gen-manifest.log
 *   # 然后看 gen-manifest.log（有没有 ✖ / ⚠️），把 video-manifest.json + log 贴回我核验。
 *
 * 需要 Node >= 18（global fetch）。你的环境是 Node 20，OK。
 */

const BASE = 'https://media.novameapp.com';
const OLD_MANIFEST_URL = `${BASE}/video-manifest.json`;

// ---- dir 归属规则（据 manifest + R2 截图核实；脚本会再 HEAD 二次校验）----
// 根目录 = P0（进 Home 前必须下完）。其余进各自 folder。
const ROOT_VIDEOS = new Set(['char1-outfit1-hungry.mp4']);
const ROOT_CARDS = new Set(['action-back.webp', 'action-initiative-front.webp']);
const ROOT_PRODUCTS = new Set(['book-cover.webp', 'cards-cover.webp']);

const DIR_VIDEO_FOLDER = 'chars-video';
const DIR_CARD_FOLDER = 'cards art';        // 带空格 → URL %20
const DIR_PRODUCT_FOLDER = 'product details'; // 带空格 → URL %20

const dirForVideo = (fn) => (ROOT_VIDEOS.has(fn) ? '' : DIR_VIDEO_FOLDER);
const dirForCard = (fn) => (ROOT_CARDS.has(fn) ? '' : DIR_CARD_FOLDER);
const dirForProduct = (fn) => (ROOT_PRODUCTS.has(fn) ? '' : DIR_PRODUCT_FOLDER);

/** 按 dir + 裸 filename 拼 URL，每段单独 encodeURIComponent（空格→%20）。 */
function buildUrl(dir, filename) {
  const rel = dir ? `${dir}/${filename}` : filename;
  return `${BASE}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * 探测单个资产：返回 { url, dir, filename, size?, edgeSize?, originStatus?, error?, stale? }。
 * size = origin 真实字节（cache-buster）；stale = edge≠origin（CDN 边缘陈旧）。
 */
async function probe(dir, filename) {
  const url = buildUrl(dir, filename);
  const bust = url + (url.includes('?') ? '&' : '?') + '__v=' + Date.now();
  const res = { url, dir, filename };

  let originResp;
  try {
    originResp = await fetch(bust, { method: 'HEAD', cache: 'no-store' });
  } catch (e) {
    res.error = `HEAD origin 请求失败: ${e.message}`;
    return res;
  }
  res.originStatus = originResp.status;
  if (originResp.status !== 200) {
    res.error = `origin HTTP ${originResp.status} — 路径可能错: ${url}`;
    return res;
  }

  let originLen = Number(originResp.headers.get('content-length'));

  // edge（app 实际下到的，不带 buster）
  let edgeLen = NaN;
  try {
    const edgeResp = await fetch(url, { method: 'HEAD' });
    edgeLen = Number(edgeResp.headers.get('content-length'));
  } catch {
    /* edge 探测失败不致命 */
  }

  // HEAD 无 content-length → GET 实测字节数（busted）
  if (!Number.isFinite(originLen) || originLen <= 0) {
    try {
      const g = await fetch(bust, { cache: 'no-store' });
      originLen = (await g.arrayBuffer()).byteLength;
    } catch (e) {
      res.error = `GET 实测字节失败: ${e.message}`;
      return res;
    }
  }

  res.size = originLen;
  res.edgeSize = edgeLen;
  if (Number.isFinite(edgeLen) && edgeLen > 0 && edgeLen !== originLen) {
    res.stale = true;
  }
  return res;
}

async function main() {
  const errors = [];
  const stale = [];

  // 1. 拉旧 manifest（仍是线上扁平版）
  process.stderr.write(`拉取旧 manifest: ${OLD_MANIFEST_URL}\n`);
  const oldResp = await fetch(OLD_MANIFEST_URL + '?__v=' + Date.now(), { cache: 'no-store' });
  if (!oldResp.ok) throw new Error(`无法拉取旧 manifest: HTTP ${oldResp.status}`);
  const old = await oldResp.json();
  if ((old.videos?.[0] || {}).dir !== undefined) {
    process.stderr.write('⚠️ 线上 manifest 似乎已含 dir 字段（可能已迁移过），请确认是否在重复操作。\n');
  }

  async function processArray(arr, dirFn, label) {
    const out = [];
    for (const e of arr) {
      const dir = dirFn(e.filename);
      const p = await probe(dir, e.filename);
      if (p.error) errors.push(`[${label}] ${e.filename}: ${p.error}`);
      if (p.stale) stale.push(`[${label}] ${e.filename}: edge=${p.edgeSize} origin=${p.size}`);
      out.push({ ...e, dir, size: p.size ?? e.size });
      process.stderr.write(
        `  ${p.error ? '✖' : p.stale ? '⚠' : '✓'} ${dir || '(root)'}/${e.filename}  ${p.size ?? '?'}B\n`,
      );
    }
    return out;
  }

  process.stderr.write('\n探测 videos…\n');
  const videos = await processArray(old.videos || [], dirForVideo, 'video');
  process.stderr.write('探测 cards…\n');
  const cards = await processArray(old.cards || [], dirForCard, 'card');
  process.stderr.write('探测 productAssets…\n');
  const productAssets = await processArray(old.productAssets || [], dirForProduct, 'product');

  // bonus: cards-background.webp 真实字节数（不入 manifest，仅备用）
  const cb = await probe('', 'cards-background.webp');
  process.stderr.write(`\ncards-background.webp(root): ${cb.error ?? cb.size + 'B'}\n`);

  const manifest = {
    version: old.version || 'v1', // 保持 v1：dir 为附加字段，不触发客户端 version 守卫
    baseUrl: old.baseUrl || BASE,
    videos,
    cards,
    productAssets,
  };

  // ---- 汇总诊断 ----
  if (errors.length) {
    process.stderr.write(`\n✖ ${errors.length} 条路径错误（dir 归属/文件名不对，必须修后重跑）:\n`);
    errors.forEach((s) => process.stderr.write('   ' + s + '\n'));
  }
  if (stale.length) {
    process.stderr.write(
      `\n⚠️ ${stale.length} 条 CDN 边缘陈旧（app 实下字节 ≠ 真实字节）。purge Cloudflare 缓存后重跑，否则会触发重下循环:\n`,
    );
    stale.forEach((s) => process.stderr.write('   ' + s + '\n'));
  }

  const rootEntries = [...videos, ...cards, ...productAssets].filter((e) => e.dir === '');
  const totalRoot = rootEntries.reduce((a, e) => a + (e.size || 0), 0);
  process.stderr.write(`\nP0(root) 共 ${rootEntries.length} 个，合计 ${(totalRoot / 1024).toFixed(1)} KB\n`);
  process.stderr.write(
    errors.length
      ? '\n结果含错误 ✖，未通过。修正 dir 归属或确认文件名后重跑。\n'
      : '\n✓ 全部 200。manifest 已输出到 stdout。\n',
  );

  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
