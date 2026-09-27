import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/164-grid-systems.html?seed=7';
const G = (page: Page) => page.evaluate(() => (window as any).__grid.state());
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

/** The grid written out independently: column and row edges from the input values. */
function oracle(s: { w: number; h: number; mt: number; ml: number; mr: number; mb: number; cols: number; rows: number; gutter: number; base: number; lock: boolean }) {
  const measure = s.w - s.ml - s.mr, depth = s.h - s.mt - s.mb;
  const colW = (measure - (s.cols - 1) * s.gutter) / s.cols;
  let rowH: number, rowGap: number;
  if (s.lock) {
    // largest whole number of lines k with rows·k·B + (rows − 1)·B ≤ depth
    let k = 0;
    while (s.rows * (k + 1) * s.base + (s.rows - 1) * s.base <= depth + 1e-9) k++;
    rowH = k * s.base; rowGap = s.base;
  } else { rowGap = s.gutter; rowH = (depth - (s.rows - 1) * s.gutter) / s.rows; }
  const xs: number[] = [], xe: number[] = [], ys: number[] = [], ye: number[] = [];
  for (let c = 0; c < s.cols; c++) { xs.push(s.ml + c * (colW + s.gutter)); xe.push(s.ml + c * (colW + s.gutter) + colW); }
  for (let r = 0; r < s.rows; r++) { ys.push(s.mt + r * (rowH + rowGap)); ye.push(s.mt + r * (rowH + rowGap) + rowH); }
  return { measure, depth, colW, rowH, rowGap, xs, xe, ys, ye };
}
const rects = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => ({
  id: e.getAttribute('data-block') || e.getAttribute('data-module') || '',
  x: Number(e.getAttribute('x')), y: Number(e.getAttribute('y')), w: Number(e.getAttribute('width')), h: Number(e.getAttribute('height')),
})));
async function blocksOnEdges(page: Page) {
  const o = oracle(await G(page));
  const bs = await rects(page, '[data-testid=grid-svg] rect[data-block]');
  expect(bs).toHaveLength(4);
  for (const b of bs) {
    expect(o.xs.some((x) => near(x, b.x)), `${b.id} left ${b.x}`).toBe(true);
    expect(o.xe.some((x) => near(x, b.x + b.w)), `${b.id} right ${b.x + b.w}`).toBe(true);
    expect(o.ys.some((y) => near(y, b.y)), `${b.id} top ${b.y}`).toBe(true);
    expect(o.ye.some((y) => near(y, b.y + b.h)), `${b.id} bottom ${b.y + b.h}`).toBe(true);
  }
  return bs;
}

test.describe('164 Grid Systems', () => {
  test('module maths: columns × width + gutters = measure, and the drawn modules match the formula', async ({ page }) => {
    await page.goto(URL);
    const s = await G(page);
    expect(s).toMatchObject({ w: 595, h: 842, mt: 48, ml: 42, mr: 42, mb: 58, cols: 4, rows: 6, gutter: 12, base: 12, lock: true });
    // By hand for A4: measure = 595 − 84 = 511; column = (511 − 3 × 12) / 4 = 118.75
    const o = oracle(s);
    expect(o.measure).toBe(511);
    expect(o.colW).toBe(118.75);
    await expect(page.getByTestId('r-measure')).toHaveText('511.00 pt');
    await expect(page.getByTestId('r-colw')).toHaveText('118.75 pt');
    await expect(page.getByTestId('r-sum')).toHaveText('4 × 118.75 + 3 × 12.00 = 511.00 = measure 511.00 ✓');
    const mods = await rects(page, '[data-testid=grid-svg] rect[data-module]');
    expect(mods).toHaveLength(24);
    for (let r = 0; r < 6; r++) {
      const row = mods.filter((m) => m.id.endsWith(',' + r)).sort((a, b) => a.x - b.x);
      expect(row).toHaveLength(4);
      expect(row[0].x).toBeCloseTo(42, 6);                                           // starts at the left margin
      expect(row[3].x + row[3].w).toBeCloseTo(595 - 42, 6);                          // ends at the right margin
      expect(row.reduce((a, m) => a + m.w, 0) + 3 * 12).toBeCloseTo(o.measure, 6);   // widths + gutters = measure
      for (let c = 1; c < 4; c++) expect(row[c].x - (row[c - 1].x + row[c - 1].w)).toBeCloseTo(12, 6);
    }
  });

  test('custom grid without the baseline lock: row height from the depth, readouts and a warning about off-baseline rows', async ({ page }) => {
    await page.goto(URL);
    await page.locator('#lock').uncheck();
    for (const [id, v] of [['w', '600'], ['h', '900'], ['mt', '50'], ['ml', '40'], ['mr', '30'], ['mb', '70'], ['cols', '5'], ['rows', '7'], ['gutter', '10'], ['base', '11']]) await page.locator('#' + id).fill(v);
    await expect(page.getByTestId('preset')).toHaveValue('custom');
    const s = await G(page);
    const o = oracle(s);
    // measure 530, column (530 − 40) / 5 = 98; depth 780, row (780 − 60) / 7 = 102.857…
    expect(o.colW).toBe(98);
    expect(o.rowH).toBeCloseTo(720 / 7, 12);
    const m = await page.evaluate(() => (window as any).__grid.metrics());
    expect(m.colW).toBeCloseTo(o.colW, 9);
    expect(m.rowH).toBeCloseTo(o.rowH, 9);
    expect(5 * m.colW + 4 * 10).toBeCloseTo(530, 9);
    expect(7 * m.rowH + 6 * 10).toBeCloseTo(780, 9);
    await expect(page.getByTestId('r-rowh')).toHaveText('102.86 pt');
    await expect(page.getByTestId('r-lines')).toHaveText(`${(o.rowH / 11).toFixed(2)} (not whole)`);
    await expect(page.getByTestId('r-sum')).toContainText('5 × 98.00 + 4 × 10.00 = 530.00');
    // rows that start between baselines, counted independently
    const off = o.ys.filter((y) => { const k = (y - 50) / 11; return Math.abs(k - Math.round(k)) > 1e-6; }).length;
    expect(off).toBeGreaterThan(0);
    await expect(page.getByTestId('r-status')).toContainText(`${off} of 7 rows start between baselines`);
    const mods = await rects(page, '[data-testid=grid-svg] rect[data-module]');
    expect(mods).toHaveLength(35);
    for (const md of mods) { expect(md.w).toBeCloseTo(98, 2); expect(md.h).toBeCloseTo(o.rowH, 2); }
    // a grid that cannot fit says so
    await page.locator('#gutter').fill('200');
    await expect(page.getByTestId('r-sum')).toContainText('does not fit');
    await expect(page.getByTestId('grid-svg').locator('rect')).toHaveCount(0);
  });

  test('baseline lock: modules are whole lines deep, every row and every line of text sits on the baseline grid', async ({ page }) => {
    await page.goto(URL);
    // A4 by hand: depth 736; 6 rows of k lines + 5 one-line gaps must fit: 72k + 60 ≤ 736 → k = 9, rows 108 pt, 28 pt spare.
    await expect(page.getByTestId('r-lines')).toHaveText('9');
    await expect(page.getByTestId('r-rowh')).toHaveText('108.00 pt');
    await expect(page.getByTestId('r-rowgap')).toHaveText('12.00 pt (1 line)');
    await expect(page.getByTestId('r-spare')).toHaveText('28.00 pt');
    for (const preset of ['a4', 'a3', 'letter', 'square']) {
      await page.getByTestId('preset').selectOption(preset);
      const s = await G(page);
      const o = oracle(s);
      const onGrid = (y: number) => { const k = (y - s.mt) / s.base; return Math.abs(k - Math.round(k)) < 1e-6; };
      const mods = await rects(page, '[data-testid=grid-svg] rect[data-module]');
      for (const md of mods) {
        expect(onGrid(md.y), `${preset} module ${md.id} top`).toBe(true);
        expect(md.h / s.base).toBeCloseTo(Math.round(md.h / s.base), 9);
        expect(md.h).toBeCloseTo(o.rowH, 6);
      }
      const ys = await page.locator('[data-testid=grid-svg] text[data-line]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('y'))));
      expect(ys.length).toBeGreaterThan(20);
      for (const y of ys) expect(onGrid(y), `${preset} baseline ${y}`).toBe(true);
      // the drawn baseline rules are B apart, starting one line below the top margin
      const bl = await page.locator('[data-testid=grid-svg] line[data-baseline]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('y1'))));
      bl.forEach((y, i) => expect(y).toBeCloseTo(s.mt + (i + 1) * s.base, 6));
      await expect(page.getByTestId('r-status')).toContainText('Every row starts on a baseline');
    }
    // A3 by hand: depth 1191 − 140 = 1051; 72k + 60 ≤ 1051 → k = 13
    await page.getByTestId('preset').selectOption('a3');
    await expect(page.getByTestId('r-lines')).toHaveText('13');
    await expect(page.getByTestId('tb-module')).toHaveText(`${((842 - 108 - 36) / 4).toFixed(2)} × 156.00 pt`);
  });

  test('snapping: a free rectangle snaps each edge to the nearest module edge (hand-computed cases)', async ({ page }) => {
    await page.goto(URL);
    // Column starts 42, 172.75, 303.5, 434.25; column ends 160.75, 291.5, 422.25, 553. Row starts 48 + 120r; ends 156 + 120r.
    const place = (id: string, raw: object) => page.evaluate(([i, r]) => (window as any).__grid.place(i, r), [id, raw] as const);
    // left 180 → nearest start 172.75 (col 2); right 180 + 250 = 430 → nearest end 422.25 (col 3); top 300 → 288 (row 3); bottom 420 → 396 (row 3)
    expect(await place('image', { x: 180, y: 300, w: 250, h: 120 })).toEqual({ c: 1, r: 2, cs: 2, rs: 1 });
    // right edge pulled before the left edge never makes a negative span
    expect(await place('textA', { x: 440, y: 50, w: 10, h: 10 })).toEqual({ c: 3, r: 0, cs: 1, rs: 1 });
    // far outside the sheet clamps to the last module
    expect(await place('textB', { x: 2000, y: 2000, w: 50, h: 50 })).toEqual({ c: 3, r: 5, cs: 1, rs: 1 });
    await blocksOnEdges(page);
    const img = (await rects(page, '[data-testid=grid-svg] rect[data-block=image]'))[0];
    expect(img).toMatchObject({ x: 172.75, y: 288, w: 422.25 - 172.75, h: 108 });
    // random rectangles, under several grids: every block lands on module edges
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [cols, rows, gutter] of [[4, 6, 12], [7, 5, 9], [3, 8, 18]]) {
      await page.locator('#cols').fill(String(cols)); await page.locator('#rows').fill(String(rows)); await page.locator('#gutter').fill(String(gutter));
      for (const id of ['headline', 'image', 'textA', 'textB']) await place(id, { x: rnd() * 560, y: rnd() * 800, w: 20 + rnd() * 300, h: 20 + rnd() * 400 });
      await blocksOnEdges(page);
    }
  });

  test('dragging a block with the pointer moves it by whole modules and it snaps on the way', async ({ page }) => {
    await page.goto(URL);
    const svg = page.getByTestId('grid-svg');
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    const k = box.width / 595;                                                   // screen px per pt
    expect(box.height / 842).toBeCloseTo(k, 2);                                  // the sheet is drawn without letterboxing
    // the headline block (col 1–3, row 1) dragged right by 140 pt and down by 250 pt: one column step is 130.75, one row step 120
    const x0 = box.x + (42 + 30) * k, y0 = box.y + (48 + 60) * k;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 70 * k, y0 + 125 * k, { steps: 4 });
    await page.mouse.move(x0 + 140 * k, y0 + 250 * k, { steps: 4 });
    await page.mouse.up();
    const s = await G(page);
    // 140 is nearer 130.75 than 261.5 → one column over, but the 3-wide block must still fit in 4 columns; 250 → two rows down
    expect(s.blocks.headline).toEqual({ c: 1, r: 2, cs: 3, rs: 1 });
    expect(s.selected).toBe('headline');
    await blocksOnEdges(page);
    await expect(page.getByTestId('b-status')).toHaveText('Headline: column 2, row 3, 3 × 1 modules.');
  });

  test('keyboard and fields: arrows move the selected block one module, Shift + arrows change its span', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Text A' }).click();
    await expect(page.getByRole('button', { name: 'Text A' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('grid-svg').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    expect((await G(page)).blocks.textA).toEqual({ c: 1, r: 2, cs: 2, rs: 3 });
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowDown');
    expect((await G(page)).blocks.textA).toEqual({ c: 1, r: 2, cs: 1, rs: 4 });
    // the block cannot be pushed off the grid
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    expect((await G(page)).blocks.textA).toEqual({ c: 1, r: 2, cs: 1, rs: 4 });
    await expect(page.getByTestId('b-status')).toHaveText('Text A: column 2, row 3, 1 × 4 modules.');
    // the numeric fields are 1-based and drive the same model
    await expect(page.getByTestId('b-col')).toHaveValue('2');
    await page.getByTestId('b-col').fill('4');
    await page.getByTestId('b-rs').fill('2');
    expect((await G(page)).blocks.textA).toEqual({ c: 3, r: 2, cs: 1, rs: 2 });
    const b = await blocksOnEdges(page);
    const t = b.find((r) => r.id === 'textA')!;
    expect(t.x).toBeCloseTo(434.25, 6);
    expect(t.h).toBeCloseTo(108 * 2 + 12, 6);
    // text lines in the moved block stay on the baseline grid and inside the block
    const ys = await page.locator('[data-testid=grid-svg] text[data-line=textA]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('y'))));
    expect(ys).toHaveLength(19);                                                // 2 rows × 9 lines + the gap line
    ys.forEach((y, i) => expect(y).toBe(288 + 12 * (i + 1)));
  });

  test('posters: every shape, rule and line of type is on a module edge or a baseline, for many seeds and grids', async ({ page }) => {
    await page.goto(URL);
    for (const [cols, rows] of [[4, 6], [6, 8], [3, 4], [1, 1]]) {
      await page.locator('#cols').fill(String(cols)); await page.locator('#rows').fill(String(rows));
      const s = await G(page);
      const o = oracle(s);
      const onGrid = (y: number) => { const k = (y - s.mt) / s.base; return Math.abs(k - Math.round(k)) < 1e-6; };
      for (let sd = 1; sd <= 12; sd++) {
        await page.getByTestId('p-seed').fill(String(sd));
        const items = await page.locator('[data-testid=poster-svg] [data-snap]').evaluateAll((els) => els.map((e) => {
          const n = (a: string) => Number(e.getAttribute(a));
          return { kind: e.getAttribute('data-snap')!, box: e.getAttribute('data-box')!.split(' ').map(Number), tag: e.tagName,
            x: n('x'), y: n('y'), w: n('width'), h: n('height'), cx: n('cx'), cy: n('cy'), r: n('r'), sw: n('stroke-width') || 0,
            lines: [...e.querySelectorAll('text')].map((t) => [Number(t.getAttribute('x')), Number(t.getAttribute('y'))]) };
        }));
        expect(items.filter((i) => i.kind === 'headline')).toHaveLength(1);
        expect(items.filter((i) => i.kind === 'info')).toHaveLength(1);
        for (const it of items) {
          const [bx, by, bw, bh] = it.box, tag = `${cols}×${rows} seed ${sd} ${it.kind}`;
          expect(o.xs.some((x) => near(x, bx)), tag + ' left').toBe(true);
          expect(o.xe.some((x) => near(x, bx + bw)), tag + ' right').toBe(true);
          expect(o.ys.some((y) => near(y, by)), tag + ' top').toBe(true);
          expect(o.ye.some((y) => near(y, by + bh)), tag + ' bottom').toBe(true);
          if (it.kind === 'rect') expect([it.x, it.y, it.w, it.h].map((v, i) => near(v, it.box[i]))).toEqual([true, true, true, true]);
          if (it.kind === 'bar' || it.kind === 'rule') { expect(near(it.x, bx) && near(it.y, by) && near(it.w, bw)).toBe(true); expect(it.h).toBeLessThanOrEqual(s.base); }
          if (it.tag === 'circle') {
            expect(near(it.cx, bx + bw / 2) && near(it.cy, by + bh / 2), tag + ' centred').toBe(true);
            expect(it.r + it.sw / 2).toBeCloseTo(Math.min(bw, bh) / 2, 2);   // touches the module edges it is inscribed in
          }
          if (it.kind === 'headline') { expect(near(it.x, bx)).toBe(true); expect(onGrid(it.y), tag + ' baseline').toBe(true); }
          if (it.kind === 'info') for (const [x, y] of it.lines) { expect(near(x, bx)).toBe(true); expect(onGrid(y), tag + ' info baseline').toBe(true); }
        }
      }
    }
  });

  test('posters are deterministic per seed, across reloads, and Next seed changes the poster', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('seed')).toHaveText('7');
    const svg = () => page.evaluate(() => (window as any).__grid.svg('poster'));
    const a = await svg();
    expect(await page.evaluate(() => JSON.stringify((window as any).__grid.poster(7)))).toBe(await page.evaluate(() => JSON.stringify((window as any).__grid.poster(7))));
    await page.reload();
    expect(await svg()).toBe(a);
    await page.getByTestId('p-next').click();
    await expect(page.getByTestId('seed')).toHaveText('8');
    await expect(page.getByTestId('p-seed')).toHaveValue('8');
    const b = await svg();
    expect(b).not.toBe(a);
    await page.goto('/lab/164-grid-systems.html?seed=8');
    expect(await svg()).toBe(b);
    // the seed drives the choices, not the time or Math.random: twenty seeds give (almost all) different posters
    const specs = await page.evaluate(() => Array.from({ length: 20 }, (_, i) => JSON.stringify((window as any).__grid.poster(i + 1))));
    expect(new Set(specs).size).toBeGreaterThanOrEqual(19);
    await expect(page.getByTestId('p-status')).toContainText('Seed 8');
  });

  test('SVG export: the poster and the layout download as valid, self-contained SVG at the sheet size', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset').selectOption('a3');
    await page.getByTestId('p-overlay').check();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('dl-poster').click()]);
    expect(dl.suggestedFilename()).toBe('grid-poster-seed-7.svg');
    const text = readFileSync((await dl.path())!, 'utf8');
    expect(text.startsWith('<svg')).toBe(true);
    expect(text).not.toMatch(/href="https?:/);
    expect(text).not.toContain('<script');
    const p = await page.evaluate((s) => {
      const d = new DOMParser().parseFromString(s, 'image/svg+xml');
      const r = d.documentElement;
      return { err: !!d.querySelector('parsererror'), ns: r.namespaceURI, w: r.getAttribute('width'), h: r.getAttribute('height'), vb: r.getAttribute('viewBox'),
        snaps: r.querySelectorAll('[data-snap]').length, overlay: r.querySelectorAll('[data-overlay] rect[data-module]').length, title: r.querySelector('title')?.textContent };
    }, text);
    expect(p).toMatchObject({ err: false, ns: 'http://www.w3.org/2000/svg', w: '842', h: '1191', vb: '0 0 842 1191', overlay: 24, title: 'Grid poster, seed 7' });
    expect(p.snaps).toBeGreaterThanOrEqual(5);
    // it renders as an image, too
    const size = await page.evaluate(async (s) => { const i = new Image(); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, text);
    expect(size).toEqual([842, 1191]);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('dl-grid').click()]);
    expect(dl2.suggestedFilename()).toBe('grid-layout.svg');
    const g = readFileSync((await dl2.path())!, 'utf8');
    expect(g).toContain('data-block="image"');
    expect(g).not.toContain('data-selection');
    expect(g).not.toContain('tabindex');
  });

  test('footer credits the grid tradition without reproducing it, and links Services', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('credit')).toContainText('Josef Müller-Brockmann');
    await expect(page.getByTestId('credit').locator('cite')).toHaveText('Grid Systems in Graphic Design');
    await expect(page.getByTestId('credit')).toContainText('(1981)');
    await expect(page.getByTestId('credit')).toContainText('original');
    await expect(page.getByRole('link', { name: 'Services' })).toHaveAttribute('href', '../index.html#services');
    await expect(page.getByTestId('grid-svg')).toHaveAttribute('aria-label', /4 columns by 6 rows/);
    await expect(page.getByTestId('poster-svg')).toHaveAttribute('aria-label', /Poster for seed 7/);
  });
});
