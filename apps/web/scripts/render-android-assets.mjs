// Renders the Android launcher icons and splash screens from the web icon.
// Run after `cap add android`: node scripts/render-android-assets.mjs
import { chromium } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const res = `${root}android/app/src/main/res`;
const BG = '#0e1317';
const svg = await readFile(`${root}public/favicon.svg`, 'utf8');
// The waveform alone, without the rounded background square.
const glyph = svg.replace(/<rect[^>]*\/>/, '');

function sizeOf(png) {
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(path, w, h, html, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<body style="margin:0;width:${w}px;height:${h}px;display:grid;place-items:center;background:${transparent ? 'transparent' : BG}">${html}</body>`,
  );
  await page.screenshot({ path, omitBackground: transparent });
}

const sized = (markup, px) => markup.replace('<svg ', `<svg width="${px}" height="${px}" `);

for (const dir of await readdir(res)) {
  for (const file of await readdir(`${res}/${dir}`).catch(() => [])) {
    if (!file.endsWith('.png')) continue;
    const path = `${res}/${dir}/${file}`;
    const { w, h } = sizeOf(await readFile(path));
    if (file === 'ic_launcher.png') {
      await render(path, w, h, sized(svg, w), true);
    } else if (file === 'ic_launcher_round.png') {
      await render(
        path,
        w,
        h,
        `<div style="width:${w}px;height:${h}px;border-radius:50%;background:${BG};display:grid;place-items:center">${sized(glyph, Math.round(w * 0.8))}</div>`,
        true,
      );
    } else if (file === 'ic_launcher_foreground.png') {
      // Adaptive icons: artwork inside the central 66 of 108 dp.
      await render(path, w, h, sized(glyph, Math.round(w * 0.62)), true);
    } else if (file === 'splash.png') {
      await render(path, w, h, sized(glyph, Math.round(Math.min(w, h) * 0.32)));
    }
  }
}
await browser.close();
