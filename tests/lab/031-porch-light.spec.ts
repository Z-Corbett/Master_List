import { test, expect, Page } from '@playwright/test';

const URL = '/lab/031-porch-light.html?seed=42';
const porch = (page: Page) => page.evaluate(() => {
  const p = (window as any).__porch;
  return { chirps: p.chirpCount as number, rate: p.chirpsPerMinute as number, bolts: p.lightning as number, flashes: p.fireflyFlashes as number, started: p.audioStarted as boolean };
});

async function fakeClock(page: Page) {
  await page.clock.install({ time: new Date('2026-07-04T21:30:00') });
  await page.clock.pauseAt(new Date('2026-07-04T21:30:01'));
}

test.describe('031 Porch Light', () => {
  test('Dolbear\'s law: chirp rate is 4 × °F − 160 across the slider range', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('chirp-rate')).toHaveText('176'); // 84°F default
    const cases: Array<[number, number, string]> = [[55, 60, '13°C'], [75, 140, '24°C'], [100, 240, '38°C']];
    for (const [f, n, c] of cases) {
      await page.getByTestId('temp-slider').fill(String(f));
      await expect(page.getByTestId('chirp-rate')).toHaveText(String(n));
      await expect(page.getByTestId('temp-readout')).toHaveText(`${f}°F${c}`);
      // the 15-second rule must round-trip back to the temperature
      await expect(page.getByTestId('rule-check')).toHaveText(`Check: ${n} ÷ 4 = ${n / 4} chirps per 15 s, + 40 = ${f}°F.`);
    }
    const oracle = await page.evaluate(() => [60, 70, 90].map(f => (window as any).__porch.dolbear(f)));
    expect(oracle).toEqual([80, 120, 200]);
  });

  test('the visual chirp clock counts one minute of chirps on the fake clock', async ({ page }) => {
    await fakeClock(page);
    await page.goto(URL);
    await page.getByTestId('temp-slider').fill('75');
    await page.clock.runFor(100);
    const before = (await porch(page)).chirps;
    await page.clock.fastForward(60_000);
    await page.clock.runFor(100);
    const after = (await porch(page)).chirps;
    expect(after - before).toBeGreaterThanOrEqual(139);
    expect(after - before).toBeLessThanOrEqual(141);
    await expect(page.getByTestId('chirp-count')).toHaveText(String(after));
  });

  test('heat lightning and fireflies keep happening on a seeded schedule', async ({ page }) => {
    await fakeClock(page);
    await page.goto(URL);
    await page.clock.runFor(200);
    const a = await porch(page);
    for (let i = 0; i < 6; i++) { await page.clock.fastForward(10_000); await page.clock.runFor(50); }
    const b = await porch(page);
    expect(b.bolts - a.bolts).toBeGreaterThanOrEqual(3);
    expect(b.flashes).toBeGreaterThan(a.flashes);
    await expect(page.getByTestId('lightning-count')).toHaveText(String(b.bolts));
  });

  test('switching the porch light off lets the moths drift away from the bulb', async ({ page }) => {
    test.setTimeout(60_000);
    await fakeClock(page);
    await page.goto(URL);
    await page.clock.runFor(4000);
    const lit = await page.evaluate(() => (window as any).__porch.avgMothDistance());
    expect(lit).toBeLessThan(160);
    await page.getByTestId('light-toggle').click();
    await expect(page.getByTestId('light-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('light-toggle')).toHaveText('Porch light off');
    await page.clock.runFor(8000);
    const dark = await page.evaluate(() => (window as any).__porch.avgMothDistance());
    expect(dark).toBeGreaterThan(lit * 1.5);
  });

  test('audio starts only after a gesture, schedules chirps, and can be muted', async ({ page }) => {
    await page.goto(URL);
    expect((await porch(page)).started).toBe(false);
    await expect(page.getByTestId('mute')).toBeHidden();
    await page.getByTestId('sound-toggle').click();
    await expect(page.getByTestId('mute')).toBeVisible();
    expect((await porch(page)).started).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__porch.scheduledChirps), { timeout: 5000 }).toBeGreaterThan(0);

    await page.getByTestId('mute').click();
    await expect(page.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => (window as any).__porch.masterGain)).toBe(0);
    await page.getByTestId('mute').click();
    await expect(page.getByTestId('mute')).toHaveText('Mute');
    await expect.poll(() => page.evaluate(() => (window as any).__porch.masterGain)).toBeCloseTo(0.8, 5);
  });
});
