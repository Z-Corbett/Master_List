import { test, expect, Page } from '@playwright/test';

const URL = '/lab/136-cross-stitch.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__stitch.state);

// ---- independent oracles ----
function lab(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; });
  const f = (t: number) => (t > 0.008856451679 ? Math.cbrt(t) : (903.2962963 * t + 16) / 116);
  const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047), fy = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b), fz = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIEDE2000, following Sharma, Wu & Dalal (2005), eqs. 1-22. */
function de00([L1, a1, b1]: number[], [L2, a2, b2]: number[]) {
  const d = Math.PI / 180, p7 = (x: number) => x ** 7;
  const Cab = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2, G = 0.5 * (1 - Math.sqrt(p7(Cab) / (p7(Cab) + p7(25))));
  const A1 = a1 * (1 + G), A2 = a2 * (1 + G), C1 = Math.hypot(A1, b1), C2 = Math.hypot(A2, b2);
  const h = (b: number, a: number) => (b === 0 && a === 0 ? 0 : ((Math.atan2(b, a) / d) + 360) % 360);
  const h1 = h(b1, A1), h2 = h(b2, A2);
  const dh = C1 * C2 === 0 ? 0 : Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360;
  const dL = L2 - L1, dC = C2 - C1, dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh * d) / 2);
  const Lm = (L1 + L2) / 2, Cm = (C1 + C2) / 2;
  const hm = C1 * C2 === 0 ? h1 + h2 : Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * d) + 0.24 * Math.cos(2 * hm * d) + 0.32 * Math.cos((3 * hm + 6) * d) - 0.2 * Math.cos((4 * hm - 63) * d);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cm, SH = 1 + 0.015 * Cm * T;
  const RT = -2 * Math.sqrt(p7(Cm) / (p7(Cm) + p7(25))) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * d);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const nearest = (l: number[], floss: any[]) => floss.reduce((best, f) => (de00(l, f.lab) < de00(l, best.lab) ? f : best));

async function upload(page: Page, w: number, h: number, draw: string) {
  const url = await page.evaluate(([w, h, draw]) => {
    const c = document.createElement('canvas'); c.width = w as number; c.height = h as number;
    new Function('g', 'w', 'h', draw as string)(c.getContext('2d'), w, h);
    return c.toDataURL('image/png');
  }, [w, h, draw] as const);
  await page.getByTestId('file').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await expect(page.getByTestId('status')).toContainText('Charted your picture');
}
const A = '#c0392b', B = '#2e86c1';
/** 80 × 40 px checkerboard of 10 px blocks: at 40 stitches wide each stitch is exactly 2 × 2 px of one colour. */
const CHECKER = `for (let y = 0; y < h; y += 10) for (let x = 0; x < w; x += 10) { g.fillStyle = ((x + y) / 10) % 2 ? '${B}' : '${A}'; g.fillRect(x, y, 10, 10); }`;

test.describe('136 Cross-Stitch Pattern Maker', () => {
  test('size maths: stitches = inches × count, finished size = stitches ÷ count, plus the margin', async ({ page }) => {
    await page.goto(URL);
    let s = await S(page);
    expect([s.W, s.H]).toEqual([70, 70]);                                           // 5 in × 14 on a square picture
    await expect(page.getByTestId('finished')).toHaveText('5.00 × 5.00 in');
    await expect(page.getByTestId('finished-cm')).toContainText('12.7 × 12.7 cm');
    await expect(page.getByTestId('fabric')).toHaveText('11.00 × 11.00 in');
    // switching the unit keeps the size: 5 in at 14-count is 70 stitches
    await page.getByTestId('unit').selectOption('st');
    await expect(page.getByTestId('width')).toHaveValue('70');
    // a 3:4 picture, 100 stitches wide on 18-count, 2 in margins
    await upload(page, 300, 400, "g.fillStyle = '#8db33a'; g.fillRect(0, 0, w, h);");
    await page.getByTestId('count').selectOption('18');
    await page.getByTestId('width').fill('100');
    await page.getByTestId('width').dispatchEvent('change');
    await page.getByTestId('margin').fill('2');
    await page.getByTestId('margin').dispatchEvent('change');
    s = await S(page);
    const H = Math.round((100 * 400) / 300);
    expect([s.W, s.H]).toEqual([100, H]);
    await expect(page.getByTestId('grid-size')).toHaveText(`100 × ${H}`);
    await expect(page.getByTestId('finished')).toHaveText(`${(100 / 18).toFixed(2)} × ${(H / 18).toFixed(2)} in`);
    await expect(page.getByTestId('fabric')).toHaveText(`${(100 / 18 + 4).toFixed(2)} × ${(H / 18 + 4).toFixed(2)} in`);
    await expect(page.getByTestId('finished-cm')).toContainText(`${((100 / 18) * 2.54).toFixed(1)} × ${((H / 18) * 2.54).toFixed(1)} cm`);
    // and back to inches: 100 stitches ÷ 18 rounds to the nearest half inch
    await page.getByTestId('unit').selectOption('in');
    await expect(page.getByTestId('width')).toHaveValue('5.5');
    expect((await S(page)).W).toBe(Math.round(5.5 * 18));
  });

  test('stitch counts in the legend always add up to the grid area', async ({ page }) => {
    await page.goto(URL);
    for (const [n, dither, count] of [[4, false, '14'], [12, true, '11'], [30, false, '16'], [7, true, '22']] as const) {
      await page.getByTestId('colors').fill(String(n));
      await page.getByTestId('colors').dispatchEvent('change');
      await page.getByTestId('count').selectOption(count);
      await page.getByTestId('dither').setChecked(dither);
      const s = await S(page);
      expect(s.palette.length).toBeLessThanOrEqual(n);
      expect(s.palette.reduce((a: number, p: any) => a + p.count, 0)).toBe(s.W * s.H);
      expect(s.grid).toHaveLength(s.W * s.H);
      const shown = (await page.getByTestId('stitch-count').allTextContents()).map((t) => +t.replace(/,/g, ''));
      expect(shown.reduce((a, b) => a + b, 0)).toBe(s.W * s.H);
      await expect(page.getByTestId('legend-total')).toHaveText((s.W * s.H).toLocaleString('en-US'));
      // legend: most stitches first, one distinct symbol per colour, every colour used
      expect(shown).toEqual([...shown].sort((a, b) => b - a));
      const syms = await page.getByTestId('symbol').allTextContents();
      expect(new Set(syms).size).toBe(syms.length);
      expect(new Set(s.grid).size).toBe(s.palette.length);
    }
  });

  test('k-means is deterministic per seed, in the hook and through the UI and URL', async ({ page }) => {
    await page.goto(URL);
    const a = await S(page);
    const [k1, k2, k3] = await page.evaluate(() => {
      const st = (window as any).__stitch, r = (i: number) => [(i * 37) % 100, ((i * 53) % 90) - 45, ((i * 71) % 110) - 55];
      const labs = Array.from({ length: 400 }, (_, i) => r(i));
      return [st.kmeans(labs, 6, 42), st.kmeans(labs, 6, 42), st.kmeans(labs, 6, 43)].map((k: any) => JSON.stringify(k.centers));
    });
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
    await page.getByTestId('seed').fill('8');
    await page.getByTestId('seed').dispatchEvent('change');
    expect(page.url()).toContain('seed=8');
    const b = await S(page);
    expect(b.seed).toBe(8);
    await page.getByTestId('seed').fill('7');
    await page.getByTestId('seed').dispatchEvent('change');
    const c = await S(page);
    expect(c.grid).toEqual(a.grid);
    expect(c.palette).toEqual(a.palette);
    await page.reload();                                                               // ?seed=7 again
    expect((await S(page)).grid).toEqual(a.grid);
  });

  test('palette mapping picks the floss with the smallest ΔE00, checked with an independent CIEDE2000', async ({ page }) => {
    // the oracle itself against Sharma et al. (2005) pairs 1, 7, 17 and 25
    expect(de00([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(de00([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
    expect(de00([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(de00([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(1.2644, 4);
    await page.goto(URL);
    const floss: any[] = await page.evaluate(() => (window as any).__stitch.floss);
    expect(floss).toHaveLength(60);
    expect(new Set(floss.map((f) => f.id)).size).toBe(60);
    floss.forEach((f) => { expect(f.id).toMatch(/^F-1[0-6]\d$/); lab(hex(f.hex)).forEach((v, i) => expect(f.lab[i]).toBeCloseTo(v, 6)); });
    // 60 pseudo-random colours with a fixed LCG, so the sample is the same every run
    let x = 12345; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const samples = Array.from({ length: 60 }, () => lab([rnd() * 255, rnd() * 255, rnd() * 255]));
    const got: string[] = await page.evaluate((s) => s.map((l: number[]) => (window as any).__stitch.nearestFloss(l)), samples);
    samples.forEach((l, i) => expect(got[i], `sample ${i}`).toBe(nearest(l, floss).id));
    // every exact floss colour maps to itself
    const self: string[] = await page.evaluate((f) => f.map((q: any) => (window as any).__stitch.nearestFloss(q.lab)), floss);
    expect(self).toEqual(floss.map((f) => f.id));
  });

  test('dithering off: a synthetic two-colour picture charts exactly, cell for cell', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('unit').selectOption('st');
    await page.getByTestId('width').fill('40');
    await page.getByTestId('width').dispatchEvent('change');
    await upload(page, 80, 40, CHECKER);
    const s = await S(page);
    expect([s.W, s.H]).toEqual([40, 20]);
    const floss: any[] = await page.evaluate(() => (window as any).__stitch.floss);
    const fa = nearest(lab(hex(A)), floss).id, fb = nearest(lab(hex(B)), floss).id;
    expect(fa).not.toBe(fb);
    expect(s.palette.map((p: any) => p.id).sort()).toEqual([fa, fb].sort());
    const ids = s.grid.map((k: number) => s.palette[k].id);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) expect(ids[y * 40 + x], `(${x},${y})`).toBe((Math.floor(x / 5) + Math.floor(y / 5)) % 2 ? fb : fa);
    expect(s.palette.map((p: any) => p.count)).toEqual([400, 400]);
    expect(s.iterations).toBe(0);                                                    // two distinct colours are the centres exactly
    // dithering on still covers every stitch with the same two threads
    await page.getByTestId('dither').check();
    const d = await S(page);
    expect(d.dither).toBe(true);
    expect(d.palette.reduce((a: number, p: any) => a + p.count, 0)).toBe(800);
    expect(d.palette.every((p: any) => [fa, fb].includes(p.id))).toBe(true);
  });

  test('upload flow: the picture is charted in the page, with no network requests', async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('load');
    const requests: string[] = [];
    page.on('request', (r) => { if (!/^(data|blob):/.test(r.url())) requests.push(r.url()); });
    await expect(page.getByTestId('privacy')).toContainText('never uploaded');
    // 2 × 2 px per stitch, split on a stitch boundary, so no stitch mixes the two colours
    await upload(page, 140, 70, "g.fillStyle = '#fbe06b'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b3a73'; g.fillRect(0, 34, w, 36);");
    const s = await S(page);
    expect([s.W, s.H]).toEqual([70, 35]);
    expect(s.palette.map((p: any) => p.id).sort()).toEqual(['F-128', 'F-151']);     // Lemon and Navy are exact flosses
    const pv = await page.evaluate(() => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return [c.width, c.height, ...c.getContext('2d')!.getImageData(0, 0, 1, 1).data.slice(0, 3)]; });
    expect(pv).toEqual([70, 35, ...hex('#fbe06b')]);
    // back to the demo picture
    await page.getByTestId('demo').click();
    await expect(page.getByTestId('status')).toContainText('the demo picture');
    expect(requests).toEqual([]);
  });

  test('chart: 10 × 10 bold grid lines, centre arrows, and a canvas sized to the stitches', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('view').selectOption('symbols');
    const s = await S(page);
    const { cell, pad, w, h, bold } = s.chart;
    expect(w).toBe(s.W * cell + 2 * pad);
    expect(h).toBe(s.H * cell + 2 * pad);
    expect(bold.x).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    const px = (x: number, y: number) => page.evaluate(([x, y]) => Array.from((document.querySelector('[data-testid=chart]') as HTMLCanvasElement).getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3)), [x, y]);
    // a bold line at stitch 10 is near-black; a thin line at stitch 5 is light grey
    const yMid = pad + 2 * cell + 2;
    const boldPx = await px(pad + 10 * cell, yMid), thinPx = await px(pad + 5 * cell, yMid);
    expect(Math.max(...boldPx)).toBeLessThan(60);
    expect(Math.min(...thinPx)).toBeGreaterThan(120);
    // the top centre arrow is the thread red
    expect(await px(Math.round(pad + (s.W * cell) / 2), 5)).toEqual(hex('#b8323f'));
  });

  test('skein estimate follows its stated assumptions and scales with count and strands', async ({ page }) => {
    await page.goto(URL);
    // 8 m of 6-strand floss, 2 strands, (2√2 + 2) stitch-widths per cross, +50 %
    const per = (count: number, strands: number) => ((6 / strands) * (800 / 2.54)) / (((2 * Math.SQRT2 + 2) / count) * 1.5);
    expect(per(14, 2)).toBeGreaterThan(1700);                                         // the usual rule of thumb is ~1,800
    expect(per(14, 2)).toBeLessThan(1900);
    let s = await S(page);
    expect(s.perSkein).toBeCloseTo(per(14, 2), 6);
    await expect(page.getByTestId('skein-note')).toContainText(`about ${Math.round(per(14, 2)).toLocaleString('en-US')} stitches per skein on 14-count`);
    await expect(page.getByTestId('skein-note')).toContainText('8 m skeins of 6-strand floss');
    s.palette.forEach((p: any) => expect(p.skeins).toBe(Math.max(1, Math.ceil(p.count / per(14, 2)))));
    // bigger design on 11-count, one strand: more stitches per skein with one strand, fewer on a coarser count
    await page.getByTestId('count').selectOption('11');
    await page.getByTestId('width').fill('16');
    await page.getByTestId('width').dispatchEvent('change');
    await page.getByTestId('strands').selectOption('1');
    s = await S(page);
    expect(s.perSkein).toBeCloseTo(per(11, 1), 6);
    expect(per(11, 1)).toBeCloseTo(2 * per(11, 2), 6);
    expect(per(11, 2)).toBeLessThan(per(14, 2));
    s.palette.forEach((p: any) => expect(p.skeins).toBe(Math.max(1, Math.ceil(p.count / per(11, 1)))));
    const total = s.palette.reduce((a: number, p: any) => a + p.skeins, 0);
    await expect(page.getByTestId('skeins-total')).toHaveText(`${total} skein${total === 1 ? '' : 's'} in all`);
  });

  test('print CSS keeps the chart, the sizes and the legend, and drops the controls', async ({ page }) => {
    await page.goto(URL);
    await page.emulateMedia({ media: 'print' });
    for (const id of ['back-link', 'file', 'count', 'colors', 'print']) await expect(page.getByTestId(id)).toBeHidden();
    for (const id of ['chart', 'legend', 'sizes', 'skein-note']) await expect(page.getByTestId(id)).toBeVisible();
    const [box, vw] = await Promise.all([page.getByTestId('chart').boundingBox(), page.evaluate(() => document.documentElement.clientWidth)]);
    expect(box!.width).toBeLessThanOrEqual(vw + 1);
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByTestId('count')).toBeVisible();
  });
});
