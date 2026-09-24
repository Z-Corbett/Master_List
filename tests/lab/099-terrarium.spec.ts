import { test, expect, Page } from '@playwright/test';

const URL = '/lab/099-terrarium.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__terrarium.state);
const adv = (page: Page, h: number) => page.evaluate((h) => (window as any).__terrarium.advance(h), h);

/** Detach the real-time loop and restart the jar at day 1, 08:00. */
async function open(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => { const T = (window as any).__terrarium; T.manual(true); T.reset(); });
}

test.describe('099 Terrarium', () => {
  test('the jar is seeded: same seed, same jar and the same week', async ({ page }) => {
    await open(page);
    const a = await adv(page, 7 * 24);
    await open(page);
    const b = await adv(page, 7 * 24);
    expect(b).toEqual(a);
    await open(page, '/lab/099-terrarium.html?seed=8');
    const c = await S(page);
    expect(c.plants.map((p: any) => [p.kind, p.u])).not.toEqual(a.plants.map((p: any) => [p.kind, p.u]));
    expect(a.plants.some((p: any) => p.kind === 'fern')).toBe(true);
    expect(a.plants.some((p: any) => p.kind === 'fittonia')).toBe(true);
    // Plant a new jar picks a new seed and remembers it in the address
    await page.getByTestId('reseed').click();
    const seed = (await S(page)).seed;
    expect(page.url()).toContain(`seed=${seed}`);
    await expect(page.getByTestId('status')).toHaveText(`A new jar, planted with seed ${seed}.`);
  });

  test('sealed, the water only moves: soil → air → beads on the glass → drips back', async ({ page }) => {
    await open(page);
    const start = await S(page);
    let beadsAtNight = 0, beadsAtNoon = 0, maxHumidity = 0;
    await adv(page, 16);                                   // day 1, 08:00 → midnight
    for (let d = 0; d < 10; d++) {
      let s = await S(page);                               // 00:00
      expect(s.hour).toBe(0);
      expect(s.light).toBe(0);
      beadsAtNight = Math.max(beadsAtNight, s.beads);
      s = await adv(page, 12);                             // 12:00
      expect(s.light).toBeGreaterThan(0.9);
      beadsAtNoon += s.beads;
      maxHumidity = Math.max(maxHumidity, s.humidity);
      expect(Math.abs(s.water - start.water)).toBeLessThan(1e-9);   // conserved to the last drop
      await adv(page, 12);                                 // next midnight
    }
    const s = await S(page);
    expect(beadsAtNight).toBeGreaterThan(20);              // the glass fogs over at night
    expect(beadsAtNoon / 10).toBeLessThan(beadsAtNight);   // and clears in the heat of the day
    expect(s.drips).toBeGreaterThan(10);                   // heavy beads run back down
    expect(maxHumidity).toBeGreaterThan(0.7);
    await expect(page.getByTestId('s-drips')).toHaveText(String(s.drips));
    await expect(page.getByTestId('s-beads')).toHaveText(String(s.beads));
  });

  test('plants, moss and springtails grow in a healthy sealed jar', async ({ page }) => {
    await open(page);
    const a = await S(page);
    const b = await adv(page, 12 * 24);
    a.plants.forEach((p: any, i: number) => expect(b.plants[i].g).toBeGreaterThan(p.g + 0.1));
    expect(b.moss).toBeGreaterThan(a.moss);
    expect(b.springtails).toBeGreaterThan(a.springtails * 3);
    expect(b.plants.every((p: any) => p.wilt === 0)).toBe(true);
    await expect(page.getByTestId('jar')).toHaveAttribute('aria-label', /lid on/);
    await expect(page.getByTestId('jar')).not.toHaveAttribute('aria-label', /wilting/);
    // L-system: more iterations, more segments
    const counts = await page.evaluate(() => { const T = (window as any).__terrarium; return [3, 6, 9].map((n) => (T.lsys('A', T.FERN, n).match(/F/g) || []).length); });
    expect(counts).toEqual([3, 6, 9]);
  });

  test('lid off: humidity falls to the room, water escapes, the soil dries and plants wilt', async ({ page }) => {
    await open(page);
    await adv(page, 3 * 24);
    await page.getByTestId('lid').click();
    await expect(page.getByTestId('lid')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('lid')).toHaveText('Put the lid back');
    let s = await adv(page, 24);
    const water0 = s.water;
    expect(s.humidity).toBeLessThan(0.55);
    expect(s.lost).toBeGreaterThan(0);
    s = await adv(page, 12 * 24);
    expect(s.water).toBeLessThan(water0 - 15);
    expect(s.soil).toBeLessThan(16);
    expect(s.beads).toBe(0);
    expect(s.plants.some((p: any) => p.wilt > 0)).toBe(true);
    await expect(page.getByTestId('jar')).toHaveAttribute('aria-label', /some wilting/);
    // put it back and mist it: sealed again, water is conserved from here on
    await page.getByTestId('lid').click();
    for (let i = 0; i < 6; i++) await page.getByTestId('mist').click();
    s = await S(page);
    const sealed = s.water;
    s = await adv(page, 48);
    expect(Math.abs(s.water - sealed)).toBeLessThan(1e-9);
    expect(s.plants.every((p: any) => p.wilt === 0)).toBe(true);
  });

  test('time-lapse follows the slider; +6 hours steps by hand', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-04-01T10:00:00') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-04-01T10:00:01'));
    await page.evaluate(() => (window as any).__terrarium.reset());
    await page.getByTestId('speed').fill('12');
    await expect(page.getByTestId('speed-out')).toHaveText('12 h/s');
    const t0 = (await S(page)).t;
    await page.clock.runFor(2000);
    const t1 = (await S(page)).t;
    expect(t1 - t0).toBeGreaterThan(22);
    expect(t1 - t0).toBeLessThan(26);
    await page.getByTestId('speed').fill('0');
    await expect(page.getByTestId('speed-out')).toHaveText('paused');
    await page.clock.runFor(2000);
    expect((await S(page)).t).toBe(t1);
    await page.getByTestId('step').click();
    expect((await S(page)).t).toBe(t1 + 6);
    await expect(page.getByTestId('clock')).toHaveText(/^Day \d+ · \d\d:\d\d$/);
  });
});
