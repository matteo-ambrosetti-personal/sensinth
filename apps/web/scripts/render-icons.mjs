// Renders the PWA PNG icons from public/favicon.svg. Run: pnpm --filter @sensinth/web icons
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = await readFile(`${root}public/favicon.svg`, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, out, padding = 0) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - padding * 2;
  await page.setContent(
    `<body style="margin:0;background:#0e1317;display:grid;place-items:center;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`,
  );
  await page.screenshot({ path: `${root}public/icons/${out}`, omitBackground: padding === 0 });
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
// Maskable icons need the artwork inside the central safe zone.
await render(512, 'icon-maskable-512.png', 56);
await browser.close();
