import { test, expect, Page } from '@playwright/test';

const URL = '/lab/060-marfa-lights.html?seed=5';
const state = (page: Page) => page.evaluate(() => (window as any).__marfa.state);

/** Freeze the animation loop so only the test moves the simulation. */
async function frozen(page: Page, url = URL) {
  await page.clock.install({ time: new Date('2026-06-20T21:00:00') });
  await page.clock.pauseAt(new Date('2026-06-20T21:00:02'));
  await page.goto(url);
}

test.describe('060 Marfa Lights', () => {
  test('a freshly spawned light can be drawn before its first update (no NaN gradients)', async ({ page }) => {
    // Regression: spawn() left `pulse` undefined until the next step, so a frame drawn in between passed NaN
    // into createRadialGradient and threw. Alternate one simulation step with one redraw to hit that window.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    test.setTimeout(90_000);
    await frozen(page);
    const ids = () => page.evaluate(() => (window as any).__marfa.lights().map((l: any) => l.id) as number[]);
    const seen = new Set<number>(await ids());
    let spawned = 0;
    for (let i = 0; i < 400; i++) {
      // One simulation step (which may spawn a light), then exactly one animation frame, which draws but is
      // too short to step again — the real loop's step-then-render order. The old code threw here.
      await page.evaluate(() => (window as any).__marfa.step(1 / 30));
      await page.clock.runFor(16);
      for (const id of await ids()) if (!seen.has(id)) { seen.add(id); spawned++; }
    }
    // With seed 5 this run spawns one light, the exact one that crashed the old code; require at least that.
    expect(spawned, 'the run must actually spawn a new light').toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('the time slider moves through dusk, night and first light', async ({ page }) => {
    await page.goto(URL);
    const time = page.getByTestId('time');
    await time.fill('15');
    await expect(page.getByTestId('clock')).toHaveText('19:45');
    await expect(page.getByTestId('phase')).toHaveText('dusk');
    const dusk = await state(page);
    await time.fill('300');
    await expect(page.getByTestId('clock')).toHaveText('00:30');
    await expect(page.getByTestId('phase')).toHaveText('night');
    const night = await state(page);
    expect(night.darkness).toBe(1);
    expect(dusk.darkness).toBeLessThan(0.2);
    await time.fill('590');
    await expect(page.getByTestId('clock')).toHaveText('05:20');
    await expect(page.getByTestId('phase')).toHaveText('first light');
    expect((await state(page)).darkness).toBeLessThan(0.5);
    // the canvas describes itself
    await time.fill('300');
    await expect(page.getByTestId('night')).toHaveAttribute('aria-label', /00:30 \(night\), stars turned 52\.6 degrees about Polaris/);
  });

  test('the sky turns counterclockwise about a fixed Polaris at the sidereal rate', async ({ page }) => {
    await frozen(page);
    const r = await page.evaluate(() => {
      const m = (window as any).__marfa;
      const p0 = m.polaris(); m.setMinutes(120); const p1 = m.polaris(); m.setMinutes(240); const p2 = m.polaris();
      const out: any[] = [];
      for (const i of [3, 40, 400]) {
        const a = m.star(i, 120), b = m.star(i, 240);
        const ang = (q: any) => Math.atan2(-(q.y - p1.y), q.x - p1.x) * 180 / Math.PI;
        let d = ang(b) - ang(a); if (d < -180) d += 360; if (d > 180) d -= 360;
        out.push({ d, ra: Math.hypot(a.x - p1.x, a.y - p1.y), rb: Math.hypot(b.x - p1.x, b.y - p1.y) });
      }
      return { p0, p1, p2, out, rot: m.state.rotationDeg };
    });
    expect(r.p1).toEqual(r.p0);
    expect(r.p2).toEqual(r.p0);
    for (const s of r.out) {
      // two hours = 30.08°, positive = counterclockwise on screen when facing north
      expect(s.d).toBeCloseTo(2 * 15.041, 3);
      expect(s.rb).toBeCloseTo(s.ra, 6);
    }
    // Polaris stands about 30° above the horizon: its height over the horizon is 30 × pixels-per-degree
    const size = await page.evaluate(() => (window as any).__marfa.size);
    expect(r.p0.y).toBeLessThan(size.horizon);
  });

  test('horizon lights are seeded: same seed replays, lights split and merge, the count stays bounded', async ({ page }) => {
    await frozen(page);
    const run = () => page.evaluate(() => { const m = (window as any).__marfa; m.reset(); const e = m.step(300); return { e, lights: m.lights() }; });
    const a = await run();
    expect(a.e.splits).toBeGreaterThan(3);
    expect(a.e.merges).toBeGreaterThan(0);
    expect(a.e.lights).toBeGreaterThanOrEqual(2);
    expect(a.e.lights).toBeLessThanOrEqual(9);
    for (const L of a.lights) { expect(L.x).toBeGreaterThan(-0.06); expect(L.x).toBeLessThan(1.06); }
    const b = await run();
    expect(b).toEqual(a);
    await frozen(page, '/lab/060-marfa-lights.html?seed=6');
    const c = await run();
    expect(c.lights).not.toEqual(a.lights);
    // the counters shown below the scene follow the simulation
    await expect(page.getByTestId('stats')).toContainText(`${c.e.splits} splits · ${c.e.merges} merge`);
    await expect(page.getByTestId('live')).toContainText('on the horizon');
  });

  test('binoculars magnify the horizon, blacking out everything outside the eyepieces; keys and taps aim them', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('time').fill('300');
    await page.getByTestId('binocs').click();
    await expect(page.getByTestId('binocs')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('hint')).toBeVisible();
    await expect(page.getByTestId('night')).toBeFocused();
    await page.waitForTimeout(200);
    const corner = await page.evaluate(() => (window as any).__marfa.pixel(3, 3));
    expect(corner).toEqual([0, 0, 0]);
    const a0 = (await state(page)).aim;
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    const a1 = (await state(page)).aim;
    expect(a1.x).toBeCloseTo(Math.min(1, a0.x + 0.015), 5);
    expect(a1.y).toBeCloseTo(a0.y + 10, 5);
    // tapping left of centre swings the view left
    const box = (await page.getByTestId('night').boundingBox())!;
    await page.getByTestId('night').click({ position: { x: box.width * 0.2, y: box.height * 0.5 } });
    expect((await state(page)).aim.x).toBeLessThan(a1.x);
    await page.getByTestId('night').press('Escape');
    await expect(page.getByTestId('binocs')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('hint')).toBeHidden();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).__marfa.pixel(3, 3))).not.toEqual([0, 0, 0]);
  });

  test('time-lapse runs an hour every ten seconds; trails and wind toggle', async ({ page }) => {
    test.setTimeout(60_000);
    await frozen(page);
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'true');
    const m0 = (await state(page)).minutes;
    await page.clock.runFor(5_000);
    const m1 = (await state(page)).minutes;
    expect(m1 - m0).toBeGreaterThan(28);
    expect(m1 - m0).toBeLessThan(32);
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'false');
    const paused = (await state(page)).minutes;
    await page.clock.runFor(1_000);
    expect((await state(page)).minutes).toBe(paused);

    await page.getByTestId('trails').click();
    await expect(page.getByTestId('trails')).toHaveAttribute('aria-pressed', 'true');
    expect((await state(page)).trails).toBe(true);

    expect(await page.evaluate(() => (window as any).__marfa.audioState)).toBe('none'); // no audio before a gesture
    await page.getByTestId('wind').click();
    await expect(page.getByTestId('wind')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => (window as any).__marfa.audioState)).not.toBe('none');
    await page.getByTestId('wind').click();
    await expect(page.getByTestId('wind')).toHaveAttribute('aria-pressed', 'false');
  });
});
