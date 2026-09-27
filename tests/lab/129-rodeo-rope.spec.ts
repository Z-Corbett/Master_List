import { test, expect, Page } from '@playwright/test';

const URL = '/lab/129-rodeo-rope.html';
type Pt = [number, number];
const S = (page: Page) => page.evaluate(() => (window as any).__rodeo.state);
const step = (page: Page, n: number) => page.evaluate((n) => (window as any).__rodeo.step(n), n);

/** Open with the physics under the test's control and the clock started. */
async function open(page: Page, query = '?seed=7') {
  await page.goto(URL + query);
  await page.evaluate(() => (window as any).__rodeo.manual(true));
  await page.getByTestId('start').click();
  await expect(page.getByTestId('ready')).toBeHidden();
}
/** One scripted throw, entirely inside the page so it runs on exact physics steps: aim, hold Space for `swing` steps, release. */
function throwOnce(page: Page, aimDeg: number, swing: number) {
  return page.evaluate(([a, n]) => {
    const R = (window as any).__rodeo, cv = document.getElementById('field')!;
    R.aim(a);
    cv.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    R.step(n);
    cv.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    let s = R.step(1);
    for (let i = 0; i < 600 && s.rope.state === 'flight'; i++) s = R.step(1);
    return s;
  }, [aimDeg, swing] as const);
}
/** Worst relative error of any link against its rest length. */
function linkError(s: any) {
  const P: Pt[] = s.rope.points;
  return Math.max(...s.rope.cons.map(([a, b]: number[]) => Math.abs(Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]) - s.rope.L) / s.rope.L));
}
/** Winding number, a different algorithm from the page's even-odd ray cast. */
function inside(pt: Pt, poly: Pt[]) {
  let w = 0;
  const isLeft = (a: Pt, b: Pt, p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a[1] <= pt[1]) { if (b[1] > pt[1] && isLeft(a, b, pt) > 0) w++; }
    else if (b[1] <= pt[1] && isLeft(a, b, pt) < 0) w--;
  }
  return w !== 0;
}
const centroid = (pts: Pt[]): Pt => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
/** Put calf i so that its head (15 px ahead of the body, along its heading) is at `head`; park the others in a far corner. */
async function stage(page: Page, i: number, head: Pt, n: number) {
  await page.evaluate(([i, hx, hy, n]) => {
    const R = (window as any).__rodeo;
    R.freeze(true);
    for (let k = 0; k < n; k++) if (k !== i) R.placeCalf(k, 60 + 12 * k, 290, 0);
    R.placeCalf(i, hx, hy + 15, -Math.PI / 2);                    // facing north: head 15 px above the body
  }, [i, head[0], head[1], n] as const);
}

test.describe('129 Rodeo Rope', () => {
  test('the rope is a chain of equal links whose loop closes into a ring of the right radius', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    for (const [diff, K] of [['medium', 16], ['easy', 20], ['hard', 13]] as const) {
      if (diff !== 'medium') await page.getByTestId('difficulty').selectOption(diff);
      const s = await S(page);
      expect(s.rope.K).toBe(K);
      expect(s.rope.points).toHaveLength(14 + K);
      expect(s.rope.cons).toHaveLength(14 + K);                      // 13 stem links, the join, K − 1 loop links, the honda
      expect(s.rope.cons.at(-1)).toEqual([14 + K - 1, 14]);
      expect(s.rope.R).toBeCloseTo(s.rope.L / (2 * Math.sin(Math.PI / K)), 9);   // a regular K-gon of side L
      expect(linkError(s)).toBeLessThan(0.01);
      const loop: Pt[] = s.rope.points.slice(14), c = centroid(loop);
      for (const p of loop) expect(Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - s.rope.R) / s.rope.R).toBeLessThan(0.03);
    }
  });

  test('link lengths stay within 2% through a swing, a throw and the landing', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__rodeo.aim(-80));
    await page.getByTestId('field').focus();
    await page.keyboard.down(' ');
    const worst: number[] = [];
    for (let i = 0; i < 12; i++) { const s = await step(page, 20); expect(s.rope.state).toBe('swing'); worst.push(linkError(s)); }
    await page.keyboard.up(' ');
    let s = await S(page);
    expect(s.rope.state).toBe('flight');
    for (let i = 0; i < 30 && s.rope.state === 'flight'; i++) { s = await step(page, 10); worst.push(linkError(s)); }
    expect(s.rope.state).toBe('down');
    expect(Math.max(...worst)).toBeLessThan(0.02);
    expect(s.throws).toBe(1);
    // the whole rope keeps its length: 29 or so links of L, never stretched
    const P: Pt[] = s.rope.points;
    const total = s.rope.cons.reduce((a: number, [i, j]: number[]) => a + Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]), 0);
    expect(Math.abs(total - s.rope.cons.length * s.rope.L)).toBeLessThan(0.02 * s.rope.cons.length * s.rope.L);
  });

  test('fixed timestep: every step is 1/120 s and the same seed and inputs give the same world', async ({ page }) => {
    const run = async (q: string) => {
      await open(page, q);
      await step(page, 90);
      const a = await throwOnce(page, -60, 150);
      await step(page, 200);
      const b = await S(page);
      return { a, b };
    };
    const one = await run('?seed=7');
    expect(one.b.dt).toBeCloseTo(1 / 120, 12);
    expect(one.b.t).toBeCloseTo(one.b.steps / 120, 9);
    const two = await run('?seed=7');
    expect(two.b).toEqual(one.b);                                    // bit-for-bit: rope, calves, log
    const other = await run('?seed=8');
    expect(other.b.calves).not.toEqual(one.b.calves);
    expect(other.b.rope.points).toEqual(one.b.rope.points);          // the rope ignores the herd; only the calves differ
    await expect(page.getByTestId('seed')).toHaveText('seed 8');
  });

  test('catch geometry: the page agrees with an independent winding-number test on a thrown, deformed loop', async ({ page }) => {
    await open(page);
    const s = await throwOnce(page, -100, 120);
    const loop: Pt[] = s.rope.points.slice(s.rope.stem);
    const c = centroid(loop);
    const pts: Pt[] = [];
    for (let dx = -40; dx <= 40; dx += 4) for (let dy = -40; dy <= 40; dy += 4) pts.push([c[0] + dx + 0.37, c[1] + dy + 0.11]);
    const page_ = await page.evaluate((pts) => pts.map((p) => (window as any).__rodeo.pointInLoop(p)), pts);
    const mine = pts.map((p) => inside(p, loop));
    expect(page_).toEqual(mine);
    expect(mine.filter(Boolean).length).toBeGreaterThan(50);          // both inside and outside were sampled
    expect(mine.filter((x) => !x).length).toBeGreaterThan(50);
    // and on a concave star, where a naive convex test would be wrong
    const star: Pt[] = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 12 : 40, a = (i * Math.PI) / 5; return [100 + r * Math.cos(a), 100 + r * Math.sin(a)]; });
    const probes: Pt[] = [[100, 100], [135, 100], [100 + 20 * Math.cos(Math.PI / 5), 100 + 20 * Math.sin(Math.PI / 5)], [128.1, 120.3], [60.5, 99.2], [100, 145]];
    const got = await page.evaluate(([pr, st]) => pr.map((p) => (window as any).__rodeo.pointInPoly(p, st)), [probes, star] as const);
    expect(got).toEqual(probes.map((p) => inside(p, star)));
    expect(got.slice(0, 3)).toEqual([true, true, false]);
  });

  test('a calf whose head is inside the landed loop is caught and scored; replayed throws land identically', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__rodeo.freeze(true));
    const dry = await throwOnce(page, -75, 160);
    expect(dry.log[0].caught).toBe(null);
    const spot: Pt = dry.log[0].loopCentroid;
    // same seed, same throw, but a calf waits where the loop will land
    await open(page);
    await stage(page, 2, spot, 5);
    const s = await throwOnce(page, -75, 160);
    const e = s.log[0];
    expect(e.loopCentroid).toEqual(spot);
    expect(inside(e.head, e.loop)).toBe(true);
    expect(e.caught).toBe(2);
    const dist = Math.hypot(e.head[0] - s.cowboy[0], e.head[1] - s.cowboy[1]);
    expect(s.score).toBe(150 + Math.round(dist / 10));
    await expect(page.getByTestId('score')).toHaveText(String(s.score));
    await expect(page.getByTestId('catches')).toHaveText('1');
    await expect(page.getByTestId('status')).toContainText('Caught calf 3!');
  });

  test('a head just outside the loop is a miss, even with the body under the rope', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__rodeo.freeze(true));
    const dry = await throwOnce(page, -75, 160);
    const loop: Pt[] = dry.log[0].loop, c: Pt = dry.log[0].loopCentroid;
    const R = Math.max(...loop.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    const head: Pt = [c[0], c[1] - R - 6];                            // just beyond the far edge; the body (15 px behind) is inside
    expect(inside(head, loop)).toBe(false);
    expect(inside([head[0], head[1] + 15], loop)).toBe(true);
    await open(page);
    await stage(page, 0, head, 5);
    const s = await throwOnce(page, -75, 160);
    expect(s.log[0].caught).toBe(null);
    expect(s.score).toBe(0);
    expect(s.streak).toBe(0);
    await expect(page.getByTestId('status')).toContainText('Missed');
  });

  test('scoring: base plus distance, and from the third catch in a row each one scores double', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__rodeo.freeze(true));
    const spot: Pt = (await throwOnce(page, -90, 180)).log[0].loopCentroid;
    await open(page);
    let want = 0;
    for (let k = 0; k < 4; k++) {
      await stage(page, k, spot, 5);
      await step(page, 1);
      const s = await throwOnce(page, -90, 180);
      const e = s.log.at(-1);
      expect(e.caught, `throw ${k + 1}`).toBe(k);
      const pts = (150 + Math.round(Math.hypot(e.head[0] - 360, e.head[1] - 418) / 10)) * (k + 1 >= 3 ? 2 : 1);
      expect(e.points).toBe(pts);
      want += pts;
      expect(s.score).toBe(want);
      expect(s.streak).toBe(k + 1);
      await step(page, 90);                                              // the rope comes back to hand
      expect((await S(page)).rope.state).toBe('coiled');
    }
    await expect(page.getByTestId('streak')).toHaveText('4');
    await expect(page.getByTestId('status')).toContainText('double points');
  });

  test('the clock runs 60 seconds of physics, then the game is over', async ({ page }) => {
    await open(page);
    await step(page, 120 * 30);
    await expect(page.getByTestId('time')).toHaveText('30.0');
    await page.getByTestId('field').focus();
    await page.keyboard.down(' ');                                       // caught mid-swing by the buzzer
    let s = await step(page, 120 * 30 - 1);
    expect(s.mode).toBe('play');
    s = await step(page, 1);
    expect(s.mode).toBe('over');
    expect(s.steps).toBe(7200);
    await page.keyboard.up(' ');
    s = await step(page, 50);
    expect(s.steps).toBe(7200);                                          // nothing moves after the buzzer
    expect(s.throws).toBe(0);
    await expect(page.getByTestId('over')).toBeVisible();
    await expect(page.getByTestId('time')).toHaveText('0.0');
    await expect(page.getByTestId('final-score')).toHaveText('0');
    await expect(page.getByTestId('again')).toBeFocused();
    await page.getByTestId('again').click();
    s = await S(page);
    expect(s.mode).toBe('play');
    expect(s.steps).toBe(0);
    await expect(page.getByTestId('field')).toBeFocused();
  });

  test('in real time the loop takes exactly 120 fixed steps per second of page.clock', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-26T15:00:00Z') });
    await page.goto(URL + '?seed=7');
    await page.clock.pauseAt(new Date('2026-09-26T15:00:10Z'));
    await page.getByTestId('start').click();
    await page.clock.runFor(1000);
    const s = await S(page);
    expect(s.steps).toBeGreaterThanOrEqual(118);
    expect(s.steps).toBeLessThanOrEqual(121);
    await page.clock.runFor(4000);
    const s2 = await S(page);
    expect(s2.steps - s.steps).toBeGreaterThanOrEqual(478);
    expect(s2.steps - s.steps).toBeLessThanOrEqual(482);
    expect(s2.t).toBeCloseTo(s2.steps / 120, 9);
    await expect(page.getByTestId('time')).toHaveText(((7200 - s2.steps) / 120).toFixed(1));
  });

  test('pointer drag: press to swing, drag to aim, release to throw along the aim', async ({ page }) => {
    await open(page);
    const box = (await page.getByTestId('field').boundingBox())!;
    const at = (x: number, y: number) => [box.x + (x * box.width) / 720, box.y + (y * box.height) / 460] as const;
    await page.mouse.move(...at(360, 200));
    await page.mouse.down();
    let s = await step(page, 60);
    expect(s.rope.state).toBe('swing');
    expect(s.aim).toBeCloseTo(-Math.PI / 2, 2);
    await page.mouse.move(...at(560, 218));                              // 45° up and to the right of the cowboy at (360, 418)
    s = await step(page, 120);
    expect(s.aim).toBeCloseTo(-Math.PI / 4, 2);
    expect(s.rope.charge).toBe(1);
    const before: Pt = centroid(s.rope.points.slice(s.rope.stem));
    await page.mouse.up();
    s = await S(page);
    expect(s.rope.state).toBe('flight');
    for (let i = 0; i < 40 && s.rope.state === 'flight'; i++) s = await step(page, 10);
    const after: Pt = s.log[0].loopCentroid;
    const dir = Math.atan2(after[1] - before[1], after[0] - before[0]);
    expect(Math.abs(dir - -Math.PI / 4)).toBeLessThan(0.15);              // the loop flew along the aim
    expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeGreaterThan(250);   // full-power throw
    await expect(page.getByTestId('throws')).toHaveText('1');
  });

  test('keyboard: arrows aim in 5° steps within limits, Space swings and throws', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('field')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    let s = await S(page);
    expect(s.aim).toBeCloseTo(-Math.PI / 2 + (2 * Math.PI) / 36, 9);
    await expect(page.getByTestId('status')).toHaveText('Aim 80°');
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
    expect((await S(page)).aim).toBeCloseTo(-Math.PI / 12, 9);           // never lower than 15° above the ground line
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
    expect((await S(page)).aim).toBeCloseTo((-11 * Math.PI) / 12, 9);
    await page.keyboard.down(' ');
    s = await step(page, 90);
    expect(s.rope.state).toBe('swing');
    expect(s.rope.charge).toBeCloseTo(90 / 120 / 1.5, 9);
    await page.keyboard.up(' ');
    expect((await S(page)).rope.state).toBe('flight');
  });

  test('difficulty sets the herd, the loop and the points; seeds reshuffle the herd', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    const med = await S(page);
    expect(med.calves).toHaveLength(5);
    expect(med.base).toBe(150);
    await page.getByTestId('difficulty').selectOption('hard');
    let s = await S(page);
    expect([s.calves.length, s.rope.K, s.base]).toEqual([6, 13, 200]);
    await page.getByTestId('difficulty').selectOption('easy');
    s = await S(page);
    expect([s.calves.length, s.rope.K, s.base]).toEqual([4, 20, 100]);
    // calves wander inside the fence, faster on hard
    await page.getByTestId('difficulty').selectOption('hard');
    await page.evaluate(() => (window as any).__rodeo.manual(true));
    await page.getByTestId('start').click();
    const a = await S(page);
    const b = await step(page, 1200);
    for (const c of b.calves) { expect(c.x).toBeGreaterThanOrEqual(40); expect(c.x).toBeLessThanOrEqual(680); expect(c.y).toBeGreaterThanOrEqual(36); expect(c.y).toBeLessThanOrEqual(300); }
    expect(b.calves.some((c: any, i: number) => Math.hypot(c.x - a.calves[i].x, c.y - a.calves[i].y) > 50)).toBe(true);
    await page.getByTestId('reseed').click();
    const seed = (await S(page)).seed;
    expect(page.url()).toContain(`seed=${seed}`);
    await expect(page.getByTestId('ready')).toBeVisible();
  });
});
