import { expect, test, type Page } from '@playwright/test';

async function openFlow(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('label[for="src-sim"]').first().click();
  await expect(page.locator('#src-sim')).toBeChecked();
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#mode-flow').click();
  await expect(page.locator('.flow-panel')).toBeVisible();
}

/** Links that are drawn: a path, a width and not hidden. */
function drawnLinks(page: Page, selector = '.flow-link') {
  return page.locator(selector).evaluateAll((paths) =>
    paths
      .filter((p) => (p as SVGPathElement).style.display !== 'none' && p.getAttribute('d'))
      .map((p) => ({
        from: (p as SVGPathElement).dataset.from as string,
        to: (p as SVGPathElement).dataset.to as string,
        width: parseFloat((p as SVGPathElement).style.strokeWidth),
        opacity: parseFloat((p as SVGPathElement).style.opacity),
      })),
  );
}

test('the Flow page links every sensor through the tracks to the mix', async ({ page }) => {
  await openFlow(page);
  const sensors = page.locator('.flow-sensor');
  await expect(sensors.first()).toBeVisible({ timeout: 8000 });
  // Ten simulated channels, each with its raw and processed trace.
  await expect.poll(() => sensors.count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('#flow-pick option')).toHaveCount(await sensors.count());
  await expect(sensors.first().locator('canvas')).toHaveCount(2);
  await expect(page.locator('.flow-track').first()).toBeVisible({ timeout: 8000 });
  expect(await page.locator('.flow-track').count()).toBeGreaterThanOrEqual(3);
  for (const bus of ['reverb', 'delay', 'fx', 'master']) {
    await expect(page.locator(`[data-node="bus:${bus}"]`)).toBeVisible();
  }

  await expect
    .poll(async () => {
      const links = await drawnLinks(page);
      const toTracks = links.filter((l) => l.from.startsWith('ch:') && l.to.startsWith('trk:'));
      const audio = links.filter((l) => l.from.startsWith('trk:') && l.to.startsWith('bus:'));
      return toTracks.length > 0 && audio.length > 0 && links.every((l) => l.width > 0);
    })
    .toBe(true);

  // Every sensor routes somewhere.
  const links = await drawnLinks(page);
  const ids = await sensors.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.node));
  for (const id of ids)
    expect(links.some((l) => l.from === id && l.to !== 'mod:genome')).toBe(true);

  // Showing every route adds links.
  await page.locator('#flow-strong').uncheck();
  await expect
    .poll(async () => (await drawnLinks(page)).length)
    .toBeGreaterThanOrEqual(links.length);
});

test('clicking a sensor lights its path and dims the rest', async ({ page }) => {
  await openFlow(page);
  const card = page.locator('.flow-sensor').first();
  await expect(card).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.flow-track').first()).toBeVisible({ timeout: 8000 });
  const id = (await card.getAttribute('data-node')) as string;
  await card.click();
  await page.mouse.move(2, 2);
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#flow')).toHaveClass(/is-focused/);
  await expect(page.locator('.flow-node.is-lit').first()).toBeVisible();
  await expect
    .poll(async () => {
      const links = await drawnLinks(page);
      const mine = links.filter((l) => l.from === id);
      const others = links.filter((l) => l.from.startsWith('ch:') && l.from !== id);
      return (
        mine.length > 0 &&
        mine.every((l) => l.opacity >= 0.85) &&
        others.every((l) => l.opacity <= 0.05)
      );
    })
    .toBe(true);
  await card.click();
  await page.mouse.move(2, 2);
  await expect(page.locator('#flow')).not.toHaveClass(/is-focused/);

  // Hovering a link explains it.
  const hit = page.locator('.flow-hit').first();
  const box = await hit.evaluate((p) => {
    const path = p as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM() as DOMMatrix;
    return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
  });
  await hit.dispatchEvent('pointermove', { clientX: box.x, clientY: box.y, bubbles: true });
  await expect(page.locator('#flow-tip')).toBeVisible();
  await expect(page.locator('#flow-tip')).toContainText('→');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 } });

  test('only the picked sensor is linked, down the side', async ({ page }) => {
    await openFlow(page);
    await expect(page.locator('.flow-sensor').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#flow-pick')).toBeVisible();
    const pick = page.locator('#flow-pick');
    const options = await pick
      .locator('option')
      .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    const next = options.find((v) => v !== '') as string;
    await pick.selectOption(next);
    await expect
      .poll(async () => {
        const links = await drawnLinks(page);
        return links.length > 0 && links.every((l) => l.from === `ch:${next}`);
      })
      .toBe(true);
  });
});
