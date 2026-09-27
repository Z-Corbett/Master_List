import { test, expect, Page } from '@playwright/test';

const URL = '/lab/145-stockyards-drive.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__drive.state);
const C = (page: Page) => page.evaluate(() => (window as any).__drive.consts);
const lab = (page: Page, herd: any[], opts: any) => page.evaluate(([h, o]) => (window as any).__drive.lab(h, o), [herd, opts] as const);
const frames = (page: Page, n: number) => page.evaluate((k) => (window as any).__drive.frames(k), n);
const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);

/** Start a drive and switch the loop to manual stepping, so nothing moves until the test calls frames(). */
async function begin(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => (window as any).__drive.manual(true));
  await page.getByTestId('start').click();
  expect((await S(page)).frame).toBe(0);
}

test.describe('145 Stockyards Drive', () => {
  test('flight zone: a lone steer moves directly away from an approaching rider, and ignores one outside the zone', async ({ page }) => {
    await page.goto(URL);
    const c = await C(page);
    // rider walks east toward a steer standing 100 px ahead of it
    const r = await lab(page, [{ x: 400, y: 270 }], { rules: { flee: true }, rider: { x: 300, y: 270, vx: 60, vy: 0 }, steps: 60 });
    const first = r.trace[1][0], last = r.trace.at(-1)[0];
    expect(first.vx).toBeGreaterThan(0);
    expect(last.x).toBeGreaterThan(400 + 20);
    expect(last.y).toBeCloseTo(270, 9);                         // straight away: no sideways drift
    // the push falls off linearly with distance: (1 − d/R)·k, pointing from the rider to the steer
    // rider 30 px west and 40 px north: d = 50, so the push is (1 − 50/R)·k along (0.6, 0.8)
    const one = await lab(page, [{ x: 400, y: 270 }], { rules: { flee: true }, rider: { x: 370, y: 230 }, steps: 0 });
    const k = (1 - 50 / c.P.FLEE_R) * c.P.W.flee;
    expect(one.forces[0].flee[0]).toBeCloseTo(0.6 * k, 9);
    expect(one.forces[0].flee[1]).toBeCloseTo(0.8 * k, 9);
    // a rider standing 200 px off does nothing
    const far = await lab(page, [{ x: 400, y: 270 }], { rules: { flee: true, sep: true, ali: true, coh: true }, rider: { x: 200, y: 270 }, steps: 30 });
    expect(far.trace.at(-1)[0]).toMatchObject({ x: 400, y: 270, vx: 0, vy: 0 });
  });

  test('separation: two overlapping steers push apart symmetrically; two a body length apart stay put', async ({ page }) => {
    await page.goto(URL);
    const c = await C(page);
    const r = await lab(page, [{ x: 400, y: 270 }, { x: 408, y: 270 }], { rules: { sep: true }, steps: 90 });
    const [a0, b0] = r.trace[0], [a, b] = r.trace.at(-1);
    expect(dist(a0, b0)).toBe(8);
    expect(dist(a, b)).toBeGreaterThan(dist(a0, b0) + 10);
    expect(a.x).toBeLessThan(400); expect(b.x).toBeGreaterThan(408);
    expect((a.x + b.x) / 2).toBeCloseTo(404, 6);                 // equal and opposite pushes: the midpoint doesn't move
    // exactly on top of each other: still separates (a deterministic tie-break direction)
    const same = await lab(page, [{ x: 400, y: 270 }, { x: 400, y: 270 }], { rules: { sep: true }, steps: 60 });
    expect(dist(same.trace.at(-1)[0], same.trace.at(-1)[1])).toBeGreaterThan(10);
    const apart = await lab(page, [{ x: 400, y: 270 }, { x: 400 + c.P.SEP + 2, y: 270 }], { rules: { sep: true }, steps: 30 });
    expect(apart.trace.at(-1)[0].x).toBe(400);
    expect(apart.trace.at(-1)[1].x).toBe(400 + c.P.SEP + 2);
  });

  test('alignment: neighbours heading east and south turn toward their shared heading, south-east', async ({ page }) => {
    await page.goto(URL);
    const angle = (s: any) => (Math.atan2(s.vy, s.vx) * 180) / Math.PI;
    const r = await lab(page, [{ x: 400, y: 250, vx: 40, vy: 0 }, { x: 400, y: 290, vx: 0, vy: 40 }], { rules: { ali: true }, steps: 90 });
    const [a0, b0] = r.trace[0], [a, b] = r.trace.at(-1);
    expect(Math.abs(angle(a0) - angle(b0))).toBe(90);
    expect(Math.abs(angle(a) - angle(b))).toBeLessThan(3);
    // alignment only trades velocity between the pair, so their shared heading stays exactly 45°
    expect(angle({ vx: a.vx + b.vx, vy: a.vy + b.vy })).toBeCloseTo(45, 9);
    for (const s of [a, b]) expect(Math.abs(angle(s) - 45)).toBeLessThan(2);
    // a steer with no neighbour within range keeps its own heading
    const lone = await lab(page, [{ x: 100, y: 250, vx: 40, vy: 0 }, { x: 400, y: 290, vx: 0, vy: 40 }], { rules: { ali: true }, steps: 30 });
    expect(lone.trace.at(-1)[0].vy).toBe(0);
  });

  test('cohesion: steers within sight of each other close up; beyond sight range they don\'t', async ({ page }) => {
    await page.goto(URL);
    const c = await C(page);
    const near = await lab(page, [{ x: 400, y: 270 }, { x: 460, y: 270 }], { rules: { coh: true }, steps: 30 });
    expect(dist(near.trace.at(-1)[0], near.trace.at(-1)[1])).toBeLessThan(60 - 10);
    expect(near.forces[0].coh[0]).toBeGreaterThan(0);                      // pulled toward the other
    const far = await lab(page, [{ x: 400, y: 270 }, { x: 400 + c.P.R + 5, y: 270 }], { rules: { coh: true }, steps: 30 });
    expect(dist(far.trace.at(-1)[0], far.trace.at(-1)[1])).toBe(c.P.R + 5);
  });

  test('spawns are seeded: the same seed gives the same herd, other seeds differ, and every steer starts on the street', async ({ page }) => {
    await page.goto(URL);
    const c = await C(page);
    const [a, b, others] = await page.evaluate(() => { const d = (window as any).__drive; return [d.spawn(7), d.spawn(7), [1, 2, 3, 4].map((k) => JSON.stringify(d.spawn(k)))]; });
    expect(a).toEqual(b);
    expect(a).toHaveLength(c.N);
    expect(new Set([JSON.stringify(a), ...others]).size).toBe(5);
    for (const s of a) {
      expect(s.y).toBeGreaterThan(c.TOP); expect(s.y).toBeLessThan(c.BOT);
      expect(s.x).toBeLessThan(c.PEN_X / 2);
    }
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(dist(a[i], a[j])).toBeGreaterThan(c.P.SEP);
    expect((await S(page)).herd).toEqual(a);
    await expect(page.getByTestId('seed')).toHaveText('seed 7');
  });

  test('a whole drive is deterministic: same seed and same inputs give the identical herd, frame for frame', async ({ page }) => {
    const run = async () => {
      await begin(page);
      await page.keyboard.down('ArrowRight');
      await frames(page, 240);
      await page.keyboard.up('ArrowRight');
      await page.keyboard.down('ArrowDown');
      await frames(page, 30);
      await page.keyboard.up('ArrowDown');
      await page.keyboard.down('ArrowRight');
      await frames(page, 300);
      await page.keyboard.up('ArrowRight');
      return S(page);
    };
    const one = await run();
    const two = await run();
    expect(one.frame).toBe(570);
    expect(two.frame).toBe(570);
    expect(two.herd).toEqual(one.herd);
    expect(two.rider).toEqual(one.rider);
    const meanX = (h: any[]) => h.reduce((a, s) => a + s.x, 0) / h.length;
    const start = await page.evaluate(() => (window as any).__drive.spawn(7));
    expect(meanX(one.herd)).toBeGreaterThan(meanX(start) + 25);            // riding east pushed the herd east (a fast rider splits it, too)
  });

  test('walls hold the herd: a steer shoved at a building front stays on the street, one shoved into an alley mouth goes in', async ({ page }) => {
    await begin(page);
    const c = await C(page);
    await page.evaluate(() => (window as any).__drive.rider(900, 350));
    // rebuild a two-steer herd directly under the north wall: one under brick, one under the first alley
    await page.evaluate(([top, gx]) => {
      const d = (window as any).__drive;
      const mk = (id: number, x: number) => ({ id, x, y: top + 4, vx: 0, vy: -90, status: 'street', alley: null, horn: 1, coat: 0 });
      d.set({ herd: [mk(0, 200), mk(1, gx)] });
    }, [c.TOP, (c.GAPS.top[0][0] + c.GAPS.top[0][1]) / 2]);
    const s = await frames(page, 30);
    expect(s.herd[0].y).toBeGreaterThanOrEqual(c.TOP);
    expect(s.herd[0].alley).toBe(null);
    expect(s.herd[1].y).toBeLessThan(c.TOP);
    expect(s.herd[1].alley).toBe('top');
    expect(s.herd[1].x).toBeGreaterThan(c.GAPS.top[0][0]);
    expect(s.herd[1].x).toBeLessThan(c.GAPS.top[0][1]);
  });

  test('pen counting: a steer through the gate is penned once, an alley runaway is a stray, and the score follows', async ({ page }) => {
    await begin(page);
    const c = await C(page);
    await page.evaluate(() => (window as any).__drive.rider(20, 200));
    await page.evaluate(([x]) => (window as any).__drive.place(0, x, 270, 40, 0), [c.PEN_X + 1]);
    let s = await frames(page, 1);
    expect(s.penned).toBe(1);
    expect(s.herd[0].status).toBe('penned');
    expect(s.score).toBe(100);
    await frames(page, 30);
    expect((await S(page)).penned).toBe(1);                                  // counted once, not every frame
    // a steer deep in an alley and still running is lost
    const gx = (c.GAPS.bot[0][0] + c.GAPS.bot[0][1]) / 2;
    await page.evaluate(([x, y]) => { const d = (window as any).__drive; d.place(1, x, y, 0, 60); d.rider(x, y - 8); }, [gx, c.BOT - 2]);
    s = await frames(page, 150);
    expect(s.herd[1].status).toBe('lost');
    expect(s.lost).toBe(1);
    expect(s.score).toBe(100 - 25);
    await expect(page.getByTestId('penned')).toHaveText('1');
    await expect(page.getByTestId('lost')).toHaveText('1');
    await expect(page.getByTestId('score')).toHaveText('75');
    expect(s.events.map((e: any) => e.kind)).toEqual(['penned', 'lost']);
    await expect(page.getByTestId('status')).toContainText('south alley');
  });

  test('game over when the last steer is accounted for, with 5 points per whole second left', async ({ page }) => {
    await begin(page);
    const c = await C(page);
    await frames(page, 600);                                                   // ten seconds of sim time
    const before = await S(page);
    const onStreet = before.herd.filter((h: any) => h.status === 'street').map((h: any) => h.id);
    await page.evaluate(([ids, x]) => { const d = (window as any).__drive; (ids as number[]).forEach((i, k) => d.place(i, (x as number) + 1, 190 + k * 12, 10, 0)); }, [onStreet, c.PEN_X]);
    const s = await frames(page, 1);
    expect(s.mode).toBe('over');
    expect(s.reason).toBe('done');
    const left = c.TIME - s.t;
    expect(s.bonus).toBe(5 * Math.floor(left + 1e-9));
    expect(s.score).toBe(100 * s.penned - 25 * s.lost + s.bonus);
    expect(s.penned + s.lost).toBe(c.N);
    await expect(page.getByTestId('over')).toBeVisible();
    await expect(page.getByTestId('final-score')).toHaveText(String(s.score));
    await expect(page.getByTestId('again')).toBeFocused();
    // frames() does nothing after the drive ends
    expect((await frames(page, 60)).frame).toBe(s.frame);
    await page.getByTestId('again').click();
    expect((await S(page)).mode).toBe('play');
    await expect(page.getByTestId('street')).toBeFocused();
  });

  test('game over when the two-minute clock runs out, with no time bonus', async ({ page }) => {
    await begin(page);
    const c = await C(page);
    const last = Math.round(c.TIME / c.DT) - 1;
    await page.evaluate((f) => (window as any).__drive.set({ frame: f, t: f / 60 }), last);
    await expect(page.getByTestId('time')).toHaveText('0:01');
    const s = await frames(page, 1);
    expect(s.mode).toBe('over');
    expect(s.reason).toBe('time');
    expect(s.bonus).toBe(0);
    expect(s.t).toBeCloseTo(120, 9);
    await expect(page.getByTestId('time')).toHaveText('0:00');
    await expect(page.getByTestId('over-line')).toContainText('still on the street');
  });

  test('the real loop runs on a fixed 1/60 s step under page.clock, and manual mode freezes it', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-26T15:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-26T15:00:02Z'));
    await page.getByTestId('start').click();
    const t0 = (await S(page)).t;
    await page.clock.runFor(2000);
    const s = await S(page);
    expect(s.t - t0).toBeGreaterThan(1.9);
    expect(s.t - t0).toBeLessThan(2.1);
    expect(s.frame / 60).toBeCloseTo(s.t, 9);                                // time is counted in whole fixed steps
    await expect(page.getByTestId('time')).toHaveText(/^1:5[78]$/);
    await page.evaluate(() => (window as any).__drive.manual(true));
    const f = (await S(page)).frame;
    await page.clock.runFor(1000);
    expect((await S(page)).frame).toBe(f);
  });

  test('pointer and keyboard both ride: tap a spot and the rider goes there; arrows move at a fixed speed', async ({ page }) => {
    await begin(page);
    const c = await C(page);
    await expect(page.getByTestId('street')).toBeFocused();
    const box = (await page.getByTestId('street').boundingBox())!;
    await page.getByTestId('street').click({ position: { x: (300 / c.W) * box.width, y: (220 / c.H) * box.height } });
    let s = await S(page);
    expect(s.target.x).toBeCloseTo(300, -1);
    expect(s.target.y).toBeCloseTo(220, -1);
    s = await frames(page, 180);
    expect(s.rider.x).toBeCloseTo(300, -1);
    expect(s.rider.y).toBeCloseTo(220, -1);
    const x0 = s.rider.x;
    await page.keyboard.down('ArrowRight');
    s = await frames(page, 30);
    await page.keyboard.up('ArrowRight');
    expect(s.rider.x - x0).toBeCloseTo(c.P.RIDER_V * 0.5, 6);                // 150 px/s for half a second
    await page.keyboard.down('w');
    s = await frames(page, 600);
    await page.keyboard.up('w');
    expect(s.rider.y).toBe(c.TOP + 8);                                         // the rider stays on the street
  });
});
