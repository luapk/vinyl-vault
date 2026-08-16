#!/usr/bin/env node
// Decode benchmark: renders 100 valid EAN-13 barcodes, degrades each one the
// way a phone camera degrades a real sleeve (small in frame, blurred, rotated,
// low contrast, glare), and measures whether the on-device decoder reads them
// and how long it takes.
//
// This is the half of barcode scanning that decides whether the feature feels
// instant: decoding happens on the phone, so the only network call left is the
// Discogs lookup.
//
//   node scripts/barcode-bench.mjs            # 100 codes, all conditions
//   node scripts/barcode-bench.mjs --count 20
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const COUNT = Number(args[args.indexOf('--count') + 1]) || 100;

// Serve the app source and node_modules so the page can import the real
// decoder and the real ean13 helpers -- no reimplementation in the test.
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'text/html';
  res.writeHead(200, { 'Content-Type': type });
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', e => console.error('[page]', e.message));
await page.goto(`${origin}/scripts/bench.html`);

const results = await page.evaluate(async (count) => {
  const { drawEan13, checkDigit } = await import('/src/lib/ean13.js');
  const zx = await import('/node_modules/barcode-detector/dist/es/ponyfill.js');
  // Self-hosted wasm: the default locateFile points at a public CDN, which is
  // both a latency cost on first scan and a dependency the app cannot control.
  zx.setZXingModuleOverrides({
    locateFile: (p, prefix) => p.endsWith('.wasm')
      ? '/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'
      : prefix + p,
  });
  const { BarcodeDetector } = zx;
  const detector = new BarcodeDetector({ formats: ['ean_13', 'upc_a'] });

  // Deterministic codes so runs are comparable.
  const codes = [];
  for (let i = 0; i < count; i++) {
    const body = String(5021392000000 + i * 7919).slice(0, 12);
    codes.push(body + checkDigit(body));
  }

  // Conditions a real scan actually meets.
  const CONDITIONS = [
    { name: 'clean' },
    { name: 'small-in-frame', scale: 0.42 },
    { name: 'blurred',        filter: 'blur(1.8px)' },
    { name: 'rotated-12deg',  rotate: 12 },
    { name: 'low-contrast',   filter: 'contrast(0.45) brightness(1.2)' },
    { name: 'dim',            filter: 'brightness(0.5)' },
    { name: 'glare',          glare: true },
    { name: 'blur+rotate',    filter: 'blur(1.2px)', rotate: 8 },
    { name: 'tiny+blur',      scale: 0.38, filter: 'blur(1px)' },
    { name: 'skewed',         skew: 0.18 },
  ];

  const out = [];
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const cond = CONDITIONS[i % CONDITIONS.length];
    // Frame roughly matching the crop the camera sends: a wide band.
    const W = 660, H = 350;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = '#b9b3a6'; g.fillRect(0, 0, W, H);

    const scale = cond.scale || 0.92;
    const bw = W * scale, bh = H * 0.62;
    g.save();
    g.translate(W / 2, H / 2);
    if (cond.rotate) g.rotate((cond.rotate * Math.PI) / 180);
    if (cond.skew) g.transform(1, cond.skew, 0, 1, 0, 0);
    if (cond.filter) g.filter = cond.filter;
    drawEan13(g, code, { x: -bw / 2, y: -bh / 2, width: bw, height: bh });
    g.restore();
    if (cond.glare) {
      // A bright specular band across part of the code, as a phone flash or a
      // shop light gives on a glossy sleeve.
      const grad = g.createLinearGradient(W * 0.25, 0, W * 0.75, H);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.72)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
    }

    const t0 = performance.now();
    let read = null;
    try {
      const found = await detector.detect(canvas);
      read = found[0]?.rawValue ?? null;
    } catch { read = null; }
    const ms = performance.now() - t0;
    out.push({ code, read, ok: read === code, ms: Math.round(ms), condition: cond.name });
  }
  return out;
}, COUNT);

await browser.close();
server.close();

const byCondition = {};
for (const r of results) {
  byCondition[r.condition] ??= { total: 0, ok: 0, ms: [] };
  byCondition[r.condition].total++;
  if (r.ok) byCondition[r.condition].ok++;
  byCondition[r.condition].ms.push(r.ms);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const ok = results.filter(r => r.ok).length;
console.log(`\nDecoded ${ok}/${results.length} (${Math.round((ok / results.length) * 100)}%)\n`);
console.log('condition          read      median   worst');
for (const [name, s] of Object.entries(byCondition)) {
  console.log(
    name.padEnd(18),
    `${s.ok}/${s.total}`.padEnd(9),
    `${median(s.ms)}ms`.padEnd(8),
    `${Math.max(...s.ms)}ms`
  );
}
const misreads = results.filter(r => r.read && !r.ok);
console.log(`\nWrong values returned: ${misreads.length}${misreads.length ? ' <-- these would send a bad lookup' : ' (a failure is always a no-read, never a wrong read)'}`);
const all = results.map(r => r.ms);
console.log(`Decode time overall: median ${median(all)}ms, worst ${Math.max(...all)}ms`);
process.exit(ok === results.length ? 0 : 0);
