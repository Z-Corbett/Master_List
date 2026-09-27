import { test, expect, Page } from '@playwright/test';

const URL = '/lab/130-signal-box.html';
const S = (page: Page) => page.evaluate(() => (window as any).__signal.state);

// The layout, read off the track diagram and written out independently of the page:
// west line TW – points 1 in T1 – platforms P1 (normal) / P2 (reverse) – points 2 in T2 – points 3 in T3 – east line TE (normal) / branch TN (reverse).
const LAYOUT: Record<string, { signal: string; sections: string[]; points: Record<string, 'N' | 'R'> }> = {
  'W-P1': { signal: 'WA', sections: ['T1', 'P1'], points: { 1: 'N' } },
  'W-P2': { signal: 'WA', sections: ['T1', 'P2'], points: { 1: 'R' } },
  'E-P1': { signal: 'EA', sections: ['T3', 'T2', 'P1'], points: { 3: 'N', 2: 'N' } },
  'E-P2': { signal: 'EA', sections: ['T3', 'T2', 'P2'], points: { 3: 'N', 2: 'R' } },
  'N-P1': { signal: 'NA', sections: ['T3', 'T2', 'P1'], points: { 3: 'R', 2: 'N' } },
  'N-P2': { signal: 'NA', sections: ['T3', 'T2', 'P2'], points: { 3: 'R', 2: 'R' } },
  'P1-W': { signal: 'P1W', sections: ['T1', 'TW'], points: { 1: 'N' } },
  'P2-W': { signal: 'P2W', sections: ['T1', 'TW'], points: { 1: 'R' } },
  'P1-E': { signal: 'P1E', sections: ['T2', 'T3', 'TE'], points: { 2: 'N', 3: 'N' } },
  'P2-E': { signal: 'P2E', sections: ['T2', 'T3', 'TE'], points: { 2: 'R', 3: 'N' } },
  'P1-N': { signal: 'P1E', sections: ['T2', 'T3', 'TN'], points: { 2: 'N', 3: 'R' } },
  'P2-N': { signal: 'P2E', sections: ['T2', 'T3', 'TN'], points: { 2: 'R', 3: 'R' } },
};
const IDS = Object.keys(LAYOUT);
/** Routes conflict when they would put two movements on the same track: a shared track circuit, or one set of points needed both ways. */
function conflicts(a: string, b: string) {
  const A = LAYOUT[a], B = LAYOUT[b];
  const shared = A.sections.some((s) => B.sections.includes(s));
  const opposed = Object.entries(A.points).some(([p, v]) => B.points[p] !== undefined && B.points[p] !== v);
  return a !== b && (shared || opposed);
}
const LEN = { TW: 400, T1: 120, P: 200, T2: 120, T3: 120, TE: 400, TN: 400 };
const V = 20, STOP = 140, TRAIN = 80;                                    // m/s, stopping point in the platform, train length

async function open(page: Page) {
  await page.clock.install({ time: new Date('2026-09-26T12:00:00Z') });
  await page.goto(URL);
  await page.clock.pauseAt(new Date('2026-09-26T12:00:10Z'));
  await page.getByTestId('start').click();
  expect((await S(page)).t).toBe(0);
}
/** Run the fake clock until timetable time `sec`, exactly. */
async function to(page: Page, sec: number) {
  const t = (await S(page)).t;
  expect(sec, 'time only runs forward').toBeGreaterThanOrEqual(t);
  if (sec > t) await page.clock.runFor(Math.round((sec - t) * 1000));
  expect((await S(page)).t).toBeCloseTo(sec, 6);
}
const route = (page: Page, id: string) => page.getByTestId(`route-${id}`).click();
const train = async (page: Page, id: string) => (await S(page)).trains.find((t: any) => t.id === id);

test.describe('130 Signal Box', () => {
  test('the control table matches the track layout', async ({ page }) => {
    await page.goto(URL);
    const routes = await page.evaluate(() => (window as any).__signal.routes);
    expect(Object.fromEntries(routes.map((r: any) => [r.id, { signal: r.signal, sections: r.sections, points: r.points }]))).toEqual(LAYOUT);
    const sections = await page.evaluate(() => (window as any).__signal.sections);
    expect(sections).toEqual({ TW: 400, T1: 120, P1: 200, P2: 200, T2: 120, T3: 120, TE: 400, TN: 400 });
    await expect(page.getByTestId('ct-E-P2')).toContainText('T3, T2, P2');
    await expect(page.getByTestId('ct-E-P2')).toContainText('2R, 3N');                 // points listed in number order
  });

  test('the conflict matrix equals an independent route-conflict computation', async ({ page }) => {
    await page.goto(URL);
    const M: boolean[][] = await page.evaluate(() => (window as any).__signal.matrix);
    let pairs = 0;
    IDS.forEach((a, i) => IDS.forEach((b, j) => {
      if (i === j) return;
      expect(M[i][j], `${a} × ${b}`).toBe(conflicts(a, b));
      expect(M[i][j]).toBe(M[j][i]);                                    // symmetric
      if (conflicts(a, b)) pairs++;
    }));
    expect(pairs / 2).toBe(6 + 28 + 4);                               // west end, east end, and two trains into one platform
    // spot checks a signaller would reason out: parallel moves are compatible, two trains into one platform are not
    expect(conflicts('W-P1', 'E-P2')).toBe(false);
    expect(conflicts('W-P2', 'P1-N')).toBe(false);
    expect(conflicts('W-P1', 'E-P1')).toBe(true);
    expect(conflicts('E-P1', 'N-P2')).toBe(true);
    // the rendered table agrees, cell by cell
    for (const [a, b] of [['W-P1', 'E-P2'], ['W-P1', 'E-P1'], ['P1-E', 'P2-N'], ['N-P1', 'W-P2'], ['P2-W', 'W-P1']]) {
      await expect(page.getByTestId(`conflict-${a}-${b}`)).toHaveText(conflicts(a, b) ? '✕' : '');
    }
  });

  test('with W → P1 set, the interlocking refuses exactly the conflicting routes', async ({ page }) => {
    await open(page);
    await route(page, 'W-P1');
    let s = await S(page);
    expect(s.signals.WA).toBe('clear');                                  // points 1 already normal: clears at once
    for (const id of IDS.filter((x) => x !== 'W-P1')) {
      const res = await page.evaluate((id) => (window as any).__signal.request(id), id);
      expect(res.ok, id).toBe(!conflicts('W-P1', id));
      if (!res.ok) expect(res.reason).toMatch(/^Refused: .* conflicts with W-P1|^Refused: track circuit/);
      if (res.ok) {
        const c = await page.evaluate((id) => (window as any).__signal.cancel(id), id);
        expect(c.ok).toBe(true);
        expect(c.reason).toBe(`${id} cancelled and released.`);        // nobody approaching: released at once
      }
    }
    await route(page, 'E-P1');
    await expect(page.getByTestId('msg')).toHaveText('Refused: E-P1 conflicts with W-P1 (both need P1).');
    await expect(page.getByTestId('route-E-P1')).toHaveAttribute('aria-pressed', 'false');
    s = await S(page);
    expect(s.routes.map((r: any) => r.id)).toEqual(['W-P1']);
  });

  test('points are called, detected and locked before the signal clears', async ({ page }) => {
    await open(page);
    await route(page, 'W-P2');
    let s = await S(page);
    expect(s.points['1']).toMatchObject({ pos: 'R', moving: true });
    expect(s.signals.WA).toBe('danger');
    await expect(page.getByTestId('points-1')).toContainText('reverse (moving) · locked');
    await to(page, 3.9);
    expect((await S(page)).signals.WA).toBe('danger');
    await to(page, 4.0);
    s = await S(page);
    expect(s.points['1'].moving).toBe(false);
    expect(s.signals.WA).toBe('clear');
    await page.getByTestId('points-1').click();
    await expect(page.getByTestId('msg')).toHaveText('Refused: points 1 are locked by route W-P2.');
    expect((await S(page)).points['1'].pos).toBe('R');
    // free points swing when asked
    await page.getByTestId('points-3').click();
    await expect(page.getByTestId('msg')).toHaveText('Points 3 swinging to reverse.');
  });

  test('approach locking: cancelling with a train approaching holds the route for 30 s', async ({ page }) => {
    await open(page);
    await route(page, 'W-P1');
    await to(page, 10);
    expect((await train(page, '1A01')).s).toBe(200);
    await route(page, 'W-P1');                                            // cancel
    await expect(page.getByTestId('msg')).toContainText('WA back to danger. 1A01 is approaching, so W-P1 stays approach locked for 30 s.');
    let s = await S(page);
    expect(s.signals.WA).toBe('danger');
    expect(s.routes).toEqual([expect.objectContaining({ id: 'W-P1', state: 'cancelling', cancelAt: 40000 })]);
    expect((await page.evaluate(() => (window as any).__signal.request('W-P2'))).ok).toBe(false);
    expect((await page.evaluate(() => (window as any).__signal.swing(1))).reason).toBe('Refused: points 1 are locked by route W-P1.');
    await to(page, 25);
    expect((await train(page, '1A01')).s).toBe(400);                      // stopped at the red signal after 400 m
    await to(page, 39.9);
    expect((await S(page)).routes).toHaveLength(1);
    await to(page, 40);
    expect((await S(page)).routes).toHaveLength(0);
    expect((await page.evaluate(() => (window as any).__signal.swing(1))).ok).toBe(true);
  });

  test('timetable under page.clock: a train runs to the platform at 20 m/s and arrives at a computable time', async ({ page }) => {
    await open(page);
    let tr = await train(page, '1A01');
    expect(tr.state).toBe('approach');
    expect(tr.appearedAt).toBe(0);
    expect((await train(page, '1B02')).state).toBe('offstage');
    await route(page, 'W-P1');
    const arrive = (LEN.TW + LEN.T1 + STOP) / V;                           // 33 s
    await to(page, 20);
    expect((await S(page)).signals.WA).toBe('clear');
    expect((await train(page, '1B02')).state).toBe('approach');          // due on the east line at 20 s
    await to(page, 20.1);
    expect((await S(page)).signals.WA).toBe('danger');                   // replaced as soon as the train passes it
    await to(page, arrive - 0.1);
    expect((await train(page, '1A01')).state).toBe('approach');
    await to(page, arrive);
    tr = await train(page, '1A01');
    expect(tr.state).toBe('platform');
    expect(tr.arrivedAt).toBe(arrive);
    expect(tr.sections).toEqual(['P1']);
    const s = await S(page);
    expect(s.events).toEqual([{ train: '1A01', kind: 'arr', sched: 45, actual: 33, late: 0, points: 100 }]);
    await expect(page.getByTestId('score')).toHaveText('100');
    await expect(page.getByTestId('clock')).toHaveText('07:00:33');
    await expect(page.getByTestId('timetable').locator('tr[data-train="1A01"]')).toContainText('07:00:33');
  });

  test('sectional release: points unlock as the train clears their section, the route when it is in the platform', async ({ page }) => {
    await open(page);
    await route(page, 'W-P1');
    const clearT1 = (LEN.TW + LEN.T1 + TRAIN) / V;                        // rear leaves T1 at 30 s
    await to(page, clearT1 - 0.1);
    let s = await S(page);
    expect(s.occupied.T1).toBe('1A01');
    expect(s.routes[0].released).toEqual([]);
    expect((await page.evaluate(() => (window as any).__signal.swing(1))).ok).toBe(false);
    await to(page, clearT1);
    s = await S(page);
    expect(s.occupied.T1).toBeUndefined();
    expect(s.routes[0]).toMatchObject({ id: 'W-P1', state: 'occupied', released: ['T1'] });
    // T1 is free again, so a conflicting route over T1 can be set while W-P1 still holds P1
    expect((await page.evaluate(() => (window as any).__signal.request('P2-W'))).ok).toBe(true);
    expect((await page.evaluate(() => (window as any).__signal.cancel('P2-W'))).ok).toBe(true);
    await to(page, 33);
    s = await S(page);
    expect(s.routes).toEqual([]);
    // and a train standing in P1 keeps the platform's track circuit occupied
    const r = await page.evaluate(() => (window as any).__signal.request('E-P1'));
    expect(r).toEqual({ ok: false, reason: 'Refused: track circuit P1 is occupied.' });
  });

  test('three movements to time: arrivals from both ends and a departure, scored for punctuality', async ({ page }) => {
    await open(page);
    await route(page, 'W-P1');
    await to(page, 20);
    await route(page, 'E-P2');                                            // points 2 must swing: 4 s
    expect((await S(page)).signals.EA).toBe('danger');
    await to(page, 24);
    expect((await S(page)).signals.EA).toBe('clear');
    const arr2 = 20 + (LEN.TE + LEN.T3 + LEN.T2 + STOP) / V;               // 59 s, never checked by the red signal
    await to(page, arr2);
    expect((await train(page, '1B02')).arrivedAt).toBe(arr2);
    expect((await S(page)).routes).toEqual([]);
    await to(page, 60);
    await route(page, 'P1-E');                                            // 1A01 onward to the east; points 2 back to normal
    await to(page, 64);
    expect((await S(page)).signals.P1E).toBe('clear');
    await to(page, 74.9);
    expect((await train(page, '1A01')).state).toBe('platform');         // trains never leave early
    await to(page, 75);
    let tr = await train(page, '1A01');
    expect(tr.state).toBe('departing');
    expect(tr.departedAt).toBe(75);
    expect((await S(page)).signals.P1E).toBe('danger');
    const gone = 75 + ((LEN.P - STOP) + LEN.T2 + LEN.T3 + LEN.TE + TRAIN) / V;   // 114 s
    await to(page, gone - 0.1);
    expect((await train(page, '1A01')).state).toBe('departing');
    await to(page, gone);
    tr = await train(page, '1A01');
    expect(tr.state).toBe('gone');
    const s = await S(page);
    expect(s.events.map((e: any) => [e.train, e.kind, e.late, e.points])).toEqual([['1A01', 'arr', 0, 100], ['1B02', 'arr', 0, 100], ['1A01', 'dep', 0, 100]]);
    expect(s.score).toBe(300);
    await expect(page.getByTestId('ppm')).toHaveText('100%');
  });

  test('a train held at a red signal arrives late and loses points by the minute', async ({ page }) => {
    const pts = (late: number) => (late <= 60 ? 100 : Math.max(0, 100 - 20 * Math.ceil((late - 60) / 60)));
    await open(page);
    await to(page, 100);
    let tr = await train(page, '1A01');
    expect(tr.s).toBe(400);                                              // waiting at WA since 20 s
    expect(tr.state).toBe('approach');
    await route(page, 'W-P1');
    const arrive = 100 + (LEN.T1 + STOP) / V;                             // 113 s, 68 s late
    await to(page, arrive);
    tr = await train(page, '1A01');
    expect(tr.arrivedAt).toBe(arrive);
    const s = await S(page);
    expect(s.events[0]).toEqual({ train: '1A01', kind: 'arr', sched: 45, actual: arrive, late: arrive - 45, points: pts(arrive - 45) });
    expect(s.events[0].points).toBe(80);
    await expect(page.getByTestId('ppm')).toHaveText('0%');
    await expect(page.getByTestId('timetable').locator('tr[data-train="1A01"] td.late')).toContainText('+68s');
  });

  test('block working: a new train is held off a line that a departure route has locked', async ({ page }) => {
    await open(page);
    await route(page, 'W-P1');
    await to(page, 33);
    await route(page, 'P1-W');                                            // the west line is now locked for a departure
    expect((await S(page)).signals.P1W).toBe('clear');
    // 1A01 is booked east, so a westbound route from its platform doesn't move it
    await to(page, 80);
    expect((await train(page, '1A01')).state).toBe('platform');
    await route(page, 'P1-W');                                            // train standing at the signal: approach locked
    expect((await S(page)).routes[0].state).toBe('cancelling');
    await expect(page.getByTestId('msg')).toContainText('approach locked for 30 s');
    await to(page, 110);
    expect((await S(page)).routes).toEqual([]);
    // lock TW again: 1A04, due on the west line at 120 s, is held back until the line is free
    await route(page, 'P2-W');
    await to(page, 125);
    expect((await train(page, '1A04')).state).toBe('offstage');
    await route(page, 'P2-W');                                            // no train at P2: cancelled at once
    await expect(page.getByTestId('msg')).toHaveText('P2-W cancelled and released.');
    await to(page, 125.1);
    const tr = await train(page, '1A04');
    expect(tr.state).toBe('approach');
    expect(tr.appearedAt).toBe(125.1);
  });

  test('keyboard: route buttons are real toggle buttons with pressed state, and fast time runs 4×', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('route-W-P1')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('route-W-P1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('msg')).toHaveText('W-P1 set: points locked, signal WA clear.');
    await expect(page.getByTestId('diagram')).toHaveAttribute('aria-label', /Routes set: W-P1 \(signal clear\)/);
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('route-W-P2')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('msg')).toHaveText('Refused: W-P2 conflicts with W-P1 (both need T1).');
    await page.getByTestId('fast').click();
    await expect(page.getByTestId('fast')).toHaveAttribute('aria-pressed', 'true');
    const t0 = (await S(page)).t;
    await page.clock.runFor(1000);
    expect((await S(page)).t).toBeCloseTo(t0 + 4, 6);
  });
});
