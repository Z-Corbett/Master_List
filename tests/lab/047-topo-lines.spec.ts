import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/047-topo-lines.html?seed=1234';
const topo = <T>(page: Page, expr: string) => page.evaluate(`(() => { const T = window.__topo; return ${expr}; })()`) as Promise<T>;

/** Read one canvas pixel at CSS coordinates. */
function pixel(page: Page, x: number, y: number) {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector('#map') as HTMLCanvasElement;
    const s = c.width / c.getBoundingClientRect().width * (c.getBoundingClientRect().width / (window as any).__topo.gridToCss(0, 0).w);
    return Array.from(c.getContext('2d')!.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data).slice(0, 3);
  }, [x, y]);
}

test.describe('047 Topo Lines', () => {
  test('marching squares: segment counts match the cell cases and every vertex lies on its level', async ({ page }) => {
    await page.goto(URL);
    const { COLS, ROWS, grid, levels } = await page.evaluate(() => { const T = (window as any).__topo; return { COLS: T.COLS, ROWS: T.ROWS, grid: T.grid(), levels: T.levels() }; });
    const at = (i: number, j: number) => grid[j * COLS + i];
    const sample = [levels[2], levels[Math.floor(levels.length / 2)], levels[levels.length - 3], 555.5];
    for (const e of sample) {
      let expected = 0;
      for (let j = 0; j < ROWS - 1; j++) for (let i = 0; i < COLS - 1; i++) {
        const c = (at(i, j) >= e ? 8 : 0) | (at(i + 1, j) >= e ? 4 : 0) | (at(i + 1, j + 1) >= e ? 2 : 0) | (at(i, j + 1) >= e ? 1 : 0);
        expected += c === 0 || c === 15 ? 0 : c === 5 || c === 10 ? 2 : 1;
      }
      const res = await topo<{ lines: number[][][]; segCount: number }>(page, `T.contour(${e})`);
      expect(res.segCount, `level ${e}`).toBe(expected);
      // a stitched polyline with n points uses n − 1 segments (closed loops repeat their first point)
      expect(res.lines.reduce((s, L) => s + L.length - 1, 0)).toBe(expected);
      for (const L of res.lines) for (const [x, y] of L) {
        const onVertical = Math.abs(x - Math.round(x)) < 1e-9;
        const v = onVertical
          ? at(Math.round(x), Math.floor(y)) + (at(Math.round(x), Math.ceil(y)) - at(Math.round(x), Math.floor(y))) * (y - Math.floor(y))
          : at(Math.floor(x), Math.round(y)) + (at(Math.ceil(x), Math.round(y)) - at(Math.floor(x), Math.round(y))) * (x - Math.floor(x));
        expect(Math.abs(v - e)).toBeLessThan(1e-3);
      }
    }
    // index contours every fifth line: levels are multiples of the interval
    expect(levels.every((l: number) => l % 20 === 0)).toBe(true);
    await page.getByTestId('interval').selectOption('10');
    const l10 = await topo<number[]>(page, 'T.levels()');
    expect(l10.length).toBeGreaterThanOrEqual(levels.length * 2 - 1);
    await expect(page.getByTestId('map')).toHaveAttribute('aria-label', /contours at 10 meter interval/);
  });

  test('terrain is seeded: same seed, same map; a new seed redraws and updates the URL', async ({ page }) => {
    await page.goto(URL);
    const h1 = await topo<number>(page, 'T.hash()');
    await expect(page.getByTestId('quad-name')).toHaveText(await topo<string>(page, 'T.quad'));
    await expect(page.getByTestId('seed-label')).toHaveText('Seed 1234');
    await page.reload();
    expect(await topo<number>(page, 'T.hash()')).toBe(h1);
    await page.getByTestId('seed').fill('77');
    await page.getByTestId('generate').click();
    await expect(page.getByTestId('seed-label')).toHaveText('Seed 77');
    await expect(page).toHaveURL(/seed=77/);
    expect(await topo<number>(page, 'T.hash()')).not.toBe(h1);
    const [min, max] = await topo<number[]>(page, '[T.min, T.max]');
    await expect(page.getByTestId('relief')).toHaveText(`Relief ${Math.round(min).toLocaleString('en-US')}–${Math.round(max).toLocaleString('en-US')} m`);
  });

  test('water level floods the low ground; the flooded share matches the grid', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('hillshade').click();
    await expect(page.getByTestId('hillshade')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('flooded')).toHaveText('0% under water');
    await page.getByTestId('water').fill('40');
    const info = await page.evaluate(() => {
      const T = (window as any).__topo, g: number[] = T.grid(), wl = T.waterLevel;
      let lo = 0, hi = 0;
      g.forEach((v, n) => { if (v < g[lo]) lo = n; if (v > g[hi]) hi = n; });
      return { wl, share: Math.round(g.filter((v) => v < wl).length / g.length * 100), low: T.gridToCss(lo % T.COLS, Math.floor(lo / T.COLS)), high: T.gridToCss(hi % T.COLS, Math.floor(hi / T.COLS)) };
    });
    expect(info.wl).toBeGreaterThan(0);
    await expect(page.getByTestId('flooded')).toHaveText(`${info.share}% under water`);
    await expect(page.getByTestId('water-out')).toHaveText(`${Math.round(info.wl).toLocaleString('en-US')} m`);
    const clampXY = (p: { x: number; y: number }) => [Math.min(Math.max(p.x, 3), p.w - 3), Math.min(Math.max(p.y, 3), p.h - 50)];
    const [lr, lg, lb] = await pixel(page, ...(clampXY(info.low) as [number, number]));
    expect(lb - lr).toBeGreaterThan(25);            // blue water at the lowest point
    const [hr, , hb] = await pixel(page, ...(clampXY(info.high) as [number, number]));
    expect(hr).toBeGreaterThan(hb);                  // dry, warm paper or brown ink at the summit
    void lg;
  });

  test('palettes recolor the sheet', async ({ page }) => {
    await page.goto(URL);
    const legendPixel = async () => { const p = await topo<{ w: number; h: number }>(page, 'T.gridToCss(0, 0)'); return pixel(page, p.w * 0.55, p.h - 3); };
    expect(await legendPixel()).toEqual([0xf3, 0xec, 0xd8]);
    await page.getByTestId('pal-blueprint').click();
    await expect(page.getByTestId('pal-blueprint')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('map')).toHaveAttribute('data-palette', 'blueprint');
    expect(await legendPixel()).toEqual([0x1d, 0x4e, 0x89]);
    await page.getByTestId('pal-night').click();
    expect(await legendPixel()).toEqual([0x0b, 0x13, 0x20]);
    await expect(page.getByTestId('pal-usgs')).toHaveAttribute('aria-pressed', 'false');
  });

  test('tapping the map climbs to the nearest summit and marks its elevation', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('no-markers')).toBeVisible();
    const box = (await page.getByTestId('map').boundingBox())!;
    await page.getByTestId('map').click({ position: { x: box.width * 0.3, y: box.height * 0.35 } });
    await expect(page.getByTestId('marker-0')).toBeVisible();
    const m = (await topo<any[]>(page, 'T.markers'))[0];
    expect(await topo<boolean>(page, `T.isLocalMax(${m.i}, ${m.j})`)).toBe(true);
    expect(m.e).toBeGreaterThanOrEqual(m.from.e);
    expect(m.e).toBe(await topo<number>(page, `T.elev(${m.i}, ${m.j})`));
    await expect(page.getByTestId('marker-0')).toContainText(`${Math.round(m.e).toLocaleString('en-US')} m`);
    await expect(page.getByTestId('hint')).toHaveText(`Climbed from ${Math.round(m.from.e)} m to a summit at ${Math.round(m.e)} m`);
    await page.getByTestId('map').click({ position: { x: box.width * 0.75, y: box.height * 0.6 } });
    await expect(page.getByTestId('markers').locator('li')).toHaveCount(await topo<number>(page, 'T.markers.length'));
    await page.getByTestId('clear').click();
    await expect(page.getByTestId('markers').locator('li')).toHaveCount(0);
    await expect(page.getByTestId('no-markers')).toBeVisible();
  });

  test('export downloads a PNG of the sheet', async ({ page }) => {
    await page.goto(URL);
    const quad = await topo<string>(page, 'T.quad');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
    expect(download.suggestedFilename()).toBe(`topo-${quad.toLowerCase().replace(/\s+/g, '-')}-1234.png`);
    const bytes = readFileSync(await download.path());
    expect(bytes.length).toBeGreaterThan(10_000);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
