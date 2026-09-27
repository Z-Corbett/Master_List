import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/157-basel-foundation.html?seed=7';
const CREDIT = "Inspired by the foundation program at the Basel School of Design as documented in Manfred Maier's Basic Principles of Design (1977). All exercises, text and images here are original.";
const ARCHIVE = 'https://archive.org/details/basicprincipleso0003maie';

/** Weight, centroid and the other composition measures, recomputed from the shapes actually drawn in the SVG. */
function compOracle(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid=comp-svg] [data-kind]')];
    const cs = els.map((e) => {
      const n = (a: string) => Number(e.getAttribute(a));
      if (e.tagName === 'circle') return { a: Math.PI * n('r') ** 2, x: n('cx'), y: n('cy') };
      return { a: n('width') * n('height'), x: n('x') + n('width') / 2, y: n('y') + n('height') / 2 };
    });
    const A = cs.reduce((s, c) => s + c.a, 0);
    const cx = cs.reduce((s, c) => s + c.a * c.x, 0) / A, cy = cs.reduce((s, c) => s + c.a * c.y, 0) / A;
    const balance = 1 - Math.min(1, Math.hypot(cx - 6, cy - 6) / 6);
    const nn = cs.map((p, i) => Math.min(...cs.filter((_, j) => j !== i).map((q) => Math.hypot(p.x - q.x, p.y - q.y))));
    const m = nn.reduce((s, d) => s + d, 0) / nn.length;
    const sd = Math.sqrt(nn.reduce((s, d) => s + (d - m) ** 2, 0) / nn.length);
    const tension = cs.reduce((s, p) => s + 1 - Math.min(p.x, 12 - p.x, p.y, 12 - p.y) / 6, 0) / cs.length;
    return { n: cs.length, cx, cy, balance, density: A / 144, rhythm: cs.length >= 3 ? Math.max(0, 1 - sd / m) : null, tension };
  });
}
const metrics = (page: Page) => page.evaluate(() => (window as any).__basel.comp.metrics());
const shoelace = (d: string) => {
  const pts = d.replace(/[MZ]/g, '').split('L').map((p) => p.split(',').map(Number));
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
};

test.describe('157 Basel Foundation', () => {
  test('01 point, line, plane: centroid, balance, density, rhythm and tension match a computation from the drawn shapes', async ({ page }) => {
    await page.goto(URL);
    // The static preset is symmetric about both axes, so its weight sits exactly on the centre.
    await page.getByTestId('preset-static').click();
    let o = await compOracle(page), m = await metrics(page);
    expect(o.n).toBe(8);
    expect(o.cx).toBeCloseTo(6, 9);
    expect(o.cy).toBeCloseTo(6, 9);
    expect(m.balance).toBeCloseTo(1, 9);
    await expect(page.getByTestId('comp-balance')).toHaveText('100%');

    // A square on the left edge and a dot on the right edge of the same row: the square is heavier (0.8² = 0.64 vs π·0.4² ≈ 0.503),
    // so the centroid sits left of centre, on the row's centre line.
    await page.getByTestId('comp-clear').click();
    await page.locator('[data-testid=comp-svg] [data-cell="0,5"]').click();
    await page.getByRole('button', { name: '● Dot' }).click();
    await page.locator('[data-testid=comp-svg] [data-cell="11,5"]').click();
    o = await compOracle(page); m = await metrics(page);
    const hand = (0.64 * 0.5 + Math.PI * 0.16 * 11.5) / (0.64 + Math.PI * 0.16);
    expect(o.cx).toBeCloseTo(hand, 9);
    expect(m.cx).toBeCloseTo(hand, 9);
    expect(m.cy).toBeCloseTo(5.5, 9);
    expect(m.cx).toBeLessThan(6);

    // Add bars and check every measure against the oracle, and the readouts against it.
    await page.getByRole('button', { name: '▬ Bar across' }).click();
    await page.locator('[data-testid=comp-svg] [data-cell="8,10"]').click(); // clamped: a 3-wide bar starting at column 9 still fits
    await page.getByRole('button', { name: '▮ Bar down' }).click();
    await page.locator('[data-testid=comp-svg] [data-cell="3,1"]').click();
    o = await compOracle(page); m = await metrics(page);
    expect(o.n).toBe(4);
    for (const k of ['cx', 'cy', 'balance', 'density', 'rhythm', 'tension'] as const) expect(m[k], k).toBeCloseTo(o[k] as number, 9);
    await expect(page.getByTestId('comp-balance')).toHaveText(`${Math.round(o.balance * 100)}%`);
    await expect(page.getByTestId('comp-centroid')).toContainText(`${o.cx.toFixed(2)}, ${o.cy.toFixed(2)}`);
    await expect(page.getByTestId('comp-density')).toHaveText(`${Math.round(o.density * 100)}%`);
    await expect(page.getByTestId('comp-rhythm')).toHaveText(`${Math.round(o.rhythm! * 100)}%`);
    await expect(page.getByTestId('comp-tension')).toHaveText(`${Math.round(o.tension * 100)}%`);
    // the red centroid mark is drawn where the weight is (40 px per cell)
    const mark = page.getByTestId('centroid-mark');
    expect(Number(await mark.getAttribute('cx'))).toBeCloseTo(o.cx * 40, 6);
    expect(Number(await mark.getAttribute('cy'))).toBeCloseTo(o.cy * 40, 6);
  });

  test('01 crit, presets, keyboard placement and seeded variations', async ({ page }) => {
    await page.goto(URL);
    const crit = page.getByTestId('crit-1');
    await expect(crit).toContainText('empty field');
    // one square in the top-left cell: weight high-left, so the crit says to move something down-right
    await page.locator('[data-testid=comp-svg] [data-cell="0,0"]').click();
    await expect(crit).toContainText('weight sits high-left');
    await expect(crit).toContainText('Move one element down-right');
    await page.getByTestId('preset-static').click();
    await expect(crit).toContainText('almost exactly on the centre');
    const staticT = (await metrics(page)).tension;
    await page.getByTestId('preset-tension').click();
    const tense = await metrics(page);
    expect(tense.tension).toBeGreaterThan(staticT + 0.3);
    await expect(crit).toContainText('press hard against the edges');
    await page.getByTestId('preset-rhythm').click();
    const rh = await metrics(page);
    expect(rh.rhythm).toBeGreaterThan(0.85);
    await expect(crit).toContainText('very regular');

    // keyboard: focus the grid, move the cursor three right and two down, press Enter
    await page.getByTestId('comp-clear').click();
    await page.getByTestId('comp-svg').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as any).__basel.comp.items())).toEqual([{ t: 'sq', c: 3, r: 2 }]);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as any).__basel.comp.items())).toEqual([]);

    // variations: six, adoptable, and the same for the same seed and composition
    await page.getByTestId('preset-dynamic').click();
    await page.getByTestId('variations').click();
    await expect(page.getByTestId('comp-vars').locator('button')).toHaveCount(6);
    const vars = await page.evaluate(() => (window as any).__basel.comp.vars());
    const gen = await page.evaluate(() => (window as any).__basel.generate(7).variations);
    expect(vars).toEqual(gen);
    await page.getByTestId('var-2').click();
    expect(await page.evaluate(() => (window as any).__basel.comp.items())).toEqual(vars[2].items);
  });

  test('02 memory drawing: shown for exactly 3 s under page.clock, then scored by IoU against a hand-computed case', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-27T10:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-27T10:00:05Z'));
    const st = () => page.evaluate(() => (window as any).__basel.memory.state());
    const svg = page.getByTestId('mem-svg');
    // drawing before Start does nothing
    await svg.locator('[data-cell="1,1"]').click();
    expect((await st()).user).toEqual([]);
    await expect(page.getByTestId('mem-status')).toContainText('Press Start first');

    // Target: a 2×2 block at (2,2) and a 3×1 bar at (5,6), 7 cells.
    const target = ['2,2', '3,2', '2,3', '3,3', '5,6', '6,6', '7,6'];
    await page.evaluate((t) => (window as any).__basel.memory.useTarget(t), target);
    await page.getByTestId('mem-start').click();
    expect((await st()).phase).toBe('show');
    await expect(svg.locator('[data-target]')).toHaveCount(7);
    await expect(page.getByTestId('mem-count')).toHaveText('3');
    await page.clock.runFor(2999);
    expect((await st()).phase).toBe('show');
    await expect(page.getByTestId('mem-count')).toHaveText('1');
    await page.clock.runFor(1);
    expect((await st()).phase).toBe('recall');
    await expect(svg.locator('[data-target]')).toHaveCount(0);

    // Redraw: the block one cell too far right, the bar exactly right.
    await page.getByTestId('brush-2x2').click();
    await svg.locator('[data-cell="3,2"]').click();
    await page.getByTestId('brush-3x1').click();
    await svg.locator('[data-cell="5,6"]').click();
    expect((await st()).user).toEqual(['3,2', '3,3', '4,2', '4,3', '5,6', '6,6', '7,6']);
    await page.clock.runFor(4200);
    await page.getByTestId('mem-check').click();
    // By hand: shared = {3,2} {3,3} {5,6} {6,6} {7,6} = 5; union = 7 + 7 − 5 = 9; IoU = 5/9 = 55.6 %.
    const r = (await st()).result;
    expect(r.inter).toBe(5);
    expect(r.union).toBe(9);
    expect(r.iou).toBeCloseTo(5 / 9, 12);
    expect(r.secs).toBeCloseTo(4.2, 9);
    await expect(page.getByTestId('mem-iou')).toHaveText('56%');
    await expect(page.getByTestId('mem-time')).toHaveText('4.2 s');
    await expect(svg.locator('[data-answer]')).toHaveCount(7);
    await expect(page.getByTestId('crit-2')).toContainText('You left out 2 cells of the original and added 2');
    await expect(page.getByTestId('crit-2')).toContainText('drifted right');

    // Without a custom target the picture is seeded: the medium level shows 3 shapes' worth of cells, and Start again gives a new one.
    await page.evaluate(() => (window as any).__basel.memory.useTarget(null));
    await page.getByTestId('mem-start').click();
    const a = (await st()).target;
    expect(a.length).toBeGreaterThan(2);
    await page.clock.runFor(3000);
    expect((await st()).phase).toBe('recall');
  });

  test('03 perspective: every receding edge is collinear with its vanishing point in 1-, 2- and 3-point, before and after moving the handles', async ({ page }) => {
    await page.goto(URL);
    const check = () => page.evaluate(() => {
      const svg = document.querySelector('[data-testid=persp-svg]')!;
      const vp: Record<string, { x: number; y: number }> = {};
      svg.querySelectorAll('[data-handle]').forEach((h) => {
        if (h.getAttribute('display') === 'none') return;
        const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(h.getAttribute('transform')!)!;
        vp[h.getAttribute('data-handle')!] = { x: Number(m[1]), y: Number(m[2]) };
      });
      const hz = Number(svg.querySelector('[data-horizon]')!.getAttribute('y1'));
      let worst = 0; const kinds: Record<string, number> = {};
      const edges = [...svg.querySelectorAll('line[data-edge]')];
      for (const e of edges) {
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => Number(e.getAttribute(a)));
        const k = e.getAttribute('data-vp')!; kinds[k] = (kinds[k] || 0) + 1;
        let dev: number;
        if (k === 'h') dev = Math.abs(y1 - y2);
        else if (k === 'v') dev = Math.abs(x1 - x2);
        else { const q = vp[k]; dev = Math.abs((x2 - x1) * (q.y - y1) - (y2 - y1) * (q.x - x1)) / Math.hypot(x2 - x1, y2 - y1); }
        worst = Math.max(worst, dev);
      }
      return { worst, kinds, n: edges.length, vp, hz };
    });
    // 1-point: fronts and backs are true rectangles; all 8 depth edges run to C, which sits on the horizon
    await page.getByTestId('pmode-1').click();
    let c = await check();
    expect(c.n).toBe(24);
    expect(c.kinds).toEqual({ h: 8, v: 8, C: 8 });
    expect(c.worst).toBeLessThan(1e-6);
    expect(c.vp.C.y).toBe(c.hz);
    await page.getByTestId('h-C').focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await page.getByTestId('h-hz').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    c = await check();
    expect(c.vp.C).toEqual({ x: 280, y: 190 });
    expect(c.worst).toBeLessThan(1e-6);

    // 2-point: verticals stay vertical, the rest run to L or R, both on the horizon
    await page.getByTestId('pmode-2').click();
    c = await check();
    expect(c.kinds).toEqual({ v: 8, L: 8, R: 8 });
    expect(c.worst).toBeLessThan(1e-6);
    expect([c.vp.L.y, c.vp.R.y]).toEqual([c.hz, c.hz]);
    await page.getByTestId('h-L').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.getByTestId('h-R').focus();
    await page.keyboard.press('ArrowLeft');
    c = await check();
    expect([c.vp.L.x, c.vp.R.x]).toEqual([105, 550]);
    expect(c.worst).toBeLessThan(1e-6);
    await expect(page.getByTestId('p-dev')).toHaveText('0.00 px');

    // 3-point: the verticals converge on V below the horizon, and the constructed back corner still lands on every line
    await page.getByTestId('pmode-3').click();
    c = await check();
    expect(c.kinds).toEqual({ V: 8, L: 8, R: 8 });
    expect(c.vp.V.y).toBeGreaterThan(c.hz);
    expect(c.worst).toBeLessThan(1e-6);
    await page.getByTestId('h-V').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    c = await check();
    expect(c.vp.V.x).toBe(220);
    expect(c.worst).toBeLessThan(1e-6);
    await expect(page.getByTestId('crit-3')).toContainText('third vanishing point');

    // construction lines toggle
    const cons = page.getByTestId('persp-svg').locator('[data-construct]');
    await expect(cons).toHaveAttribute('display', 'inline');
    await page.getByTestId('p-construct').click();
    await expect(cons).toHaveAttribute('display', 'none');
  });

  test('04 lettering: straight-to-straight pairs keep the reference gap, and the model evens out the white area between letters', async ({ page }) => {
    await page.goto(URL);
    const areas = () => page.getByTestId('letter-svg').locator('[data-area]').evaluateAll((els) => els.map((e) => e.getAttribute('d')!));
    const state = () => page.evaluate(() => (window as any).__basel.letter.state());
    // MINIMAL: M, I and N all have full-height stems on both sides, so the model leaves those gaps at the reference
    let s = await state();
    expect(s.word).toBe('MINIMAL');
    expect(s.ref).toBeCloseTo(1.2 * 14 + 4, 12);
    for (const p of s.pairs.slice(0, 4)) expect(p.model, p.pair).toBeCloseTo(s.ref, 9);
    // …while M–A and A–L open up white on A's sloping side, so the model closes those gaps
    expect(s.pairs[4].model).toBeLessThan(s.ref - 5);
    expect(s.pairs[5].model).toBeLessThan(s.ref - 5);

    // AVIATION spaced "by ruler": the red areas are far from even
    await page.getByTestId('l-word').selectOption('AVIATION');
    let a = (await areas()).map(shoelace);
    expect(a).toHaveLength(7);
    expect(Math.max(...a) / Math.min(...a)).toBeGreaterThan(1.5);
    s = await state();
    expect(s.pairs[0].pair).toBe('AV');
    expect(s.pairs[0].model).toBeLessThan(0);          // A and V have to overlap their boxes to look evenly spaced
    await page.getByTestId('l-compare').click();
    await expect(page.getByTestId('l-score')).toHaveText(/\d+ \/ 100/);
    // apply the model: every drawn area is now the same size (checked with the shoelace formula on the drawn outlines)
    await page.getByTestId('l-apply').click();
    a = (await areas()).map(shoelace);
    for (const v of a) expect(v / a[0]).toBeCloseTo(1, 2);
    await expect(page.getByTestId('l-even')).toHaveText('100%');
    await expect(page.getByTestId('l-score')).toHaveText('100 / 100');
    await expect(page.getByTestId('crit-4')).toContainText('even');

    // gap sliders move the letters; weight and contrast set the stem : hairline readout (20 × (1 − 0.5) = 10)
    await page.getByTestId('gap-0').fill('30');
    expect((await state()).pairs[0].gap).toBe(30);
    await page.locator('#lW').fill('20');
    await page.locator('#lC').fill('0.5');
    await expect(page.getByTestId('l-ratio')).toHaveText('20 : 10.0');
  });

  test('05 nature: default divergence is the golden angle, abstracted seeds sit exactly on r = c√k, θ = k·137.5077°', async ({ page }) => {
    await page.goto(URL);
    const phi = (1 + Math.sqrt(5)) / 2;
    const golden = 360 * (1 - 1 / phi);                      // 137.50776405…°
    expect(golden).toBeCloseTo(137.5077640500378, 10);
    const s = await page.evaluate(() => (window as any).__basel.nature.state());
    expect(s.angle).toBeCloseTo(golden, 10);
    await expect(page.getByTestId('n-angle-r')).toHaveText('137.508°');
    await page.getByTestId('n-abs').fill('1');
    const pts = await page.getByTestId('seeds').locator('circle').evaluateAll((els) => els.map((e) => [Number(e.getAttribute('data-k')), Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]));
    expect(pts).toHaveLength(300);
    const c = 185 / Math.sqrt(300), rad = golden * Math.PI / 180;
    for (const [k, x, y] of pts) {
      expect(x).toBeCloseTo(200 + c * Math.sqrt(k) * Math.cos(k * rad), 2);
      expect(y).toBeCloseTo(200 + c * Math.sqrt(k) * Math.sin(k * rad), 2);
    }
    // the visible spirals (index gaps to the two nearest neighbours) are Fibonacci numbers
    const fib = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
    const sp = (await page.evaluate(() => (window as any).__basel.nature.state())).spirals;
    expect(fib).toContain(sp[0]);
    expect(fib).toContain(sp[1]);
    expect(sp[0]).toBeLessThan(sp[1]);
    await expect(page.getByTestId('crit-5')).toContainText('Golden angle');
    // half a degree off golden: the crit notices and evenness drops
    const even = async () => Number((await page.locator('#nEven').textContent())!.replace('%', ''));
    const e0 = await even();
    await page.getByTestId('n-angle').fill('137');
    expect(await even()).toBeLessThan(e0);
    await expect(page.getByTestId('crit-5')).toContainText('off golden');
    await page.getByTestId('n-golden').click();
    expect((await page.evaluate(() => (window as any).__basel.nature.state())).angle).toBeCloseTo(golden, 10);
    // venation mode draws veins
    await page.getByTestId('nmode-vein').click();
    expect(await page.getByTestId('veins').locator('path').count()).toBeGreaterThanOrEqual(14);
  });

  test('07 textile: straight, half-drop and brick repeats are seamless, pixel for pixel', async ({ page }) => {
    await page.goto(URL);
    // the lattice of each repeat, from its definition (80 px tile)
    const LAT: Record<string, number[][]> = { straight: [[80, 0], [0, 80]], halfdrop: [[80, 40], [0, 80]], brick: [[80, 0], [40, 80]] };
    const tiles: Record<string, number[]> = {};
    for (const rep of ['straight', 'halfdrop', 'brick']) {
      await page.getByTestId('rep-' + rep).click();
      const st = await page.evaluate(() => (window as any).__basel.textile.state());
      expect(st.rep).toBe(rep);
      expect(st.crossing).toBeGreaterThanOrEqual(1);      // at least one element crosses the tile edge, so wrapping is exercised
      const r = await page.evaluate((lat) => {
        const cv = document.querySelector('[data-testid=pattern-canvas]') as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, 0, 480, 480).data;
        // 1. translation by each lattice vector maps the pattern onto itself
        const shifts = lat.map(([vx, vy]) => {
          let bad = 0;
          for (let y = 0; y + vy < 480; y++) for (let x = 0; x + vx < 480; x++) {
            const i = (y * 480 + x) * 4, j = ((y + vy) * 480 + x + vx) * 4;
            if (d[i] !== d[j] || d[i + 1] !== d[j + 1] || d[i + 2] !== d[j + 2]) bad++;
          }
          return bad;
        });
        // 2. the tiled pattern equals the motif drawn continuously across the plane: no seams anywhere
        const ref = (window as any).__basel.textile.continuous();
        let seam = 0, maxd = 0;
        for (let i = 0; i < d.length; i += 4) { const dd = Math.max(Math.abs(d[i] - ref[i]), Math.abs(d[i + 1] - ref[i + 1]), Math.abs(d[i + 2] - ref[i + 2])); if (dd > 0) seam++; maxd = Math.max(maxd, dd); }
        let fig = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) fig++;
        const tile = Array.from((document.querySelector('[data-testid=tile-canvas]') as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 160, 160).data);
        return { shifts, seam, maxd, fig, tile };
      }, LAT[rep]);
      expect(r.shifts, `${rep} lattice translation`).toEqual([0, 0]);
      expect(r.seam, `${rep} vs continuous motif (max channel diff ${r.maxd})`).toBe(0);
      expect(r.fig).toBeGreaterThan(1000);                 // there is real figure on the ground, not a blank canvas
      tiles[rep] = r.tile;
    }
    // the wrap depends on the repeat: the same motif makes a different tile for each
    expect(tiles.straight).not.toEqual(tiles.halfdrop);
    expect(tiles.straight).not.toEqual(tiles.brick);
    // adding a dot on the tile edge keeps it seamless
    await page.getByTestId('tile-canvas').click({ position: { x: 1, y: 40 } });
    const after = await page.evaluate(() => (window as any).__basel.textile.state());
    expect(after.motif.length).toBeGreaterThan(5);
    await expect(page.getByTestId('crit-7')).toContainText('brick');
  });

  test('08 colour: the contrast swatches are one identical colour on both grounds, and the OKLCH scale matches the browser', async ({ page }) => {
    await page.goto(URL);
    const sw = page.getByTestId('contrast-svg').locator('[data-swatch]');
    await expect(sw).toHaveCount(2);
    const fills = await sw.evaluateAll((els) => els.map((e) => [e.getAttribute('fill'), getComputedStyle(e).fill]));
    expect(fills[0]).toEqual(fills[1]);
    // An achromatic OKLCH colour has linear sRGB = L³ in every channel; encode with the sRGB transfer function.
    const enc = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
    const v = Math.round(enc(0.6 ** 3) * 255).toString(16).padStart(2, '0');
    expect(fills[0][0]).toBe(`#${v}${v}${v}`);
    // Rasterise the SVG itself and sample: identical pixels in both swatches, different grounds.
    for (const ground of ['0', '1', '2']) {
      await page.getByTestId('c-ground').selectOption(ground);
      const px = await page.evaluate(async () => {
        const svg = document.querySelector('[data-testid=contrast-svg]')!;
        const s = new XMLSerializer().serializeToString(svg);
        const img = new Image();
        img.src = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
        await img.decode();
        const cv = document.createElement('canvas'); cv.width = 480; cv.height = 240;
        const x = cv.getContext('2d')!; x.drawImage(img, 0, 0, 480, 240);
        const at = (a: number, b: number) => Array.from(x.getImageData(a, b, 1, 1).data);
        return { s0: at(120, 120), s1: at(360, 120), g0: at(20, 20), g1: at(460, 20) };
      });
      expect(px.s0, `ground set ${ground}`).toEqual(px.s1);
      expect(px.g0).not.toEqual(px.g1);
    }
    await page.getByTestId('c-reveal').click();
    const bridge = page.getByTestId('contrast-svg').locator('[data-bridge]');
    await expect(bridge).toHaveAttribute('fill', fills[0][0]!);
    await expect(page.getByTestId('c-status')).toContainText(fills[0][0]!);
    await expect(page.getByTestId('crit-8')).toContainText('as the bar proves');

    // OKLCH value scale: nine equal lightness steps, and each in-gamut swatch matches the browser's own oklch() conversion
    const steps = await page.getByTestId('oklch-scale').locator('[data-l]').evaluateAll((els) => els.map((e) => ({ L: Number(e.getAttribute('data-l')), hex: e.getAttribute('data-hex')!, ok: e.getAttribute('data-in-gamut') === '1' })));
    expect(steps.map((s) => s.L)).toEqual([0.3, 0.375, 0.45, 0.525, 0.6, 0.675, 0.75, 0.825, 0.9]);
    const inGamut = steps.filter((s) => s.ok);
    expect(inGamut.length).toBeGreaterThanOrEqual(6);
    const browser = await page.evaluate((ls) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const x = cv.getContext('2d', { willReadFrequently: true })!;
      return ls.map((L) => { x.fillStyle = '#000'; x.fillStyle = `oklch(${L} 0.08 250)`; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3); });
    }, inGamut.map((s) => s.L));
    inGamut.forEach((s, i) => {
      const mine = [1, 3, 5].map((k) => parseInt(s.hex.slice(k, k + 2), 16));
      mine.forEach((m, ch) => expect(Math.abs(m - browser[i][ch]), `L ${s.L} channel ${ch}: ${s.hex} vs ${browser[i]}`).toBeLessThanOrEqual(2));
    });
    // lightness goes up step by step
    const lum = steps.map((s) => parseInt(s.hex.slice(1, 3), 16) + parseInt(s.hex.slice(3, 5), 16) + parseInt(s.hex.slice(5, 7), 16));
    for (let i = 1; i < lum.length; i++) expect(lum[i]).toBeGreaterThan(lum[i - 1]);
  });

  test('portfolio: print CSS shows only the A4 sheet with all eight studios', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-dynamic').click();
    await page.getByTestId('pf-collect').click();
    const figs = page.getByTestId('sheet').locator('figure');
    await expect(figs).toHaveCount(8);
    await expect(figs.first()).toContainText('Balance');
    await page.emulateMedia({ media: 'print' });
    for (const sel of ['#s1', '#s4', '#s8', '.mast', 'footer.credit']) await expect(page.locator(sel)).toBeHidden();
    await expect(page.getByTestId('back-link')).toBeHidden();
    await expect(page.getByTestId('pf-collect')).toBeHidden();
    await expect(page.getByTestId('sheet')).toBeVisible();
    const box = await page.getByTestId('sheet').boundingBox();
    expect(box!.width).toBeCloseTo(190 * 96 / 25.4, 0);   // 190 mm at 96 px per inch
    expect(box!.height).toBeCloseTo(277 * 96 / 25.4, 0);
    const loaded = await figs.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0));
    expect(loaded).toEqual(Array(8).fill(true));
    await expect(page.getByTestId('sheet')).toContainText(CREDIT);
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('#s1')).toBeVisible();
  });

  test('portfolio: downloads a self-contained SVG and a PNG of the sheet', async ({ page }) => {
    await page.goto(URL);
    await page.locator('#pfName').fill('Ada Test');
    const [svgDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pf-svg').click()]);
    expect(svgDl.suggestedFilename()).toBe('basel-foundation-portfolio.svg');
    const svg = readFileSync((await svgDl.path())!, 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Basel Foundation · Ada Test');
    expect(svg.match(/data-studio="0\d"/g)).toHaveLength(8);
    expect(svg).toContain('Basic Principles of Design (1977)');
    // every image is embedded; nothing points at the network
    expect(svg).not.toMatch(/href="https?:/);
    expect((svg.match(/href="data:image\/(svg\+xml|png)/g) || []).length).toBeGreaterThanOrEqual(8);
    const parsed = await page.evaluate((s) => { const d = new DOMParser().parseFromString(s, 'image/svg+xml'); return { err: !!d.querySelector('parsererror'), w: d.documentElement.getAttribute('width'), h: d.documentElement.getAttribute('height') }; }, svg);
    expect(parsed).toEqual({ err: false, w: '794', h: '1123' });   // A4 at 96 dpi
    const [pngDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pf-png').click()]);
    expect(pngDl.suggestedFilename()).toBe('basel-foundation-portfolio.png');
    const png = readFileSync((await pngDl.path())!);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(1588);
    expect(png.readUInt32BE(20)).toBe(2246);
  });

  test('footer credits the program and the book, and links the Internet Archive record without fetching it', async ({ page }) => {
    const hits: string[] = [];
    page.on('request', (r) => { if (r.url().includes('archive.org')) hits.push(r.url()); });
    await page.goto(URL);
    const credit = page.getByTestId('credit-text');
    await expect(credit).toHaveText(CREDIT);
    await expect(credit.locator('cite')).toHaveText('Basic Principles of Design');
    const link = page.getByTestId('archive-link');
    await expect(link).toHaveAttribute('href', ARCHIVE);
    await expect(link).toBeVisible();
    expect(await link.evaluate((a) => a.tagName)).toBe('A');
    await page.waitForLoadState('load');
    expect(hits).toEqual([]);
    // every studio has a crit with something to say
    for (let i = 1; i <= 8; i++) await expect(page.getByTestId(`crit-${i}`)).toHaveText(/\S{3,}/);
  });

  test('same ?seed= gives the same course; another seed gives a different one', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('seed')).toHaveText('7');
    const g = () => page.evaluate(() => (window as any).__basel.generate(7));
    const a = await g(), b = await g();
    expect(a).toEqual(b);
    const other = await page.evaluate(() => (window as any).__basel.generate(8));
    for (const k of Object.keys(a)) expect(other[k], k).not.toEqual(a[k]);
    const snap = () => page.evaluate(() => ({
      tex: document.querySelector('[data-testid=tex-svg]')!.innerHTML,
      motif: (window as any).__basel.textile.state().motif,
      pat: (document.querySelector('[data-testid=pattern-canvas]') as HTMLCanvasElement).toDataURL(),
    }));
    const first = await snap();
    expect(first.motif).toEqual(a.motif);
    await page.reload();
    expect(await snap()).toEqual(first);
    await page.goto('/lab/157-basel-foundation.html?seed=8');
    await expect(page.getByTestId('seed')).toHaveText('8');
    const s8 = await snap();
    expect(s8.tex).not.toBe(first.tex);
    expect(s8.pat).not.toBe(first.pat);
  });
});
