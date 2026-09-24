import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/095-neon-sign-shop.html?seed=5';
const S = (page: Page) => page.evaluate(() => (window as any).__neon.state);

async function openAt(page: Page) {
  await page.clock.install({ time: new Date('2026-06-01T21:00:00') });
  await page.goto(URL);
  await page.clock.pauseAt(new Date('2026-06-01T21:00:01'));
}

test.describe('095 Neon Sign Shop', () => {
  test('the tube font: A–Z and 0–9, each one continuous tube inside its cell', async ({ page }) => {
    await page.goto(URL);
    const report = await page.evaluate(() => {
      const N = (window as any).__neon, out: any[] = [];
      for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
        const g = N.glyph(ch);
        if (!g) { out.push({ ch, missing: true }); continue; }
        const inCell = g.pts.every(([x, y]: number[]) => x >= 0 && x <= g.w + 0.5 && y >= 0 && y <= 6.5);
        const zero = g.pts.some((p: number[], i: number) => i && Math.hypot(p[0] - g.pts[i - 1][0], p[1] - g.pts[i - 1][1]) < 1e-9);
        const lit = g.flags.filter((f: string) => f === 'lit').length;
        out.push({ ch, ok: g.flags.length === g.pts.length - 1 && inCell && !zero && lit >= 1 && g.flags[0] === 'lit' && g.flags[g.flags.length - 1] === 'lit' });
      }
      return out;
    });
    expect(report.filter((r: any) => !r.ok).map((r: any) => r.ch)).toEqual([]);
    // letters that must double back use blockouts; simple strokes don't
    const blk = await page.evaluate(() => { const N = (window as any).__neon; return Object.fromEntries(['E', 'T', 'H', 'O', 'L', 'S'].map((c) => [c, N.glyph(c).flags.filter((f: string) => f === 'blockout').length])); });
    expect(blk).toEqual({ E: 1, T: 1, H: 2, O: 0, L: 0, S: 0 });
  });

  test('typing bends the letters: uppercase, unsupported characters left out, electrodes counted', async ({ page }) => {
    await page.goto(URL);
    let s = await S(page);
    expect(s.tubes.map((t: any) => t.ch).join('')).toBe('OPENLATETACOS24');
    await page.getByTestId('line1').fill('howdy y@ll');
    await page.getByTestId('line2').fill('');
    await expect(page.getByTestId('hint')).toHaveText(`Can't bend "@" in this font, so it's left out.`);
    s = await S(page);
    expect(s.tubes.map((t: any) => t.ch).join('')).toBe('HOWDYYLL');
    expect(s.skipped).toEqual(['@']);
    await expect(page.getByTestId('spec')).toContainText('8 tube units · 16 electrodes');
    await expect(page.getByTestId('sign')).toHaveAttribute('aria-label', /reading "howdy y@ll"/);
    await page.getByTestId('line1').fill('ATX 512');
    await expect(page.getByTestId('hint')).not.toHaveClass(/warn/);
    s = await S(page);
    expect(s.tubes.map((t: any) => t.ch).join('')).toBe('ATX512');
    // the sign always fits the canvas
    expect(s.bbox.x0).toBeGreaterThan(0);
    expect(s.bbox.x1).toBeLessThan(1200);
    await page.getByTestId('line1').fill('WWWWWWWWWWWWWW');
    s = await S(page);
    expect(s.bbox.x0).toBeGreaterThan(0);
    expect(s.bbox.x1).toBeLessThan(1200);
  });

  test('switch on: tubes strike one by one, then glow in their gas colour; off shows the glass', async ({ page }) => {
    await openAt(page);
    await page.getByTestId('line2').fill('');
    await page.getByTestId('line1').fill('EAT');
    await page.getByTestId('colour-red').click();
    await expect(page.getByTestId('colour-info')).toHaveText('Line 1: Neon red. Neon in clear glass.');
    const px = () => page.evaluate(() => (window as any).__neon.litPixel(1, 0.12));
    const off = await px();
    await page.getByTestId('power').click();
    await expect(page.getByTestId('power')).toHaveAttribute('aria-pressed', 'true');
    await page.clock.runFor(40);
    let s = await S(page);
    expect(s.power).toBe('warming');
    expect(s.levels[0]).toBeGreaterThan(0);
    expect(s.levels[2]).toBe(0);                        // the last letter has not struck yet
    await page.clock.runFor(3000);
    s = await S(page);
    expect(s.power).toBe('on');
    expect(s.levels).toEqual([1, 1, 1]);
    await expect(page.getByTestId('readout')).toHaveText('The sign is lit.');
    const on = await px();
    expect(on[0]).toBeGreaterThan(200);                 // neon red: red channel dominates
    expect(on[0]).toBeGreaterThan(on[2] + 60);
    expect(Math.abs(off[0] - off[2])).toBeLessThan(40);             // unlit clear glass is nearly neutral
    expect(on[0] - on[2]).toBeGreaterThan(off[0] - off[2] + 80);
    // argon blue on the same tube reads blue
    await page.getByTestId('colour-blue').click();
    const blue = await px();
    expect(blue[2]).toBeGreaterThan(blue[0] + 60);
    await page.getByTestId('power').click();
    s = await S(page);
    expect(s.power).toBe('off');
    expect(s.levels).toEqual([0, 0, 0]);
  });

  test('flicker dips tubes now and then; buzz only hums while the sign is on', async ({ page }) => {
    await openAt(page);
    await page.getByTestId('power').click();
    await page.clock.runFor(2500);
    await page.getByTestId('flicker').click();
    await expect(page.getByTestId('flicker')).toHaveAttribute('aria-pressed', 'true');
    let dips = 0, samples = 0;
    for (let i = 0; i < 60; i++) {
      await page.clock.runFor(70);
      const L: number[] = (await S(page)).levels;
      samples += L.length; dips += L.filter((v) => v < 1).length;
      for (const v of L) expect(v).toBeGreaterThan(0);
    }
    expect(dips).toBeGreaterThan(0);
    expect(dips).toBeLessThan(samples * 0.3);
    await page.getByTestId('buzz').click();
    expect((await S(page)).hum).toBe(true);
    await page.getByTestId('power').click();
    expect((await S(page)).hum).toBe(false);
    await expect(page.getByTestId('buzz')).toHaveAttribute('aria-pressed', 'true');
  });

  test('backboard, standoffs, wall and style are radio groups; PNG export', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('board-contour').click();
    await page.getByTestId('standoff-brass').click();
    await page.getByTestId('wall-concrete').click();
    await page.getByTestId('style-block').click();
    let s = await S(page);
    expect([s.board, s.stand, s.wall, s.style]).toEqual(['contour', 'brass', 'concrete', 'block']);
    await expect(page.getByTestId('sign')).toHaveAttribute('aria-label', /block tubes, Hot pink and Turquoise, on a concrete wall with cut to shape backboard/);
    // arrow keys inside a group
    await page.getByTestId('wall-concrete').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('wall-brick')).toBeFocused();
    await expect(page.getByTestId('wall-brick')).toHaveAttribute('aria-checked', 'true');
    // block style keeps the font's corners; rounded adds points
    const blockPts = s.tubes[0].points;
    await page.getByTestId('style-rounded').click();
    s = await S(page);
    expect(s.tubes[0].points).toBeGreaterThan(blockPts);
    // per-line colour
    await page.getByTestId('colour-line2').click();
    await page.getByTestId('colour-gold').click();
    s = await S(page);
    expect(s.colours).toEqual(['pink', 'gold']);
    expect(s.tubes.filter((t: any) => t.line === 1).every((t: any) => t.colour === 'gold')).toBe(true);
    const dlP = page.waitForEvent('download');
    await page.getByTestId('export').click();
    const dl = await dlP;
    expect(dl.suggestedFilename()).toBe('neon-open-late-tacos-24.png');
    expect([...readFileSync(await dl.path()).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    await expect(page.getByTestId('readout')).toHaveText('Saved neon-open-late-tacos-24.png.');
  });

  test('reduced motion lights the sign at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await page.getByTestId('power').click();
    const s = await S(page);
    expect(s.power).toBe('on');
    expect(s.levels.every((v: number) => v === 1)).toBe(true);
  });
});
