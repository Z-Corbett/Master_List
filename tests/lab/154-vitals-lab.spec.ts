import { test, expect, Page } from '@playwright/test';

const URL_ = '/lab/154-vitals-lab.html';
const V = (page: Page, key: string) => page.evaluate((k) => JSON.parse(JSON.stringify((window as any).__vitals[k])), key);

type R = { x: number; y: number; w: number; h: number };
// ---- independent oracles (not the page's code) ----
// Area of a union of rectangles by 2-D coordinate compression: a cell counts if its centre lies inside any rectangle.
function unionArea(rects: R[]) {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  let a = 0;
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (rects.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h)) a += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  }
  return a;
}
function clipTo(r: R, vw: number, vh: number): R | null {
  const x1 = Math.max(0, r.x), y1 = Math.max(0, r.y), x2 = Math.min(vw, r.x + r.w), y2 = Math.min(vh, r.y + r.h);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}
function layoutShift(vw: number, vh: number, pairs: { before: R; after: R }[]) {
  const rs: R[] = []; let d = 0;
  for (const p of pairs) {
    for (const r of [p.before, p.after]) { const c = clipTo(r, vw, vh); if (c) rs.push(c); }
    d = Math.max(d, Math.abs(p.after.y - p.before.y), Math.abs(p.after.x - p.before.x));
  }
  const impact = unionArea(rs) / (vw * vh), distance = d / Math.max(vw, vh);
  return { impact, distance, score: impact * distance };
}
// Session windows as web.dev describes them: gap < 1 s and total span < 5 s, CLS = the largest window.
function windows(shifts: { t: number; score: number }[]) {
  const out: { start: number; sum: number; n: number }[] = [];
  let prev = -Infinity;
  for (const s of [...shifts].sort((a, b) => a.t - b.t)) {
    const w = out[out.length - 1];
    if (w && s.t - prev < 1000 && s.t - w.start < 5000) { w.sum += s.score; w.n++; } else out.push({ start: s.t, sum: s.score, n: 1 });
    prev = s.t;
  }
  return { out, cls: Math.max(0, ...out.map((w) => w.sum)) };
}
const nearestRankP75 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.ceil(0.75 * s.length) - 1]; };

test.describe('154 Core Web Vitals Lab', () => {
  test('thresholds classify correctly at the boundaries', async ({ page }) => {
    await page.goto(URL_);
    const t = page.getByTestId('thresholds');
    await expect(t).toContainText('≤ 2.5 s'); await expect(t).toContainText('> 4 s');
    await expect(t).toContainText('≤ 200 ms'); await expect(t).toContainText('> 500 ms');
    await expect(t).toContainText('≤ 0.1'); await expect(t).toContainText('> 0.25');
    const got = await page.evaluate(() => {
      const c = (window as any).__vitals.classify;
      return [c('LCP', 2500), c('LCP', 2501), c('LCP', 4000), c('LCP', 4001), c('INP', 200), c('INP', 201), c('INP', 500), c('INP', 501),
        c('CLS', 0.1), c('CLS', 0.1001), c('CLS', 0.25), c('CLS', 0.2501), c('CLS', 0.07 + 0.03), c('CLS', 0.05 + 0.05 + 0.05 + 0.05 + 0.05)];
    });
    const G = 'good', N = 'needs-improvement', P = 'poor';
    expect(got).toEqual([G, N, N, P, G, N, N, P, G, N, N, P, G, N]);
  });

  test('LCP: the last candidate before input wins, and sliders move it', async ({ page }) => {
    await page.goto(URL_);
    const oracle = (els: any[], inputAt: number | null) => {
      let best: any = null;
      for (const e of [...els].sort((a, b) => a.t - b.t)) { if (inputAt != null && e.t >= inputAt) break; if (!best || e.w * e.h > best.w * best.h) best = e; }
      return best && { id: best.id, time: best.t };
    };
    let L = await V(page, 'lcp');
    expect(L.lcp).toEqual({ ...oracle(L.elements, null), area: 360 * 240 });
    const res = page.getByTestId('lcp-result');
    await expect(res).toHaveAttribute('data-element', 'hero');
    await expect(res).toHaveAttribute('data-rating', 'needs-improvement');
    await expect(res).toContainText('2.80 s');
    expect(L.candidates).toEqual(['logo', 'h1', 'intro', 'hero']);          // the cookie text (43,200 px²) is smaller than the intro (54,000)
    // an early tap stops LCP reporting: the intro paragraph is the LCP
    await page.getByTestId('lcp-input').fill('1000');
    await expect(res).toHaveAttribute('data-element', 'intro');
    L = await V(page, 'lcp');
    expect(L.lcp.id).toBe(oracle(L.elements, 1000).id);
    await expect(res).toHaveAttribute('data-rating', 'good');
    // input exactly when the hero paints: the paint is not counted
    await page.getByTestId('lcp-input').fill('2800');
    await expect(res).toHaveAttribute('data-element', 'intro');
    await page.getByTestId('lcp-input').fill('6000');
    // a slow headline doesn't matter, but a very slow hero is poor
    await page.getByTestId('lcp-t-hero').fill('4500');
    await expect(res).toHaveAttribute('data-rating', 'poor');
    await page.getByTestId('lcp-preload').click();
    await expect(res).toHaveAttribute('data-element', 'hero');
    await expect(res).toHaveAttribute('data-rating', 'good');
    L = await V(page, 'lcp');
    expect(L.lcp).toEqual({ ...oracle(L.elements, null), area: 86400 });
    expect(L.lcp.time).toBe(1100);
  });

  test('LCP: dragging a dot on the timeline changes its paint time', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse drag on the SVG; the sliders cover touch');
    await page.goto(URL_);
    await page.getByTestId('lcp-timeline').scrollIntoViewIfNeeded();
    const dot = page.getByTestId('dot-hero');
    const box = (await dot.boundingBox())!;
    const svg = (await page.getByTestId('lcp-timeline').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // the timeline runs from x=150 to 620 of a 640-wide viewBox for 0 to 6 s: aim for 1 s
    await page.mouse.move(svg.x + svg.width * ((150 + 470 / 6) / 640), box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const L = await V(page, 'lcp');
    const hero = L.elements.find((e: any) => e.id === 'hero');
    expect(hero.t).toBeGreaterThanOrEqual(900);
    expect(hero.t).toBeLessThanOrEqual(1100);
    await expect(page.getByTestId('lcp-t-hero')).toHaveValue(String(hero.t));
    await expect(page.getByTestId('lcp-result')).toHaveAttribute('data-rating', 'good');
  });

  test('INP: input delay + processing + presentation delay, painted on the next frame', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('tab-inp').click();
    const frame = 1000 / 60;
    const expectFor = (busy: number, handlers: number, render: number) => {
      const paint = Math.ceil((busy + handlers + render) / frame - 1e-9) * frame;
      return { inputDelay: busy, processing: handlers, presentation: paint - busy - handlers, latency: paint };
    };
    let I = await V(page, 'inp');
    let want = expectFor(120, 10 + 5 + 90, 30);                             // 255 ms of work → frame 16 ends at 266.67 ms
    for (const k of Object.keys(want) as (keyof typeof want)[]) expect(I.current[k]).toBeCloseTo(want[k], 6);
    expect(want.latency).toBeCloseTo(266.667, 2);
    await expect(page.getByTestId('inp-one')).toHaveAttribute('data-rating', 'needs-improvement');
    await expect(page.getByTestId('inp-breakdown')).toHaveText('Input delay 120 ms + processing 105 ms + presentation delay 41.7 ms = 266.7 ms.');
    // heavier click handler and a longer task → poor
    await page.getByTestId('inp-click').fill('300');
    await page.getByTestId('inp-busy').fill('200');
    I = await V(page, 'inp');
    want = expectFor(200, 315, 30);
    expect(I.current.latency).toBeCloseTo(want.latency, 6);
    await expect(page.getByTestId('inp-one')).toHaveAttribute('data-rating', 'poor');
    // yielding: light click handler, short input delay → good
    await page.getByTestId('inp-yield').click();
    I = await V(page, 'inp');
    want = expectFor(20, 25, 30);
    expect(I.current.latency).toBeCloseTo(want.latency, 6);
    await expect(page.getByTestId('inp-one')).toHaveAttribute('data-rating', 'good');
    await expect(page.getByTestId('inp-breakdown')).toContainText('no longer delays this frame');
    await expect(page.getByTestId('fid-note')).toContainText('INP replaced it as a Core Web Vital in March 2024');
  });

  test('INP over many interactions ignores one highest per 50', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('tab-inp').click();
    // three recorded interactions: INP is simply the worst
    await page.getByTestId('inp-record').click();
    await page.getByTestId('inp-click').fill('0');
    await page.getByTestId('inp-record').click();
    await page.getByTestId('inp-busy').fill('0');
    await page.getByTestId('inp-record').click();
    await expect(page.getByTestId('inp-rows').locator('tr')).toHaveCount(3);
    const I = await V(page, 'inp');
    expect(I.inp).toBe(Math.max(...I.recorded));
    await expect(page.getByTestId('inp-all')).toContainText('Page INP over 3 interactions');
    // the outlier rule, checked on synthetic latencies
    const lat = Array.from({ length: 120 }, (_, i) => 40 + ((i * 37) % 200));
    lat[5] = 900; lat[77] = 700; lat[100] = 650;
    const got = await page.evaluate((l) => {
      const f = (window as any).__vitals.api.inpOf;
      return { n120: f(l), n49: f(l.slice(0, 49)), n50: f(l.slice(0, 50)), n1: f([123]) };
    }, lat);
    const kth = (xs: number[], k: number) => [...xs].sort((a, b) => b - a)[k];
    expect(got.n120).toBe(kth(lat, 2));          // 120 interactions → ignore the 2 highest → 650
    expect(got.n120).toBe(650);
    expect(got.n49).toBe(900);                   // under 50 → the worst
    expect(got.n50).toBe(kth(lat.slice(0, 50), 1));
    expect(got.n1).toBe(123);
    await page.getByTestId('inp-clear').click();
    await expect(page.getByTestId('inp-rows').locator('tr')).toHaveCount(0);
  });

  test('CLS: reproduces the web.dev worked example (impact 0.75 × distance 0.25 = 0.1875)', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('tab-cls').click();
    await page.getByTestId('cls-example').click();
    await expect(page.getByTestId('ex-impact')).toHaveText('0.75');
    await expect(page.getByTestId('ex-distance')).toHaveText('0.25');
    await expect(page.getByTestId('ex-score')).toHaveText('0.1875');
    // the same numbers from the test's own geometry
    const mine = layoutShift(400, 800, [{ before: { x: 0, y: 0, w: 400, h: 400 }, after: { x: 0, y: 200, w: 400, h: 400 } }]);
    expect(mine).toEqual({ impact: 0.75, distance: 0.25, score: 0.1875 });
    // partly off-screen and horizontal moves, through the page's API vs the oracle
    const cases = [
      { vw: 360, vh: 640, pairs: [{ id: 'a', before: { x: 0, y: 500, w: 360, h: 300 }, after: { x: 0, y: 580, w: 360, h: 300 } }] },
      { vw: 800, vh: 600, pairs: [{ id: 'a', before: { x: 100, y: 100, w: 200, h: 100 }, after: { x: 160, y: 120, w: 200, h: 100 } },
        { id: 'b', before: { x: 500, y: 300, w: 100, h: 100 }, after: { x: 500, y: 350, w: 100, h: 100 } }] },
    ];
    for (const c of cases) {
      const got = await page.evaluate((cc) => (window as any).__vitals.api.shiftScore(cc.vw, cc.vh, cc.pairs), c);
      const want = layoutShift(c.vw, c.vh, c.pairs);
      expect(got.impact).toBeCloseTo(want.impact, 12);
      expect(got.distance).toBeCloseTo(want.distance, 12);
      expect(got.score).toBeCloseTo(want.score, 12);
    }
    // case 2 by hand: 2 × (200×100) − the 140×80 overlap, plus 100×150 = 43,800 of 480,000; farthest move 60 px of 800
    expect(layoutShift(cases[1].vw, cases[1].vh, cases[1].pairs).score).toBeCloseTo((43800 / 480000) * (60 / 800), 12);
  });

  test('CLS scenario: every shift score and session window matches an independent recomputation', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('tab-cls').click();
    const C = await V(page, 'cls');
    expect(C.shifts.map((s: any) => s.id)).toEqual(['font', 'img', 'ad', 'tap', 'bar']);
    for (const s of C.shifts) {
      const want = layoutShift(C.viewport.w, C.viewport.h, s.pairs);
      expect(s.impact).toBeCloseTo(want.impact, 12);
      expect(s.distance).toBeCloseTo(want.distance, 12);
      expect(s.score).toBeCloseTo(want.score, 12);
    }
    // the tap at 3000 ms caused the 3100 ms shift: excluded as recent input
    expect(C.shifts.find((s: any) => s.id === 'tap').hadRecentInput).toBe(true);
    const counted = C.shifts.filter((s: any) => !s.hadRecentInput);
    const w = windows(counted);
    expect(C.windows.map((x: any) => x.ids.length)).toEqual(w.out.map((x) => x.n));
    expect(C.windows.map((x: any) => x.start)).toEqual([450, 5200]);
    expect(C.cls).toBeCloseTo(w.cls, 12);
    // font 24 px: union 248..640 of a 328-wide column → hand-checked
    expect(C.shifts[0].score).toBeCloseTo(((392 * 328) / (360 * 640)) * (24 / 640), 12);
    await expect(page.getByTestId('cls-result')).toHaveAttribute('data-rating', 'poor');
    await expect(page.getByTestId('cls-rows').locator('tr.excluded')).toHaveCount(1);
    await expect(page.getByTestId('film').locator('figure')).toHaveCount(5);
    await expect(page.getByTestId('cls-windows')).toContainText('Window 1: 450–1700 ms, 3 shifts');
  });

  test('session windows: 1 s gap and 5 s cap, both on the boundary', async ({ page }) => {
    await page.goto(URL_);
    const sets = {
      steady: [0, 900, 1800, 2700, 3600, 4500, 5400].map((t, i) => ({ id: 's' + i, t, score: 0.01 * (i + 1) })),
      gap: [{ id: 'a', t: 0, score: 0.05 }, { id: 'b', t: 999, score: 0.05 }, { id: 'c', t: 1999, score: 0.02 }, { id: 'd', t: 2999, score: 0.2 }],
      cap: [{ id: 'a', t: 0, score: 0.1 }, { id: 'b', t: 800, score: 0.1 }, { id: 'c', t: 1600, score: 0.1 }, { id: 'd', t: 2400, score: 0.1 }, { id: 'e', t: 3200, score: 0.1 }, { id: 'f', t: 4000, score: 0.1 }, { id: 'g', t: 4800, score: 0.1 }, { id: 'h', t: 5000, score: 0.1 }],
    };
    for (const [name, shifts] of Object.entries(sets)) {
      const got = await page.evaluate((s) => (window as any).__vitals.api.sessionWindows(s), shifts);
      const want = windows(shifts);
      expect(got.windows.map((x: any) => x.ids.length), name).toEqual(want.out.map((x) => x.n));
      expect(got.cls, name).toBeCloseTo(want.cls, 12);
    }
    const steady = await page.evaluate((s) => (window as any).__vitals.api.sessionWindows(s), sets.steady);
    expect(steady.windows.map((x: any) => x.ids.length)).toEqual([6, 1]);          // 5400 − 0 ≥ 5 s
    const gap = await page.evaluate((s) => (window as any).__vitals.api.sessionWindows(s), sets.gap);
    expect(gap.windows.map((x: any) => x.ids.length)).toEqual([2, 1, 1]);          // a gap of exactly 1000 ms is not < 1 s
    const cap = await page.evaluate((s) => (window as any).__vitals.api.sessionWindows(s), sets.cap);
    expect(cap.windows.map((x: any) => x.ids.length)).toEqual([7, 1]);             // the shift at exactly 5000 ms starts a new window
  });

  test('CLS fixes: reserved space brings it down to good, and a shift near a tap is excluded', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('tab-cls').click();
    await page.getByTestId('fix-img').check();
    await page.getByTestId('fix-ad').check();
    await page.getByTestId('fix-font').check();
    let C = await V(page, 'cls');
    expect(C.shifts.map((s: any) => s.id)).toEqual(['tap', 'bar']);
    const bar = C.shifts[1];
    expect(bar.score).toBeCloseTo(((640 * 328) / (360 * 640)) * (48 / 640), 12);
    await expect(page.getByTestId('cls-result')).toHaveAttribute('data-rating', 'good');
    await page.getByTestId('fix-bar').check();
    await expect(page.getByTestId('cls-result')).toContainText(/^CLS \(largest session window\)0Good/);
    // un-reserve the ad and move it to 300 ms after the tap: it is excluded as recent input
    await page.getByTestId('fix-ad').uncheck();
    await page.getByTestId('ev-ad').fill('3300');
    C = await V(page, 'cls');
    const ad = C.shifts.find((s: any) => s.id === 'ad');
    expect(ad.hadRecentInput).toBe(true);
    expect(C.cls).toBe(0);
    await page.getByTestId('ev-ad').fill('3550');                // 550 ms after the tap: counted
    C = await V(page, 'cls');
    expect(C.shifts.find((s: any) => s.id === 'ad').hadRecentInput).toBe(false);
    expect(C.cls).toBeGreaterThan(0);
  });

  test('p75 uses nearest rank: seeded samples, hand-made lists, and bad input', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('tab-p75').click();
    let P = await V(page, 'p75');
    const samples = (await page.getByTestId('p-data').inputValue()).split(/[\s,]+/).filter(Boolean).map(Number);
    expect(samples.length).toBe(200);
    expect(P.p75).toBe(nearestRankP75(samples));
    expect(P.rank).toBe(150);
    const good = samples.filter((v) => v <= 2500).length;
    expect(P.share.good).toBe(good);
    await expect(page.getByTestId('p-result')).toHaveAttribute('data-rating', good / 200 >= 0.75 ? 'good' : /needs-improvement|poor/);
    // 1..8: rank ⌈6⌉ = 6
    await page.getByTestId('p-data').fill('8 1 7 2 6 3 5 4');
    await page.getByTestId('p-calc').click();
    await expect(page.getByTestId('p-result')).toContainText('p75 of 8 samples (rank 6)');
    expect((await V(page, 'p75')).p75).toBe(6);
    // 5 values: rank ⌈3.75⌉ = 4; plus junk that is ignored
    await page.getByTestId('p-data').fill('100, 300, abc, 200, -5, 500, 400');
    await page.getByTestId('p-calc').click();
    P = await V(page, 'p75');
    expect(P.p75).toBe(nearestRankP75([100, 300, 200, 500, 400]));
    expect(P.p75).toBe(400);
    expect(P.ignored).toBe(2);
    await expect(page.getByTestId('p-share')).toContainText('2 values ignored');
    // CLS: 3 of 4 good → p75 still good; the next value decides
    await page.getByTestId('p-metric').selectOption('CLS');
    await page.getByTestId('p-data').fill('0.01 0.05 0.1 0.3');
    await page.getByTestId('p-calc').click();
    await expect(page.getByTestId('p-result')).toHaveAttribute('data-rating', 'good');
    await page.getByTestId('p-data').fill('0.01 0.05 0.11 0.3');
    await page.getByTestId('p-calc').click();
    await expect(page.getByTestId('p-result')).toHaveAttribute('data-rating', 'needs-improvement');
  });

  test('?seed repeats the sample set, and the tabs work from the keyboard', async ({ page }) => {
    await page.goto(`${URL_}?seed=7`);
    const a = (await V(page, 'p75')).p75;
    await page.goto(`${URL_}?seed=7`);
    expect((await V(page, 'p75')).p75).toBe(a);
    await page.goto(`${URL_}?seed=8`);
    const b = await page.evaluate(() => (window as any).__vitals.api.genSamples('LCP', 8).join());
    const c = await page.evaluate(() => (window as any).__vitals.api.genSamples('LCP', 7).join());
    expect(b).not.toBe(c);
    await page.getByTestId('tab-lcp').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-inp')).toBeFocused();
    await expect(page.getByTestId('tab-inp')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#p-inp')).toBeVisible();
    await expect(page.locator('#p-lcp')).toBeHidden();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('tab-p75')).toBeFocused();
  });
});
