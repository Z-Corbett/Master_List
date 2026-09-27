import { test, expect, Page } from '@playwright/test';

const URL = '/lab/147-river-walk-barge.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__barge.state);
const C = (page: Page) => page.evaluate(() => (window as any).__barge.consts);
const frames = (page: Page, n: number) => page.evaluate((k) => (window as any).__barge.frames(k), n);
const trace = (page: Page, n: number, ctl?: any) => page.evaluate(([k, c]) => (window as any).__barge.trace(k, c), [n, ctl] as const);
const input = (page: Page, o: any) => page.evaluate((c) => (window as any).__barge.input(c), o);
const place = (page: Page, o: any) => page.evaluate((b) => (window as any).__barge.place(b), o);

async function begin(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => (window as any).__barge.manual(true));
  await page.getByTestId('start').click();
  expect((await S(page)).frame).toBe(0);
}

// ---- independent geometry: ray-casting point-in-polygon, plus a boundary tolerance ----
function segDist(p: number[], a: number[], b: number[]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function inside(poly: number[][], p: number[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  if (c) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segDist(p, poly[j], poly[i]) < 1e-6) return true;
  return false;
}
/** Heading that points the bow along the channel at sample i (0 = north, clockwise positive). */
const alongChannel = (ch: any, i: number) => Math.atan2(ch.centre[i + 1][0] - ch.centre[i - 1][0], ch.centre[i - 1][1] - ch.centre[i + 1][1]);

test.describe('147 River Walk Barge', () => {
  test('the channel is seeded: a closed polygon of constant width with four landings on its banks', async ({ page }) => {
    await page.goto(URL);
    const c = await C(page);
    const [a, b, other] = await page.evaluate(() => { const g = (window as any).__barge; return [g.channel(7), g.channel(7), g.channel(8)]; });
    expect(a).toEqual(b);
    expect(JSON.stringify(other.centre)).not.toBe(JSON.stringify(a.centre));
    expect(a.polygon).toHaveLength(2 * a.centre.length);
    a.left.forEach((p: number[], i: number) => { expect(a.right[i][0] - p[0]).toBeCloseTo(2 * c.HW, 9); expect(a.right[i][1]).toBe(p[1]); });
    expect(a.centre.at(-1)[1]).toBe(-c.L);
    expect(Math.abs(a.centre[5][0])).toBeLessThan(2);                                   // the first stretch is nearly straight
    expect(a.landings).toHaveLength(4);
    expect(a.bridges).toHaveLength(3);
    for (const l of a.landings) {
      expect(inside(a.polygon, [l.x, l.y])).toBe(true);
      expect(l.passengers).toBeGreaterThanOrEqual(2);
      expect(l.passengers).toBeLessThanOrEqual(6);
    }
    const ys = a.landings.map((l: any) => l.y);
    expect([...ys].sort((p: number, q: number) => q - p)).toEqual(ys);               // in order up the river
    await expect(page.getByTestId('stops').locator('li')).toHaveCount(4);
  });

  test('momentum: speed builds and fades gradually, like a first-order drag model', async ({ page }) => {
    await begin(page);
    const { B, DT } = await C(page);
    const tr = await trace(page, 120, { throttle: 1, rudder: 0 });
    tr.forEach((s: any) => expect(s.contact).toBe(false));
    // continuous model: u(t) = (a/k)(1 − e^(−k t))
    const u2 = (B.ACC / B.DRAG) * (1 - Math.exp(-B.DRAG * 2));
    expect(tr.at(-1).u).toBeGreaterThan(u2 * 0.99);
    expect(tr.at(-1).u).toBeLessThan(u2 * 1.01);
    expect(tr[0].u).toBeCloseTo(B.ACC * DT, 9);                                          // one step: no jump to speed
    // cut the engine: it glides, decaying as e^(−k t)
    const coast = await trace(page, 60, { throttle: 0 });
    expect(coast.at(-1).u / tr.at(-1).u).toBeCloseTo(Math.exp(-B.DRAG), 2);
    // full astern is capped
    const back = await trace(page, 600, { throttle: -1 });
    expect(Math.min(...back.map((s: any) => s.u))).toBeGreaterThanOrEqual(-B.REV_MAX);
  });

  test('no instant turns: the turn rate ramps up from zero and never exceeds its cap', async ({ page }) => {
    await begin(page);
    const { B, DT } = await C(page);
    await trace(page, 120, { throttle: 1, rudder: 0 });
    const th0 = (await S(page)).boat.th;
    const one = await trace(page, 1, { rudder: 1 });
    expect(Math.abs(one[0].w)).toBeLessThanOrEqual(B.TURN_ACC * DT + 1e-12);
    expect(Math.abs(one[0].th - th0)).toBeLessThan(0.001);
    // in the channel the walls soon interrupt a hard turn, but the cap holds throughout
    const tr = await trace(page, 360, { rudder: 1 });
    let prevTh = one[0].th;
    for (const s of tr) {
      expect(Math.abs(s.w)).toBeLessThanOrEqual(B.MAX_TURN + 1e-12);
      expect(Math.abs(s.th - prevTh)).toBeLessThanOrEqual(B.MAX_TURN * DT + 1e-12);
      prevTh = s.th;
    }
    // the same model on open water: a full-speed, hard-over quarter turn
    const open = await page.evaluate(([u]) => (window as any).__barge.openWater({ u }, { throttle: 1, rudder: 1 }, 600), [B.ACC / B.DRAG]);
    const maxW = Math.max(...open.map((s: any) => Math.abs(s.w)));
    expect(maxW).toBeCloseTo(B.MAX_TURN, 9);                                             // at speed it does reach the cap…
    expect(open.every((s: any) => s.w <= B.MAX_TURN + 1e-12)).toBe(true);               // …and never passes it
    expect(B.MAX_TURN * 180 / Math.PI).toBeCloseTo(34.4, 1);                            // "about 34° per second"
    const i90 = open.findIndex((s: any) => s.th >= Math.PI / 2);
    expect((i90 + 1) * DT).toBeGreaterThanOrEqual(Math.PI / 2 / B.MAX_TURN);            // a quarter turn takes at least 2.6 s
    // a barge at rest barely turns: a quarter of the authority, so a quarter of the speed-limited rate
    const still = await page.evaluate(() => (window as any).__barge.openWater({ u: 0 }, { throttle: 0, rudder: 1 }, 600));
    expect(still.at(-1).w).toBeCloseTo((B.TURN_ACC * 0.25) / B.ANG_DRAG, 2);
    expect(still.at(-1).w).toBeLessThan(B.MAX_TURN / 2);
  });

  test('the hull never leaves the channel polygon, whatever the helm does', async ({ page }) => {
    test.setTimeout(90_000);
    await begin(page);
    const ch = await page.evaluate(() => (window as any).__barge.channel());
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let contacts = 0, bumps = 0, prev = false;
    for (let chunk = 0; chunk < 100; chunk++) {
      const ctl = { throttle: rnd() < 0.8 ? 1 : -1, rudder: Math.round(rnd() * 2 - 1) };
      const tr = await trace(page, 30, ctl);
      for (const s of tr) {
        for (const p of s.hull) expect(inside(ch.polygon, p), `corner ${p} at frame`).toBe(true);
        if (s.contact) contacts++;
        if (s.contact && !prev) bumps++;
        prev = s.contact;
      }
      if ((await S(page)).mode !== 'play') break;
    }
    expect(contacts).toBeGreaterThan(0);                                                 // the walls were really tested
    const st = await S(page);
    expect(st.bumps).toBe(bumps);                                                        // one bump per fresh contact
    const docks = st.docked.reduce((a: number, id: number) => a + 50 + 10 * ch.landings[id].passengers, 0);
    expect(st.score).toBe(docks - 15 * bumps + st.bonus);
  });

  test('ramming a wall: pushed back to the bank, one bump per fresh knock, −15 each', async ({ page }) => {
    await begin(page);
    const c = await C(page);
    const ch = await page.evaluate(() => (window as any).__barge.channel());
    await place(page, { x: ch.centre[12][0], y: ch.centre[12][1], th: Math.PI / 2, u: 0, w: 0 });   // broadside across the stream, bow east
    const tr = await trace(page, 180, { throttle: 1, rudder: 0 });
    expect(tr.some((s: any) => s.contact)).toBe(true);
    for (const s of tr) for (const p of s.hull) expect(inside(ch.polygon, p)).toBe(true);
    let st = await S(page);
    expect(st.bumps).toBe(1);                                                             // pressed against the wall: still one bump
    await expect(page.getByTestId('status')).toContainText('Bump');
    await trace(page, 90, { throttle: -1 });
    expect((await S(page)).contact).toBe(false);
    await trace(page, 150, { throttle: 1 });
    st = await S(page);
    expect(st.bumps).toBe(2);
    expect(st.score).toBe(-30);
    await expect(page.getByTestId('bumps')).toHaveText('2');
    const east = Math.max(...st.hull.map((p: number[]) => p[0] - ch.centre[12][0]));
    expect(east).toBeLessThanOrEqual(c.HW + 2);
  });

  test('docking needs a near-stop: too fast is refused, slow boards the passengers once', async ({ page }) => {
    await begin(page);
    const { B } = await C(page);
    const ch = await page.evaluate(() => (window as any).__barge.channel());
    const l = ch.landings[0], i = Math.round(-l.y / 8);
    const th = alongChannel(ch, i);
    await input(page, { throttle: 0, rudder: 0 });
    await place(page, { x: l.x, y: l.y, th, u: 20, w: 0 });
    let st = await frames(page, 1);
    expect(st.docked).toEqual([]);
    await expect(page.getByTestId('status')).toContainText('Too fast to tie up at landing 1');
    await place(page, { x: l.x, y: l.y, th, u: B.DOCK_V + 0.5, w: 0 });
    st = await frames(page, 1);
    expect(st.docked).toEqual([]);                                                        // just over the limit still counts as too fast
    await place(page, { x: l.x, y: l.y, th, u: B.DOCK_V - 1, w: 0 });
    st = await frames(page, 1);
    expect(st.docked).toEqual([0]);
    expect(st.aboard).toBe(l.passengers);
    expect(st.bumps).toBe(0);
    expect(st.score).toBe(50 + 10 * l.passengers);
    await expect(page.getByTestId('guide')).toHaveText(`“${l.line}”`);
    await expect(page.getByTestId('stops').locator('li').first()).toHaveClass(/done/);
    await expect(page.getByTestId('aboard')).toHaveText(String(l.passengers));
    // sitting at the landing doesn't board them twice
    st = await frames(page, 120);
    expect(st.docked).toEqual([0]);
    expect(st.aboard).toBe(l.passengers);
    // outside the landing's radius nothing happens even at a standstill
    const l2 = ch.landings[1], j = Math.round(-l2.y / 8);
    const off = l2.side * -(B.DOCK_R + 25);
    await place(page, { x: l2.x + off, y: l2.y, th: alongChannel(ch, j), u: 0, w: 0 });
    st = await frames(page, 30);
    expect(st.docked).toEqual([0]);
  });

  test('deterministic: the same seed and the same key presses give the same voyage; another seed, another river', async ({ page }) => {
    const run = async (url: string) => {
      await begin(page, url);
      await page.keyboard.down('ArrowUp'); await frames(page, 200);
      await page.keyboard.down('ArrowLeft'); await frames(page, 40); await page.keyboard.up('ArrowLeft');
      await page.keyboard.down('d'); await frames(page, 90); await page.keyboard.up('d');
      await frames(page, 200); await page.keyboard.up('ArrowUp');
      await frames(page, 60);
      return S(page);
    };
    const a = await run(URL), b = await run(URL);
    expect(b.boat).toEqual(a.boat);
    expect(b.frame).toBe(590);
    expect([b.bumps, b.score]).toEqual([a.bumps, a.score]);
    expect(a.boat.y).toBeLessThan(-200);                                                  // it did go up the river
    const c = await run('/lab/147-river-walk-barge.html?seed=8');
    expect(c.seed).toBe(8);
    expect(c.boat).not.toEqual(a.boat);
  });

  test('reaching the turning basin ends the tour with a point per second left; time running out ends it with none', async ({ page }) => {
    await begin(page);
    const c = await C(page);
    const ch = await page.evaluate(() => (window as any).__barge.channel());
    const n = ch.centre.length;
    await page.evaluate((f) => (window as any).__barge.set({ frame: f, t: f / 60 }), 600);
    await place(page, { x: ch.centre[n - 10][0], y: ch.centre[n - 10][1], th: alongChannel(ch, n - 10), u: 40, w: 0 });
    await input(page, { throttle: 1, rudder: 0 });
    let st = await frames(page, 240);
    expect(st.mode).toBe('over');
    expect(st.reason).toBe('finish');
    expect(st.bonus).toBe(Math.floor(c.TIME - st.t + 1e-9));
    expect(st.bonus).toBeGreaterThan(280);
    expect(st.score).toBe(-15 * st.bumps + st.bonus);
    await expect(page.getByTestId('over')).toBeVisible();
    await expect(page.getByTestId('final-score')).toHaveText(String(st.score));
    await expect(page.getByTestId('again')).toBeFocused();
    await page.getByTestId('again').click();
    await expect(page.getByTestId('river')).toBeFocused();
    await page.evaluate(() => (window as any).__barge.manual(true));
    const last = Math.round(c.TIME / c.DT) - 1;
    await page.evaluate((f) => (window as any).__barge.set({ frame: f, t: f / 60 }), last);
    st = await frames(page, 1);
    expect(st.reason).toBe('time');
    expect(st.bonus).toBe(0);
    await expect(page.getByTestId('over-line')).toContainText('0 of 4 landings');
  });

  test('helm: keys and hold-to-steer buttons set throttle and rudder', async ({ page }) => {
    await begin(page);
    await expect(page.getByTestId('river')).toBeFocused();
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowLeft');
    let st = await frames(page, 60);
    expect(st.ctl).toEqual({ throttle: 1, rudder: -1 });
    expect(st.boat.u).toBeGreaterThan(10);
    expect(st.boat.w).toBeLessThan(0);                                                    // port = anticlockwise
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowLeft');
    expect((await S(page)).ctl).toEqual({ throttle: 0, rudder: 0 });
    const astern = page.getByTestId('helm-astern');
    await astern.dispatchEvent('pointerdown', { pointerId: 1 });
    expect((await S(page)).ctl.throttle).toBe(-1);
    await expect(astern).toHaveClass(/on/);
    await astern.dispatchEvent('pointerup', { pointerId: 1 });
    expect((await S(page)).ctl.throttle).toBe(0);
    await page.getByTestId('helm-right').focus();
    await page.keyboard.down('Enter');
    expect((await S(page)).ctl.rudder).toBe(1);
    await page.keyboard.up('Enter');
    expect((await S(page)).ctl.rudder).toBe(0);
  });

  test('the real loop runs a fixed 1/60 s step under page.clock, and manual mode freezes it', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-27T15:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-27T15:00:02Z'));
    await page.getByTestId('start').click();
    const t0 = (await S(page)).t;
    await page.clock.runFor(3000);
    const st = await S(page);
    expect(st.t - t0).toBeGreaterThan(2.9);
    expect(st.t - t0).toBeLessThan(3.1);
    expect(st.frame / 60).toBeCloseTo(st.t, 9);
    await expect(page.getByTestId('time')).toHaveText(/^0:0[23]$/);
    await page.evaluate(() => (window as any).__barge.manual(true));
    await page.clock.runFor(1000);
    expect((await S(page)).frame).toBe(st.frame);
  });
});
