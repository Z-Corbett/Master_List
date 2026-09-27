import { test, expect, Page } from '@playwright/test';

const URL = '/lab/137-fair-isle.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__fair.state);
const GEN = (page: Page, seed: number, W: number, pal = 'shetland') =>
  page.evaluate(([s, w, p]) => (window as any).__fair.generate(s, w, p), [seed, W, pal] as const);

/** Independent float scan, written differently from the page: unroll the round twice, collect
 * maximal runs, keep those that start inside the first copy and aren't the tail of a run from the left. */
function longRuns(cells: number[], max: number) {
  const W = cells.length;
  if (new Set(cells).size < 2) return [] as { start: number; len: number; colour: number }[];
  const out: { start: number; len: number; colour: number }[] = [];
  for (let i = 0; i < W; i++) {
    if (cells[i] === cells[(i + W - 1) % W]) continue; // not the start of a run
    let len = 1;
    while (cells[(i + len) % W] === cells[i]) len++;
    if (len > max) out.push({ start: i + 1, len, colour: cells[i] });
  }
  return out;
}
const setNum = async (page: Page, id: string, v: number) => {
  await page.getByTestId(id).fill(String(v));
  await page.getByTestId(id).press('Enter');
  await page.getByTestId(id).blur();
};

test.describe('137 Fair Isle Chart', () => {
  test('the Fair Isle rule: no row uses more than two colours, across 150 seeds and several widths', async ({ page }) => {
    await page.goto(URL);
    const bad = await page.evaluate(() => {
      const f = (window as any).__fair, problems: string[] = [];
      let rowsChecked = 0;
      for (const W of [48, 60, 72, 96, 120, 44, 100])
        for (let seed = 1; seed <= 150; seed += (W === 72 ? 1 : 7))
          for (const pal of f.palettes) {
            const c = f.generate(seed, W, pal);
            c.rows.forEach((r: any, i: number) => {
              rowsChecked++;
              if (new Set(r.cells).size > 2) problems.push(`${W}/${seed}/${pal} row ${i + 1}`);
            });
          }
      return { problems, rowsChecked };
    });
    expect(bad.rowsChecked).toBeGreaterThan(20000);
    expect(bad.problems).toEqual([]);
    // and the chart on screen is one of them
    const s = await S(page);
    for (const r of s.chart.rows) expect(new Set(r.cells).size).toBeLessThanOrEqual(2);
  });

  test('every motif repeat divides the stitch count, and the cells really repeat with that period', async ({ page }) => {
    await page.goto(URL);
    const charts = await page.evaluate(() => {
      const out: any[] = [];
      for (const W of [48, 60, 72, 96, 120, 44, 52]) for (const seed of [1, 7, 42, 99, 1234]) out.push({ W, seed, c: (window as any).__fair.generate(seed, W, 'shetland') });
      return out;
    });
    const problems: string[] = [];
    let bandsChecked = 0;
    for (const { W, seed, c } of charts) {
      const tag = `${W} st, seed ${seed}`;
      if (c.width !== W) problems.push(`${tag}: width ${c.width}`);
      const types = new Set<string>();
      for (const b of c.bands) {
        bandsChecked++;
        types.add(b.type);
        if (W % b.repeat !== 0) problems.push(`${tag}: ${b.name} repeat ${b.repeat} doesn't divide ${W}`);
        if (b.repeats !== W / b.repeat) problems.push(`${tag}: ${b.name} worked ${b.repeats} times`);
        for (let r = b.startRow - 1; r < b.endRow; r++) {
          const cells = c.rows[r].cells;
          if (cells.length !== W) problems.push(`${tag}: row ${r + 1} has ${cells.length} cells`);
          for (let x = 0; x < W; x++) if (cells[x] !== cells[(x + b.repeat) % W]) { problems.push(`${tag}: row ${r + 1} breaks its ${b.repeat}-stitch period at ${x + 1}`); break; }
        }
      }
      if (!(types.has('seeding') && types.has('peerie'))) problems.push(`${tag}: no seeding or peerie band`);
      if (!(types.has('oxo') || types.has('star'))) problems.push(`${tag}: no big band`);
    }
    expect(bandsChecked).toBeGreaterThan(150);
    expect(problems).toEqual([]);
  });

  test('float warnings match an independent circular run-length scan, for several seeds and limits', async ({ page }) => {
    await page.goto(URL);
    for (const [seed, W, max] of [[7, 72, 5], [3, 48, 3], [11, 96, 5], [25, 60, 7], [7, 72, 2]] as const) {
      const c = await GEN(page, seed, W);
      const pageFloats = await page.evaluate(([s, w, m]) => (window as any).__fair.floats(s, w, m), [seed, W, max] as const);
      const mine = c.rows.flatMap((r: any, i: number) => longRuns(r.cells, max).map((f) => ({ row: i + 1, ...f })));
      const key = (f: any) => `${f.row}:${f.start}:${f.len}:${f.colour}`;
      expect(pageFloats.map(key).sort(), `seed ${seed}, ${W} st, max ${max}`).toEqual(mine.map(key).sort());
      for (const f of pageFloats) {
        expect(f.len).toBeGreaterThan(max);
        const row = c.rows[f.row - 1];
        expect(f.floating).not.toBe(f.colour);
        expect(row.colours).toContain(f.floating);   // the carried colour is the row's other colour
      }
    }
    // a hand-built round: a run crossing the seam counts once, and single-colour rows never float
    expect(longRuns([1, 1, 1, 0, 0, 1, 1, 1], 5)).toEqual([{ start: 6, len: 6, colour: 1 }]);
    expect(longRuns([2, 2, 2, 2, 2, 2, 2], 3)).toEqual([]);
  });

  test('the limit is a strict "longer than": runs of exactly the maximum are fine, one more is flagged', async ({ page }) => {
    await page.goto(URL);
    const c = (await S(page)).chart;
    const runs = c.rows.flatMap((r: any, i: number) => longRuns(r.cells, 1).map((f) => ({ row: i + 1, ...f })));
    const longest = Math.max(...runs.map((f: any) => f.len));
    await setNum(page, 'max-float', longest);
    await expect(page.getByTestId('float-summary')).toContainText(`No float is longer than ${longest} stitches`);
    expect((await S(page)).floats).toEqual([]);
    await setNum(page, 'max-float', longest - 1);
    const n = runs.filter((f: any) => f.len === longest).length;
    await expect(page.getByTestId('float-summary')).toContainText(`${n} float${n === 1 ? '' : 's'} longer than ${longest - 1} stitches`);
    await expect(page.getByTestId('floats').locator('li')).toHaveCount(Math.min(n, 60) + (n > 60 ? 1 : 0));
    // the default is 5
    await page.reload();
    await expect(page.getByTestId('max-float')).toHaveValue('5');
    const s = await S(page);
    expect(s.floats.length).toBe(runs.filter((f: any) => f.len > 5).length);
    await expect(page.getByTestId('float-summary')).toContainText(`${s.floats.length} floats longer than 5 stitches`);
  });

  test('deterministic: the same seed gives the same chart; other seeds differ; ?seed= and New pattern', async ({ page }) => {
    await page.goto(URL);
    const s = await S(page);
    expect(s.seed).toBe(7);
    const again = await GEN(page, 7, 72);
    expect(again).toEqual(s.chart);
    const fp = (c: any) => c.rows.map((r: any) => r.cells.join('')).join('|');
    const others = new Set<string>([fp(s.chart)]);
    for (const k of [1, 2, 3, 4, 5, 6]) others.add(fp(await GEN(page, k, 72)));
    expect(others.size).toBeGreaterThanOrEqual(6);
    // a second tab with the same URL draws the same thing
    const p2 = await page.context().newPage();
    await p2.goto(URL);
    expect((await S(p2)).chart).toEqual(s.chart);
    await p2.close();
    await page.getByTestId('reseed').click();
    const n = (await S(page)).seed;
    expect(page.url()).toContain(`seed=${n}`);
    await expect(page.getByTestId('seed')).toHaveValue(String(n));
    await expect(page.getByTestId('status')).toContainText(`Seed ${n}:`);
    // a palette swap recolours the chart but keeps its structure
    await page.goto(URL);
    const before = (await S(page)).chart;
    await page.getByTestId('palette').selectOption('harbour');
    const after = (await S(page)).chart;
    expect(after.colours[0].name).toBe('Sea foam');
    expect(after.bands.map((b: any) => [b.type, b.repeat, b.startRow])).toEqual(before.bands.map((b: any) => [b.type, b.repeat, b.startRow]));
  });

  test('chart orientation: stitch 1 is drawn on the right and row 1 at the bottom (sampled from the canvas)', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('reading-rule')).toContainText('from right to left');
    await expect(page.getByTestId('reading-rule')).toContainText('row 1 is the bottom row');
    const got = await page.evaluate(() => {
      const f = (window as any).__fair.state, cv = document.querySelector('[data-testid=chart]') as HTMLCanvasElement;
      const g = cv.getContext('2d')!, { cell, cols, rows, dpr } = f.geo.chart;
      const px = (col: number, row: number) => { // col/row counted from the top-left of the grid
        const d = g.getImageData(Math.floor((col + 0.5) * cell * dpr), Math.floor((row + 0.5) * cell * dpr), 1, 1).data;
        return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      };
      const out: any[] = [];
      // check every cell of three rows and a scattering of others, avoiding outlined float cells
      const flagged = new Set<string>();
      f.floats.forEach((fl: any) => { for (let k = 0; k < fl.len; k++) flagged.add(`${fl.row}:${(fl.start - 1 + k) % cols}`); });
      for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
        if (flagged.has(`${r + 1}:${i}`)) continue;
        out.push({ r, i, want: f.chart.colours[f.chart.rows[r].cells[i]].hex, got: px(cols - 1 - i, rows - 1 - r) });
      }
      return out;
    });
    expect(got.length).toBeGreaterThan(1000);
    const wrong = got.filter((c) => c.want !== c.got);
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  test('the chart is not mirror-symmetric in general, so the orientation test above can fail', async ({ page }) => {
    // Guard for the test above: if the chart were symmetric left-right, drawing it mirrored would still pass.
    await page.goto(URL);
    const c = (await S(page)).chart;
    const asym = c.rows.some((r: any) => r.cells.some((v: number, i: number) => v !== r.cells[(c.width - 1 - i)]));
    const upDown = c.rows.some((r: any, i: number) => r.cells.join() !== c.rows[c.rows.length - 1 - i].cells.join());
    expect(asym || upDown).toBe(true);
    expect(upDown).toBe(true);
  });

  test('knitted preview: one V per stitch, coloured like the chart', async ({ page }) => {
    await page.goto(URL);
    const s = await S(page);
    const H = s.chart.rows.length;
    expect(s.geo.knit.stitches).toBe(72 * H);
    expect(s.geo.knit.sh).toBeLessThanOrEqual(s.geo.knit.sw);   // stitches are wider than tall
    await expect(page.getByTestId('knit')).toHaveAttribute('aria-label', new RegExp(`${72 * H} V-shaped stitches`));
    const res = await page.evaluate(() => {
      const f = (window as any).__fair.state, cv = document.querySelector('[data-testid=knit]') as HTMLCanvasElement;
      const g = cv.getContext('2d')!, { sw, sh, cols, rows, dpr } = f.geo.knit;
      let match = 0, total = 0;
      for (let r = 0; r < rows; r += 3) for (let i = 0; i < cols; i += 5) {
        // the left leg of the V, a quarter across and halfway down
        const d = g.getImageData(Math.floor(((cols - 1 - i) + 0.36) * sw * dpr), Math.floor(((rows - 1 - r) + 0.5) * sh * dpr), 1, 1).data;
        const want = f.chart.colours[f.chart.rows[r].cells[i]].hex;
        const n = parseInt(want.slice(1), 16), rgb = [n >> 16, n >> 8 & 255, n & 255];
        total++;
        if (rgb.every((v, k) => Math.abs(v - d[k]) <= 40)) match++;
      }
      return { match, total };
    });
    expect(res.match / res.total).toBeGreaterThan(0.9);
  });

  test('yarn estimate: stitch counts from the cells and metres from the stated rule', async ({ page }) => {
    await page.goto(URL);
    const s = await S(page);
    const { STITCH_FACTOR, FLOAT_FACTOR, M_PER_25G } = s.constants;
    expect([STITCH_FACTOR, FLOAT_FACTOR, M_PER_25G]).toEqual([3.5, 1, 105]);
    const n = s.chart.colours.length, knit = Array(n).fill(0), carried = Array(n).fill(0);
    for (const r of s.chart.rows) {
      const cols = [...new Set<number>(r.cells)];
      for (const c of r.cells) { knit[c]++; if (cols.length === 2) carried[cols.find((k) => k !== c)!]++; }
    }
    expect(knit.reduce((a, b) => a + b, 0)).toBe(72 * s.chart.rows.length);
    const stW = 10 / 28;
    for (const u of s.usage) {
      expect(u.stitches).toBe(knit[u.colour]);
      expect(u.floated).toBe(carried[u.colour]);
      const m = (knit[u.colour] * 3.5 + carried[u.colour]) * stW / 100;
      expect(u.metres).toBeCloseTo(m, 9);
      expect(u.grams).toBeCloseTo(m / 105 * 25, 9);
      await expect(page.locator(`[data-testid=yarn] tr[data-colour="${u.colour}"] td`).nth(3)).toHaveText(m.toFixed(1));
    }
    // a looser gauge means wider stitches and more yarn
    const before = s.usage[0].metres;
    await setNum(page, 'gauge', 20);
    await expect.poll(async () => (await S(page)).usage[0].metres).toBeCloseTo(before * 28 / 20, 9);
  });

  test('keyboard and screen readers: labelled fields, width changes regenerate, status announces', async ({ page }) => {
    await page.goto(URL);
    for (const label of ['Stitches around', 'Longest float', 'Seed', 'Gauge (st / 10 cm)']) await expect(page.getByLabel(label)).toBeVisible();
    await expect(page.getByLabel('Palette', { exact: true })).toBeVisible();
    await page.getByLabel('Stitches around').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('96');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('status')).toContainText('96 stitches');
    const s = await S(page);
    expect(s.width).toBe(96);
    for (const b of s.chart.bands) expect(96 % b.repeat).toBe(0);
    await expect(page.getByTestId('bands').locator('li').first()).toContainText('worked');
    // a width that isn't a multiple of 4 is snapped to the nearest one
    await setNum(page, 'width', 70);
    await expect(page.getByTestId('width')).toHaveValue(/^(68|72)$/);
    await expect(page.getByTestId('chart')).toHaveAttribute('aria-label', /read right to left from row 1 at the bottom/);
    await page.getByTestId('reseed').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status')).toContainText('Seed ');
  });
});
