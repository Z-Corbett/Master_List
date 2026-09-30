import { test, expect, Page } from '@playwright/test';

const URL = '/lab/176-high-five.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__five.state);
const frames = (page: Page, n: number) => page.evaluate((n) => (window as any).__five.frames(n), n);
const toSeg = (page: Page, i: number) => page.evaluate((i) => (window as any).__five.toSeg(i), i);
const hook = (page: Page) => page.evaluate(() => {
  const f = (window as any).__five;
  return { splits: f.splits, FINISH: f.FINISH, SEG: f.SEG, MAX_SPEED: f.MAX_SPEED, PENALTY: f.PENALTY };
});

/** Start with the real-time loop detached, so every 1/120 s step is driven by the test. */
async function start(page: Page, url = URL, traffic = false) {
  await page.goto(url);
  await page.evaluate(() => (window as any).__five.manual(true));
  await page.getByTestId('start').click();
  await expect(page.getByTestId('ready')).toBeHidden();
  await expect(page.getByTestId('scene')).toBeFocused();   // focus never stays on the vanished Start button
  if (!traffic) await page.evaluate(() => (window as any).__five.clearTraffic());
  expect((await S(page)).mode).toBe('run');
}
/** Change lanes with the real arrow keys until the target lane is selected. */
async function laneTo(page: Page, lane: number) {
  let s = await S(page);
  while (s.lane !== lane) { await page.keyboard.press(s.lane < lane ? 'ArrowRight' : 'ArrowLeft'); s = await S(page); }
  return frames(page, 40);                                   // let the truck slide over
}

test.describe('176 High Five', () => {
  test('the route and the traffic are seeded', async ({ page }) => {
    await start(page, URL, true);
    const h = await hook(page);
    expect(h.splits).toHaveLength(4);
    for (const sp of h.splits) {
      // the two signs split the three lanes between them, with no gaps and no overlap
      expect([...sp.left.lanes, ...sp.right.lanes]).toEqual([0, 1, 2]);
      expect(sp.left.dest).not.toBe(sp.right.dest);
      expect(sp.gantry).toBeLessThan(sp.gore - 40);
    }
    expect(new Set(h.splits.map((s: any) => s.want.dest)).size).toBe(4);
    const a = await frames(page, 600);
    await start(page, URL, true);
    const b = await frames(page, 600);
    expect(b.cars).toEqual(a.cars);
    expect((await hook(page)).splits).toEqual(h.splits);
    const routes = new Set<string>();
    for (const seed of [1, 2, 3, 4]) {
      await page.goto(`/lab/176-high-five.html?seed=${seed}`);
      const o = await hook(page);
      routes.add(JSON.stringify(o.splits.map((s: any) => [s.want.dest, s.left.lanes])));
    }
    expect(routes.size).toBeGreaterThan(1);
  });

  test('cruise control holds 70 mph and the brakes work from keys, button and touch', async ({ page }) => {
    await start(page);
    const h = await hook(page);
    let s = await frames(page, 120 * 8);
    expect(s.speed).toBe(h.MAX_SPEED);
    await expect(page.getByTestId('mph')).toHaveText('70 mph');
    await page.keyboard.down('ArrowDown');
    s = await frames(page, 60);                              // half a second at 7000 u/s²
    expect(s.braking).toBe(true);
    expect(s.speed).toBeCloseTo(h.MAX_SPEED - 3500, 0);
    await page.keyboard.up('ArrowDown');
    s = await frames(page, 1);
    expect(s.braking).toBe(false);
    expect(s.speed).toBeGreaterThan(h.MAX_SPEED - 3500);
    // the Brake button, held with a finger
    const brake = page.getByTestId('brake');
    await brake.dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch', bubbles: true });
    await expect(brake).toHaveAttribute('aria-pressed', 'true');
    s = await frames(page, 120);
    expect(s.speed).toBeLessThan(1000);
    await brake.dispatchEvent('pointerup', { pointerId: 3, pointerType: 'touch', bubbles: true });
    await expect(brake).toHaveAttribute('aria-pressed', 'false');
    // holding the middle of the road also brakes
    const scene = page.getByTestId('scene'), box = (await scene.boundingBox())!;
    const mid = { pointerId: 5, pointerType: 'touch', bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height * 0.7 };
    await frames(page, 240);
    await scene.dispatchEvent('pointerdown', mid);
    expect((await frames(page, 2)).braking).toBe(true);
    await scene.dispatchEvent('pointerup', mid);
    expect((await frames(page, 2)).braking).toBe(false);
  });

  test('lane changes from keys, buttons and touch, clamped at the barriers', async ({ page }) => {
    await start(page);
    let s = await S(page);
    expect(s.lane).toBe(1);
    await page.keyboard.press('ArrowLeft');
    s = await frames(page, 1);
    expect(s.lane).toBe(0);
    expect(s.x).toBeLessThan(0);
    expect(s.x).toBeGreaterThan(-2 / 3);                     // it slides, it doesn't teleport
    s = await frames(page, 40);
    expect(s.x).toBeCloseTo(-2 / 3, 6);
    await page.keyboard.press('ArrowLeft');                  // already against the barrier
    expect((await S(page)).lane).toBe(0);
    await page.keyboard.press('d');
    await page.keyboard.press('d');
    await page.keyboard.press('d');
    s = await frames(page, 60);
    expect(s.lane).toBe(2);
    expect(s.x).toBeCloseTo(2 / 3, 6);
    await page.getByTestId('left').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', bubbles: true });
    expect((await S(page)).lane).toBe(1);
    const scene = page.getByTestId('scene'), box = (await scene.boundingBox())!;
    const tap = (fx: number) => scene.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', bubbles: true, clientX: box.x + box.width * fx, clientY: box.y + box.height * 0.8 });
    await tap(0.9);
    expect((await S(page)).lane).toBe(2);
    await tap(0.1);
    await tap(0.1);
    expect((await S(page)).lane).toBe(0);
  });

  test('the right lanes at a split take you up a level', async ({ page }) => {
    await start(page);
    const h = await hook(page), sp = h.splits[0];
    await expect(page.getByTestId('route')).toContainText(sp.want.dest);
    await laneTo(page, sp.want.lanes[sp.want.lanes.length - 1]);
    let s = await toSeg(page, sp.gantry - 60);
    await expect(page.getByTestId('status')).toContainText(`Sign ahead: ${sp.left.dest}`);
    await expect(page.getByTestId('status')).toContainText(sp.right.dest);
    s = await toSeg(page, sp.gore + 1);
    expect(s.level).toBe(2);
    expect(s.split).toBe(1);
    expect(s.wrong).toBe(0);
    await expect(page.getByTestId('level')).toHaveText('2/5');
    await expect(page.getByTestId('status')).toHaveText(`Up to level 2: ${sp.want.dest}.`);
    await expect(page.getByTestId('route')).toContainText(h.splits[1].want.dest);
    await expect(page.locator('#levels li[data-level="2"]')).toHaveAttribute('aria-current', 'step');
  });

  test('the wrong ramp loops you back around with a time penalty', async ({ page }) => {
    await start(page);
    const h = await hook(page), sp = h.splits[1];
    // get through the first split properly
    await laneTo(page, h.splits[0].want.lanes[0]);
    await toSeg(page, h.splits[0].gore + 1);
    // now sit in a lane that goes the other way
    const wrongLane = [0, 1, 2].find((l) => !sp.want.lanes.includes(l))!;
    await laneTo(page, wrongLane);
    let s = await toSeg(page, sp.gore - 2);
    const t = s.t;
    s = await frames(page, 30);                              // over the gore
    expect(s.wrong).toBe(1);
    expect(s.level).toBe(2);
    expect(s.penalty).toBe(h.PENALTY);
    expect(s.seg).toBeLessThan(sp.gantry - 80);
    expect(s.total).toBeCloseTo(s.t + h.PENALTY, 4);
    expect(s.t).toBeCloseTo(t + 0.25, 4);
    await expect(page.getByTestId('status')).toContainText('Recalculating');
    await expect(page.getByTestId('time')).toHaveText(s.total.toFixed(1));
    // second time round, in the right lane
    await laneTo(page, sp.want.lanes[0]);
    s = await toSeg(page, sp.gore + 1);
    expect(s.level).toBe(3);
    expect(s.wrong).toBe(1);
  });

  test('running into slower traffic costs you speed; other lanes are fine', async ({ page }) => {
    await start(page);
    let s = await frames(page, 120 * 8);
    await page.evaluate(() => (window as any).__five.placeCar(0, 900, 2000, 'semi'));
    s = await frames(page, 30);
    expect(s.bumps).toBe(0);                                 // it's in the left lane, you're in the middle
    await page.evaluate(() => (window as any).__five.clearTraffic());
    await page.evaluate(() => (window as any).__five.placeCar(1, 900, 2000, 'pickup'));
    s = await frames(page, 30);
    expect(s.bumps).toBe(1);
    expect(s.speed).toBeLessThan(2000);
    await expect(page.getByTestId('status')).toHaveText('Bumped a pickup. Watch the lane ahead.');
    // the pickup was nudged ahead, so you don't hit it twice in one go
    const car = s.cars.find((c: any) => c.id === 999);
    expect(car.z - s.z).toBeGreaterThan(300);
  });

  test('the whole commute to the top connector, with the best time kept', async ({ page }) => {
    await start(page);
    const h = await hook(page);
    for (const sp of h.splits) {
      await laneTo(page, sp.want.lanes[0]);
      await toSeg(page, sp.gore + 1);
    }
    let s = await S(page);
    expect(s.level).toBe(5);
    s = await toSeg(page, h.FINISH);
    expect(s.mode).toBe('over');
    expect(s.wrong).toBe(0);
    await expect(page.getByTestId('result')).toBeVisible();
    await expect(page.getByTestId('result-time')).toHaveText(`${s.total.toFixed(1)} s`);
    await expect(page.getByTestId('result-text')).toContainText('No wrong ramps');
    await expect(page.getByTestId('again')).toBeFocused();
    await expect(page.getByTestId('route')).toHaveText('Stay on the top connector to the finish.');
    await page.reload();
    await expect(page.getByTestId('best')).toHaveText(s.total.toFixed(1));
  });

  test('pause freezes the road; reduced motion is respected', async ({ page }) => {
    await start(page);
    const s = await frames(page, 240);
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    const p = await frames(page, 240);
    expect(p.mode).toBe('paused');
    expect(p.pos).toBe(s.pos);
    expect(p.t).toBe(s.t);
    await page.keyboard.press('ArrowLeft');                  // no steering while paused
    expect((await S(page)).lane).toBe(1);
    await page.keyboard.press('p');
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'false');
    expect((await frames(page, 12)).pos).toBeGreaterThan(s.pos);
    expect(s.reduced).toBe(false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    expect((await S(page)).reduced).toBe(true);
  });
});
