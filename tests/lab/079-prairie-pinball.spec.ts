import { test, expect, Page } from '@playwright/test';

const URL = '/lab/079-prairie-pinball.html?seed=3';
const P = (page: Page) => page.evaluate(() => (window as any).__pinball.state);
const frames = (page: Page, n: number) => page.evaluate((n) => (window as any).__pinball.frames(n), n);
const place = (page: Page, x: number, y: number, vx = 0, vy = 0) => page.evaluate(([x, y, vx, vy]) => (window as any).__pinball.place(x, y, vx, vy), [x, y, vx, vy]);
const trace = (page: Page, n: number) => page.evaluate((n) => (window as any).__pinball.trace(n), n);
/** Start a game with the real-time loop detached: every physics step is driven by the test. */
async function start(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => (window as any).__pinball.manual(true));
  await page.getByTestId('start').click();
  await expect(page.getByTestId('start-overlay')).toBeHidden();
}
async function plunge(page: Page, holdFrames: number) {
  await page.keyboard.down('Space');
  await frames(page, holdFrames);
  await page.keyboard.up('Space');
}

test.describe('079 Prairie Pinball', () => {
  test('flippers answer the keyboard and the two halves of the table', async ({ page }) => {
    await start(page);
    const rest = (await P(page)).flippers;
    await page.keyboard.down('z');
    let f = (await frames(page, 6)).flippers;
    expect(f[0].ang).toBeCloseTo(-0.44, 5);           // left flipper fully up
    expect(f[1].ang).toBeCloseTo(rest[1].ang, 5);      // right untouched
    await page.keyboard.up('z');
    await page.keyboard.down('ArrowRight');
    f = (await frames(page, 8)).flippers;
    expect(f[0].ang).toBeCloseTo(0.52, 5);
    expect(f[1].ang).toBeCloseTo(Math.PI + 0.44, 5);
    await page.keyboard.up('ArrowRight');
    await frames(page, 10);
    // touch: the left and right halves of the playfield
    const table = page.getByTestId('table'), box = (await table.boundingBox())!;
    await table.dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: box.x + box.width * 0.2, clientY: box.y + box.height * 0.8, bubbles: true });
    f = (await frames(page, 6)).flippers;
    expect(f[0].ang).toBeCloseTo(-0.44, 5);
    expect(f[1].ang).toBeCloseTo(Math.PI - 0.52, 5);
    await table.dispatchEvent('pointerup', { pointerId: 3, pointerType: 'touch', clientX: box.x + box.width * 0.2, clientY: box.y + box.height * 0.8, bubbles: true });
    await table.dispatchEvent('pointerdown', { pointerId: 4, pointerType: 'touch', clientX: box.x + box.width * 0.8, clientY: box.y + box.height * 0.8, bubbles: true });
    f = (await frames(page, 6)).flippers;
    expect(f[1].ang).toBeCloseTo(Math.PI + 0.44, 5);
  });

  test('the plunger: a longer pull launches harder, and ball save starts', async ({ page }) => {
    await start(page);
    const launchSpeed = async (hold: number) => {
      await page.evaluate(() => (window as any).__pinball.start());
      await plunge(page, hold);
      return (await P(page)).ball.vy;
    };
    const soft = await launchSpeed(15), hard = await launchSpeed(60);
    expect(hard).toBeLessThan(soft - 800);           // upward is negative
    expect(hard).toBeLessThan(-2000);
    const s = await P(page);
    expect(s.save).toBeCloseTo(8, 1);
    await expect(page.getByTestId('status')).toContainText('Launched at 100% pull');
    // the ball climbs the shooter lane and leaves it into the playfield
    const after = await frames(page, 60);
    expect(after.ball.inLane).toBe(false);
    expect(after.ball.x).toBeLessThan(358);
    expect(after.save).toBeLessThan(8);
  });

  test('physics is deterministic per seed', async ({ page }) => {
    const run = async (url: string) => {
      await start(page, url);
      await plunge(page, 24);
      await page.keyboard.down('m');
      const t = await trace(page, 200);
      await page.keyboard.up('m');
      return { t: t.filter((_: unknown, i: number) => i % 40 === 0), s: await P(page) };
    };
    const a = await run(URL), b = await run(URL);
    expect(b.t).toEqual(a.t);
    expect(b.s.score).toBe(a.s.score);
    const c = await run('/lab/079-prairie-pinball.html?seed=4');
    expect(c.t).not.toEqual(a.t);
  });

  test('swept sub-stepping: a ball at top speed never tunnels through a wall, a divider or a flipper', async ({ page }) => {
    await start(page);
    // straight at the left wall at 2,600 px/s (10.8 px per 1/240 s step, more than the ball's radius)
    await place(page, 40, 300, -9000, 0);
    let t = await trace(page, 4);
    for (const [x] of t) expect(x).toBeGreaterThanOrEqual(12 + 9 - 0.01);
    // a 0-thickness lane divider at x = 145
    await place(page, 125, 100, 9000, 0);
    t = await trace(page, 3);
    for (const [x, y] of t) if (y > 74 && y < 112) expect(x).toBeLessThanOrEqual(145 - 9 + 0.01);
    // straight down onto the left flipper at rest
    await place(page, 132, 560, 0, 9000);
    t = await trace(page, 3);
    const flipY = (x: number) => 626 + (x - 102) * Math.tan(0.52);
    for (const [x, y] of t) if (x > 108 && x < 150) expect(y).toBeLessThan(flipY(x));
    // and a flipper swinging up into a fast ball knocks it upward
    await place(page, 140, 600, 0, 1500);
    await page.keyboard.down('z');
    const s = await frames(page, 3);
    await page.keyboard.up('z');
    expect(s.ball.vy).toBeLessThan(-300);
  });

  test('bumpers, S-T-A-R lanes, multiplier, lane change, windmill and ramp all score', async ({ page }) => {
    await start(page);
    await place(page, 132, 196, 0, 250);   // onto the first bluebonnet
    let s = await frames(page, 12);
    expect(s.bumperHits).toBe(1);
    expect(s.score).toBe(100);
    expect(s.ball.vy).toBeLessThan(0);    // kicked away
    for (const cx of [120, 170, 220, 270]) { await place(page, cx, 84, 0, 200); await frames(page, 6); }
    s = await P(page);
    expect(s.mult).toBe(2);
    expect(s.lanes).toEqual([false, false, false, false]);
    expect(s.score).toBe(100 + 4 * 50 + 1000);  // the completing bonus is already doubled
    await expect(page.getByTestId('status')).toContainText('multiplier 2×');
    // lane change: the flippers shift lit lanes (rollovers ignore a re-trigger within 0.4 s, so wait that out first)
    await frames(page, 30);
    await place(page, 120, 84, 0, 200); await frames(page, 6);
    expect((await P(page)).lanes).toEqual([true, false, false, false]);
    await page.keyboard.down('z'); await page.keyboard.up('z');
    expect((await P(page)).lanes).toEqual([false, false, false, true]);
    // windmill spinner in the right lane
    const before = (await P(page)).score;
    await place(page, 338, 380, 0, -1100);
    s = await frames(page, 90);
    expect(s.spins).toBeGreaterThan(3);
    expect(s.score).toBeGreaterThanOrEqual(before + s.spins * 25 * 2);
    // Cattle Drive ramp: up through the entrance channel
    await place(page, 80, 380, -40, -1100);
    s = await frames(page, 8);
    expect(s.ramps).toBe(1);
    expect(s.ball.hidden).toBe(true);
    s = await frames(page, 60);
    expect(s.ball.hidden).toBe(false);
    await expect(page.getByTestId('status')).toContainText('Cattle Drive ramp!');
  });

  test('ball save, drains, tilt and game over', async ({ page }) => {
    test.setTimeout(60_000);
    await start(page);
    await plunge(page, 30);
    await frames(page, 30);
    await place(page, 180, 700, 0, 400);             // straight down the middle while ball save is lit
    let s = await frames(page, 10);
    expect(s.saves).toBe(1);
    expect(s.balls).toBe(3);
    expect(s.ball.inLane).toBe(true);
    await expect(page.getByTestId('status')).toContainText('Ball saved');
    // tilt: three quick nudges
    await plunge(page, 30); await frames(page, 40);
    await page.keyboard.press('n'); await page.keyboard.press('n');
    await expect(page.getByTestId('status')).toContainText('Danger');
    await page.keyboard.press('n');
    s = await P(page);
    expect(s.tilted).toBe(true);
    await page.keyboard.down('z');
    expect((await frames(page, 6)).flippers[0].ang).toBeCloseTo(0.52, 5);   // dead flippers
    await page.keyboard.up('z');
    await page.evaluate(() => (window as any).__pinball.set({ save: 0 }));
    await place(page, 180, 700, 0, 400);
    s = await frames(page, 10);
    expect(s.balls).toBe(2);
    expect(s.tilted).toBe(false);
    await expect(page.getByTestId('status')).toContainText('Ball 2 of 3');
    for (let i = 0; i < 2; i++) { await plunge(page, 30); await frames(page, 30); await page.evaluate(() => (window as any).__pinball.set({ save: 0 })); await place(page, 180, 700, 0, 400); await frames(page, 10); }
    s = await P(page);
    expect(s.mode).toBe('over');
    await expect(page.getByTestId('gameover')).toBeVisible();
    await expect(page.getByTestId('final-score')).toHaveText(s.score.toLocaleString('en-US'));
    await page.getByTestId('again').click();
    expect((await P(page)).balls).toBe(3);
  });
});
