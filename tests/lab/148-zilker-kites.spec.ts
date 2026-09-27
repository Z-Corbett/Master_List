import { test, expect, Page } from '@playwright/test';

const URL = '/lab/148-zilker-kites.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__kite.state);
const sim = (page: Page, p: any, seconds: number, from = 0) => page.evaluate(([a, b, c]) => (window as any).__kite.simulate(a, b, c), [p, seconds, from] as const);
const frames = (page: Page, n: number) => page.evaluate((k) => (window as any).__kite.frames(k), n);
const G = 9.81;

async function openManual(page: Page) {
  await page.goto(URL);
  await page.evaluate(() => (window as any).__kite.manual(true));
}
async function setRange(page: Page, id: string, v: number) {
  await page.getByTestId(id).fill(String(v));
}

test.describe('148 Zilker Kites', () => {
  test('with no wind the kite falls, never faster than free fall, and ends up on the grass', async ({ page }) => {
    await page.goto(URL);
    const r = await sim(page, { wind: 0, gust: 0, tail: 2 }, 10);
    expect(r.grounded).toBe(true);
    expect(r.y).toBe(0);
    expect(r.T).toBe(0);
    const y0 = 30 * Math.sin((35 * Math.PI) / 180), DT = 1 / 120;
    // free fall under the page's semi-implicit Euler step (velocity first, then position) drops g·dt²·n(n+1)/2 after n
    // steps: a hair more than ½gt², which is what the first run of this test tripped over
    const freeFall = (t: number) => { const n = Math.round(t / DT); return (G * DT * DT * n * (n + 1)) / 2; };
    let prev = y0;
    for (const p of r.series) {
      expect(p.y).toBeLessThanOrEqual(prev + 1e-9);                                     // only ever down
      if (p.y > 0) expect(y0 - p.y).toBeLessThanOrEqual(freeFall(p.t) + 1e-9);          // drag can only slow the fall
      prev = p.y;
    }
    // early on the drag is tiny, so the drop is close to free fall, and close to ½gt²
    expect(y0 - r.series[0].y).toBeGreaterThan(0.9 * freeFall(0.1));
    expect(y0 - r.series[0].y).toBeCloseTo(0.5 * G * 0.01, 2);
    // the live page agrees
    await openManual(page);
    await setRange(page, 'wind', 0);
    await page.getByTestId('launch').click();
    await expect(page.getByTestId('status')).toContainText('No wind');
    const f = await frames(page, 1200);
    expect(f.grounded).toBe(true);
    await expect(page.getByTestId('height')).toHaveText('0.0 m');
    await expect(page.getByTestId('stability-text')).toHaveText('on the grass');
  });

  test('stronger steady wind flies the kite at a higher line angle, monotonically, for every shape', async ({ page }) => {
    await page.goto(URL);
    for (const shape of ['diamond', 'delta', 'box', 'sled']) {
      let prev = -Infinity;
      for (let w = 6; w <= 14; w++) {
        const r = await sim(page, { shape, wind: w, gust: 0, tail: 2, bridle: 0.3 }, 40);
        expect(r.grounded, `${shape} at ${w} m/s`).toBe(false);
        expect(r.taut).toBe(true);
        expect(r.phi, `${shape} at ${w} m/s`).toBeGreaterThan(prev);
        expect(r.phi).toBeLessThan(90);
        prev = r.phi;
      }
    }
    // a light breeze is not enough for the heavy box kite
    expect((await sim(page, { shape: 'box', wind: 2, gust: 0 }, 30)).grounded).toBe(true);
  });

  test('force balance in steady flight: lift, drag, weight and line tension sum to zero, and the line lies along the resultant', async ({ page }) => {
    await page.goto(URL);
    for (const wind of [6, 9, 13]) {
      const r = await sim(page, { shape: 'diamond', wind, gust: 0, tail: 2, bridle: 0.3 }, 60);
      const f = r.forces;
      const aero = [f.lift[0] + f.drag[0] + f.tail[0], f.lift[1] + f.drag[1] + f.tail[1]];
      const net = [aero[0] + f.weight[0] + f.tension[0], aero[1] + f.weight[1] + f.tension[1]];
      expect(Math.hypot(...net)).toBeLessThan(0.01 * Math.hypot(...aero));
      expect(f.weight[1]).toBeCloseTo(-r.m * G, 9);
      expect(f.lift[0] * f.drag[0] + f.lift[1] * f.drag[1]).toBeCloseTo(0, 6);             // lift is perpendicular to drag
      expect(f.drag[1]).toBeCloseTo(0, 3);                                                   // at rest in steady wind the drag is horizontal
      // tension pulls straight back down the line, with the magnitude the page reports
      expect(Math.hypot(...f.tension)).toBeCloseTo(r.T, 6);
      expect((Math.atan2(-f.tension[1], -f.tension[0]) * 180) / Math.PI).toBeCloseTo(r.phi, 1);
      // so aerodynamic force + weight points along the line, out to the kite
      const res = [aero[0] + f.weight[0], aero[1] + f.weight[1]];
      expect((Math.atan2(res[1], res[0]) * 180) / Math.PI).toBeCloseTo(r.phi, 0);
      expect(Math.hypot(r.vx, r.vy)).toBeLessThan(1e-3);
    }
  });

  test('a longer tail damps the wobble: in the same fixed-seed gusts the oscillation shrinks as the tail grows', async ({ page }) => {
    await page.goto(URL);
    const runs = [];
    for (const tail of [0, 1, 2, 4, 6]) runs.push(await sim(page, { seed: 7, shape: 'diamond', wind: 7, gust: 0.35, tail, bridle: 0.3 }, 60, 10));
    for (let i = 1; i < runs.length; i++) expect(runs[i].thRms, `tail step ${i}`).toBeLessThan(runs[i - 1].thRms);
    expect(runs[4].thMax).toBeLessThan(runs[0].thMax / 3);
    for (const r of runs) expect(r.grounded).toBe(false);
    // the price of the tail is a little drag: in a steady wind it flies slightly lower
    const [bare, long] = [await sim(page, { wind: 7, gust: 0, tail: 0 }, 40), await sim(page, { wind: 7, gust: 0, tail: 6 }, 40)];
    expect(long.phi).toBeLessThan(bare.phi);
    expect(long.phi).toBeGreaterThan(bare.phi - 10);
    // same seed, same gusts: the run repeats exactly; another seed gives different gusts
    const again = await sim(page, { seed: 7, shape: 'diamond', wind: 7, gust: 0.35, tail: 0, bridle: 0.3 }, 60, 10);
    expect(again.thRms).toBe(runs[0].thRms);
    const other = await sim(page, { seed: 8, shape: 'diamond', wind: 7, gust: 0.35, tail: 0, bridle: 0.3 }, 60, 10);
    expect(other.thRms).not.toBe(runs[0].thRms);
  });

  test('the stability meter reads higher with a long tail than with none, in the live flight', async ({ page }) => {
    await openManual(page);
    await setRange(page, 'wind', 7);
    await setRange(page, 'gust', 0.5);
    await setRange(page, 'tail', 0);
    await page.getByTestId('launch').click();
    const bare = await frames(page, 2400);
    await expect(page.getByTestId('stability')).toHaveAttribute('aria-valuenow', String(bare.stability));
    await setRange(page, 'tail', 6);
    await expect(page.getByTestId('tail-out')).toHaveText('6.0 m');
    await page.getByTestId('launch').click();
    const long = await frames(page, 2400);
    expect(long.grounded).toBe(false);
    expect(long.stability).toBeGreaterThan(bare.stability + 20);
    await expect(page.getByTestId('stability')).toHaveAttribute('aria-valuenow', String(long.stability));
    await expect(page.getByTestId('stability-text')).toContainText(String(long.stability));
  });

  test('the line never stretches and never pushes: |r| ≤ 30 m and tension ≥ 0 through a gusty minute', async ({ page }) => {
    await page.goto(URL);
    for (const shape of ['diamond', 'sled']) {
      const r = await sim(page, { seed: 3, shape, wind: 10, gust: 0.5, tail: 1 }, 60);
      expect(r.maxR).toBeLessThanOrEqual(30 + 1e-9);
      expect(r.minT).toBeGreaterThanOrEqual(0);
      for (const p of r.series) expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  test('the bridle sets the sail angle: toward the nose means a higher angle of attack and more pull', async ({ page }) => {
    await page.goto(URL);
    const eta = await page.evaluate(() => [0.15, 0.3, 0.45].map((b) => (window as any).__kite.eta(b)));
    expect(eta[0]).toBeCloseTo(85, 9);
    expect(eta[1]).toBeCloseTo(60, 9);
    expect(eta[2]).toBeCloseTo(35, 9);
    const nose = await sim(page, { wind: 7, gust: 0, bridle: 0.15 }, 40), back = await sim(page, { wind: 7, gust: 0, bridle: 0.45 }, 40);
    expect(nose.alpha).toBeGreaterThan(back.alpha);
    expect(nose.T).toBeGreaterThan(2 * back.T);
    // steady flight: angle of attack = bridle angle − line angle (the wind is horizontal and the kite still)
    expect(nose.alpha).toBeCloseTo(85 - nose.phi, 2);
    await setRange(page, 'bridle', 0.2);
    await expect(page.getByTestId('bridle-out')).toHaveText('20%');
    const svg = page.getByTestId('design').locator('svg');
    const g = (await page.evaluate(() => (window as any).__kite.consts)).GEOM[(await S(page)).params.shape];
    const y = Number(await svg.locator('[data-bridle-y]').getAttribute('data-bridle-y'));
    expect(y).toBeCloseTo(g.nose[1] + (g.tail[1] - g.nose[1]) * 0.2, 0);
  });

  test('designs are seeded: same seed, same pattern and SVG; other seeds differ', async ({ page }) => {
    await page.goto(URL);
    const c = await page.evaluate(() => (window as any).__kite.consts);
    const [a, b] = await page.evaluate(() => [(window as any).__kite.design(7), (window as any).__kite.design(7)]);
    expect(a).toEqual(b);
    const s = await S(page);
    expect(s.design).toEqual(a);
    expect(s.params).toMatchObject({ shape: a.shape, pattern: a.pattern, tail: a.tail, bridle: a.bridle });
    const svg1 = await page.evaluate(() => (window as any).__kite.svgString());
    await page.reload();
    expect(await page.evaluate(() => (window as any).__kite.svgString())).toBe(svg1);
    const many = await page.evaluate(() => Array.from({ length: 40 }, (_, i) => (window as any).__kite.design(100 + i)));
    expect(new Set(many.map((d: any) => JSON.stringify(d))).size).toBe(40);
    expect(new Set(many.map((d: any) => d.pattern)).size).toBe(c.PATTERNS.length);
    for (const d of many) {
      expect(new Set(d.colours).size).toBe(5);
      expect(d.bridle).toBeGreaterThanOrEqual(0.26);
      expect(d.bridle).toBeLessThanOrEqual(0.34);
    }
    await expect(page.getByTestId('seed')).toContainText('seed 7');
    await page.getByTestId('reseed').click();
    expect(page.url()).toContain(`seed=${(await S(page)).seed}`);
  });

  test('SVG export: well-formed, one patterned panel per sail panel, a bow every half metre of tail', async ({ page }) => {
    await page.goto(URL);
    const want: Record<string, number> = { diamond: 4, delta: 3, box: 4, sled: 3 };
    for (const shape of Object.keys(want)) {
      await page.getByTestId('shape').selectOption(shape);
      await setRange(page, 'tail', 3.5);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
      expect(dl.suggestedFilename()).toBe('zilker-kite-7.svg');
      const chunks: Buffer[] = [];
      for await (const ch of await dl.createReadStream()) chunks.push(ch as Buffer);
      const src = Buffer.concat(chunks).toString('utf8');
      const r = await page.evaluate((text) => {
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        const panels = [...doc.querySelectorAll('[data-panel]')];
        return {
          err: doc.getElementsByTagName('parsererror').length, root: doc.documentElement.localName, ns: doc.documentElement.namespaceURI,
          panels: panels.length, patterns: doc.querySelectorAll('pattern').length,
          resolved: panels.every((p) => { const m = /url\(#(.+)\)/.exec(p.getAttribute('fill')!); return !!m && doc.getElementById(m[1])?.localName === 'pattern'; }),
          bows: doc.querySelectorAll('[data-bow]').length, bridle: doc.querySelectorAll('[data-part=bridle]').length,
        };
      }, src);
      expect(r, shape).toEqual({ err: 0, root: 'svg', ns: 'http://www.w3.org/2000/svg', panels: want[shape], patterns: want[shape], resolved: true, bows: 7, bridle: 1 });
      expect(src).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    }
    await setRange(page, 'tail', 0);
    await expect(page.getByTestId('design').locator('[data-part=tail]')).toHaveCount(0);
  });

  test('the live flight runs on the fake clock, relaunches from the grass when the wind returns, and pauses', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-27T16:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-27T16:00:02Z'));
    await setRange(page, 'wind', 0);
    await page.getByTestId('launch').click();
    await page.clock.runFor(8000);
    let f = (await S(page)).flight;
    expect(f.t).toBeGreaterThan(7.8);
    expect(f.t).toBeLessThan(8.2);
    expect(f.grounded).toBe(true);
    await expect(page.getByTestId('status')).toContainText('on the ground');
    await setRange(page, 'wind', 9);
    await setRange(page, 'gust', 0);
    await page.clock.runFor(20000);
    f = (await S(page)).flight;
    expect(f.grounded).toBe(false);
    expect(f.phi).toBeGreaterThan(40);
    await expect(page.getByTestId('status')).toContainText('Up it goes');
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    const t = (await S(page)).flight.t;
    await page.clock.runFor(1000);
    expect((await S(page)).flight.t).toBe(t);
  });
});
