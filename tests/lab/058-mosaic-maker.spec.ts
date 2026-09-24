import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/058-mosaic-maker.html?seed=3';
const stats = (page: Page) => page.evaluate(() => (window as any).__mosaic.stats);
/** Wait until the debounced render has finished and reflects `pred`. */
async function settled(page: Page, pred: (s: any) => boolean) {
  await expect.poll(async () => { const s = await stats(page); return !!s && pred(s); }, { timeout: 15_000 }).toBe(true);
  await expect(page.locator('#busy')).toBeHidden();
  return stats(page);
}

test.describe('058 Mosaic Maker', () => {
  test('the tile slider sets roughly that many tesserae', async ({ page }) => {
    await page.goto(URL);
    const first = await settled(page, (s) => s.tiles > 0);
    expect(first.tiles).toBeGreaterThan(1400 * 0.85);
    expect(first.tiles).toBeLessThan(1400 * 1.15);
    await expect(page.getByTestId('status')).toContainText(first.tiles.toLocaleString('en-US') + ' tesserae');

    await page.getByTestId('tiles').fill('3000');
    await expect(page.getByTestId('tiles-out')).toHaveText('3,000');
    const many = await settled(page, (s) => s.tiles > 2000);
    expect(many.tiles).toBeGreaterThan(3000 * 0.85);
    expect(many.tiles).toBeLessThan(3000 * 1.15);

    await page.getByTestId('tiles').fill('400');
    const few = await settled(page, (s) => s.tiles < 1000);
    expect(few.tiles).toBeGreaterThan(400 * 0.8);
    expect(few.tiles).toBeLessThan(400 * 1.2);
    await expect(page.getByTestId('art')).toHaveAttribute('aria-label', new RegExp(`in ${few.tiles} tesserae`));
  });

  test('edge-following tiles fit the picture far better than a plain grid of the same count', async ({ page }) => {
    await page.goto(URL);
    const verm = await settled(page, (s) => s.style === 'vermiculatum');
    await page.getByTestId('style').selectOption('tessellatum');
    const grid = await settled(page, (s) => s.style === 'tessellatum');
    await page.getByTestId('style').selectOption('voronoi');
    const vor = await settled(page, (s) => s.style === 'voronoi');
    // same budget of tiles...
    for (const s of [grid, vor]) expect(Math.abs(s.tiles - verm.tiles) / verm.tiles).toBeLessThan(0.15);
    // ...but the tiles that follow edges straddle far fewer colour boundaries
    expect(verm.meanError).toBeLessThan(grid.meanError * 0.5);
    expect(verm.meanError).toBeLessThan(vor.meanError * 0.5);
    // a different cartoon and the same comparison holds
    await page.getByTestId('src-peacock').click();
    await expect(page.getByTestId('src-peacock')).toHaveAttribute('aria-pressed', 'true');
    const pGrid = await settled(page, (s) => s.source === 'peacock');
    const pVerm = await page.evaluate(() => (window as any).__mosaic.set({ style: 'vermiculatum' }));
    expect(pVerm.meanError).toBeLessThan(pGrid.meanError * 0.7);
  });

  test('grout width and colour: none, thin, thick, and the chosen colour between tiles', async ({ page }) => {
    await page.goto(URL);
    const base = await settled(page, (s) => s.tiles > 0);
    await page.getByTestId('grout').fill('0');
    await expect(page.getByTestId('grout-out')).toHaveText('0 px');
    const none = await settled(page, (s) => s.groutFrac === 0);
    expect(none.tiles).toBe(base.tiles);
    await page.getByTestId('grout').fill('5');
    const thick = await settled(page, (s) => s.groutFrac > base.groutFrac);
    expect(thick.groutFrac).toBeGreaterThan(base.groutFrac * 1.5);

    await page.getByTestId('grout-charcoal').click();
    await expect(page.getByTestId('grout-charcoal')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('grout-color')).toHaveValue('#2a2420');
    await expect(page.locator('#busy')).toBeHidden();
    // every pixel on a tile boundary is grout, within the ±12% texture noise of #2a2420
    const px = await page.evaluate(() => {
      const m = (window as any).__mosaic, out: number[][] = [];
      for (let y = 40; y < 560 && out.length < 25; y += 23) for (let x = 20; x < 780; x++) {
        if (m.tileAt(x, y) !== m.tileAt(x + 1, y)) { out.push(m.pixel(x, y)); break; }
      }
      return out;
    });
    expect(px.length).toBeGreaterThan(15);
    for (const [r, g, b] of px) { expect(r).toBeLessThan(50); expect(g).toBeLessThan(45); expect(b).toBeLessThan(40); }
  });

  test('gold leaf gilds the bright tiles and can be switched off', async ({ page }) => {
    await page.goto(URL);
    const on = await settled(page, (s) => s.tiles > 0);
    expect(on.gold).toBeGreaterThan(50);
    await expect(page.getByTestId('status')).toContainText(`${on.gold} gilded`);
    // the pale fish body is gilded: its centre pixel is a warm gold (red > green > blue)
    const [r, g, b] = await page.evaluate(() => { const m = (window as any).__mosaic; m.set({ grout: 0 }); return m.pixel(330, 240); });
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b + 40);
    await page.getByTestId('gold').uncheck();
    const off = await settled(page, (s) => s.gold === 0);
    expect(off.tiles).toBe(on.tiles);
    await expect(page.getByTestId('status')).not.toContainText('gilded');
    const [r2, g2, b2] = await page.evaluate(() => (window as any).__mosaic.pixel(330, 240));
    expect(b2).toBeGreaterThan(150); // back to the cream of the cartoon
    expect(Math.abs(r2 - g2)).toBeLessThan(40);
  });

  test('a local upload is read in the browser and set in tiles', async ({ page }) => {
    await page.goto(URL);
    await settled(page, (s) => s.tiles > 0);
    // build a 200×100 PNG, left half red and right half blue, inside the page
    const b64 = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 100;
      const x = c.getContext('2d')!; x.fillStyle = '#d02020'; x.fillRect(0, 0, 100, 100); x.fillStyle = '#2040d0'; x.fillRect(100, 0, 100, 100);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.getByTestId('upload').setInputFiles({ name: 'halves.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
    const s = await settled(page, (q) => q.source === 'upload');
    expect(s.W).toBe(800);
    expect(s.H).toBe(400);
    await expect(page.getByTestId('status')).toContainText('halves.png');
    await page.getByTestId('grout').fill('0');
    await settled(page, (q) => q.groutFrac === 0);
    const [left, right] = await page.evaluate(() => { const m = (window as any).__mosaic; return [m.pixel(200, 200), m.pixel(600, 200)]; });
    expect(left[0]).toBeGreaterThan(150); expect(left[2]).toBeLessThan(80);
    expect(right[2]).toBeGreaterThan(150); expect(right[0]).toBeLessThan(80);
    // no tessera straddles the red/blue boundary
    const straddle = await page.evaluate(() => { const m = (window as any).__mosaic; let n = 0; for (let y = 0; y < 400; y += 4) { const t = m.tileAt(398, y); if (t === m.tileAt(402, y)) n++; } return n; });
    expect(straddle).toBe(0);
  });

  test('compare toggle and PNG export', async ({ page }) => {
    await page.goto(URL);
    const s = await settled(page, (q) => q.tiles > 0);
    await page.getByTestId('compare').click();
    await expect(page.getByTestId('compare')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('compare')).toHaveText('Show mosaic');
    const downloadP = page.waitForEvent('download');
    await page.getByTestId('export').click();
    const dl = await downloadP;
    expect(dl.suggestedFilename()).toBe(`mosaic-ichthys-${s.tiles}.png`);
    const bytes = readFileSync(await dl.path());
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // exporting always exports the mosaic, not the cartoon
    await expect(page.getByTestId('compare')).toHaveAttribute('aria-pressed', 'false');
  });
});
