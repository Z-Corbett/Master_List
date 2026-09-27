import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/132-talavera-tiles.html';
type Pt = [number, number];
type Shape = { fill: string; pts: Pt[] };
const S = (page: Page) => page.evaluate(() => (window as any).__talavera.state);

// Transforms written out in the test, independent of the page's own matrices.
const rot = (deg: number) => (p: Pt): Pt => { const t = (deg * Math.PI) / 180; return [p[0] * Math.cos(t) - p[1] * Math.sin(t), p[0] * Math.sin(t) + p[1] * Math.cos(t)]; };
const mirrorX = (p: Pt): Pt => [p[0], -p[1]];                     // reflect in the horizontal axis
const mirrorY = (p: Pt): Pt => [-p[0], p[1]];                     // reflect in the vertical axis
const mirrorDiag = (p: Pt): Pt => [p[1], p[0]];                   // reflect in y = x
const sigma = (p: Pt): Pt => [1 - p[1], 1 - p[0]];                // reflect in x + y = 1 (a p4g mirror)
const centroid = (pts: Pt[]): Pt => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

/** Do two shapes coincide as point sets (order-free, 1e-6 tolerance)? */
function same(a: Shape, b: Shape) {
  if (a.fill !== b.fill || a.pts.length !== b.pts.length) return false;
  return a.pts.every((p) => b.pts.some((q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6));
}
/** Is the set of shapes invariant under f? `period` wraps a moved shape back into the cell by lattice translations. */
function invariant(shapes: Shape[], f: (p: Pt) => Pt, period?: [number, number]) {
  return shapes.every((s) => {
    let pts = s.pts.map(f);
    if (period) {
      const c = centroid(pts);
      const dx = -period[0] * Math.round(c[0] / period[0]), dy = -period[1] * Math.round(c[1] / period[1]);
      pts = pts.map(([x, y]) => [x + dx, y + dy] as Pt);
    }
    const moved = { fill: s.fill, pts };
    return shapes.some((t) => same(moved, t));
  });
}
async function pick(page: Page, sym: string) {
  await page.getByTestId(`sym-${sym}`).check();
  await expect.poll(async () => (await S(page)).sym).toBe(sym);
  return S(page);
}

test.describe('132 Talavera Tiles', () => {
  test('p4m: the tile is unchanged by quarter turns and by mirrors on both axes and both diagonals', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    const s = await S(page);
    expect(s.sym).toBe('p4m');
    expect(s.shapes).toHaveLength(s.motif.length * 8);
    for (const f of [rot(90), rot(180), rot(270), mirrorX, mirrorY, mirrorDiag]) expect(invariant(s.shapes, f)).toBe(true);
    // a generic rotation is not a symmetry: the check can fail
    expect(invariant(s.shapes, rot(45))).toBe(false);
    expect(invariant(s.shapes, rot(30))).toBe(false);
  });

  test('p4g: four-fold about the centre, diagonal mirrors off-centre, but no mirror through the centre', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    const s = await pick(page, 'p4g');
    expect(s.shapes).toHaveLength(s.motif.length * 8);
    for (const f of [rot(90), rot(180), rot(270)]) expect(invariant(s.shapes, f)).toBe(true);
    // the mirror x + y = 1 maps the pattern to itself once shapes are wrapped by the 2 × 2 lattice
    expect(invariant(s.shapes, sigma, [2, 2])).toBe(true);
    expect(invariant(s.shapes, (p) => [p[1] - 1, p[0] + 1] as Pt, [2, 2])).toBe(true);        // and in y − x = 1
    // what separates p4g from p4m: mirrors through a four-fold centre are absent
    for (const f of [mirrorX, mirrorY, mirrorDiag]) expect(invariant(s.shapes, f, [2, 2])).toBe(false);
  });

  test('p2mm: two perpendicular mirrors and a half turn, but no quarter turn, on a 2 × 1.5 rectangle', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    const s = await pick(page, 'p2mm');
    expect(s.cell).toBe('rect');
    expect(s.shapes).toHaveLength(s.motif.length * 4);
    for (const f of [mirrorX, mirrorY, rot(180)]) expect(invariant(s.shapes, f)).toBe(true);
    expect(invariant(s.shapes, rot(90))).toBe(false);
    expect(invariant(s.shapes, mirrorDiag)).toBe(false);
    for (const sh of s.shapes) for (const [x, y] of sh.pts) { expect(Math.abs(x)).toBeLessThanOrEqual(1); expect(Math.abs(y)).toBeLessThanOrEqual(0.75); }
  });

  test('p6m: a hexagonal tile with six-fold rotation and twelve symmetries in all', async ({ page }) => {
    await page.goto(URL + '?seed=7&sym=p6m');
    const s = await S(page);
    expect(s.cell).toBe('hex');
    expect(s.shapes).toHaveLength(s.motif.length * 12);
    for (let k = 1; k < 6; k++) expect(invariant(s.shapes, rot(60 * k))).toBe(true);
    for (let k = 0; k < 6; k++) expect(invariant(s.shapes, (p) => rot(30 * k)(mirrorX(rot(-30 * k)(p))))).toBe(true);   // mirrors every 30°
    expect(invariant(s.shapes, rot(90))).toBe(false);
    // the outline is a regular hexagon of circumradius 1, and every shape lies inside its apothem
    expect(s.outline).toHaveLength(6);
    for (const [x, y] of s.outline) expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
    for (const sh of s.shapes) for (const [x, y] of sh.pts) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1);
  });

  test('the tile is exactly the motif copied by the group: every copy is an isometry of the fundamental region', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    const s = await S(page);
    // every motif shape sits inside the fundamental triangle 0 ≤ y ≤ x ≤ 1
    for (const m of s.motif) for (const [x, y] of m.pts) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(x); expect(x).toBeLessThanOrEqual(1); }
    // the eight D4 images of the motif, built here, are exactly the tile's shapes
    const d4 = [0, 90, 180, 270].flatMap((k) => [rot(k), (p: Pt) => rot(k)(mirrorX(p))]);
    const images: Shape[] = d4.flatMap((g) => s.motif.map((m: Shape) => ({ fill: m.fill, pts: m.pts.map(g) })));
    expect(images).toHaveLength(s.shapes.length);
    for (const im of images) expect(s.shapes.some((t: Shape) => same(im, t))).toBe(true);
    // and no two copies overlap one another's points: the regions are disjoint apart from their edges
    const cs = s.shapes.map((sh: Shape) => centroid(sh.pts).map((v) => v.toFixed(6)).join(','));
    expect(new Set(cs).size).toBe(cs.length);
  });

  test('designs are deterministic per seed, and the seed controls reach the URL', async ({ page, context }) => {
    await page.goto(URL + '?seed=7');
    const a = await S(page);
    const p2 = await context.newPage();
    await p2.goto(URL + '?seed=7');
    expect(await p2.evaluate(() => (window as any).__talavera.state)).toEqual(a);
    await page.getByTestId('next').click();
    const b = await S(page);
    expect(b.seed).toBe(8);
    expect(b.motif).not.toEqual(a.motif);
    expect(page.url()).toContain('seed=8');
    await page.getByTestId('seed').fill('7');
    await page.getByTestId('seed').press('Enter');
    expect(await S(page)).toEqual(a);
    await page.getByTestId('seed').fill('-3');
    await page.getByTestId('seed').press('Enter');
    await expect(page.getByTestId('status')).toContainText('whole number');
    expect((await S(page)).seed).toBe(7);
    const motifs: string[] = [];
    for (const n of [11, 12, 13, 14]) {                              // one page, one navigation at a time
      await p2.goto(`${URL}?seed=${n}`);
      motifs.push(JSON.stringify((await p2.evaluate(() => (window as any).__talavera.state)).motif));
    }
    expect(new Set(motifs).size).toBe(4);
  });

  test('palette lock keeps the colouring while the shapes change', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    const a = await S(page);
    await page.getByTestId('lock').check();
    await expect(page.getByTestId('status')).toContainText('Colours locked to seed 7');
    await page.getByTestId('next').click();
    const b = await S(page);
    expect(b.colourSeed).toBe(7);
    expect(b.motif.map((m: Shape) => m.pts)).not.toEqual(a.motif.map((m: Shape) => m.pts));
    const n = Math.min(a.motif.length, b.motif.length);
    expect(b.motif.slice(0, n).map((m: Shape) => m.fill)).toEqual(a.motif.slice(0, n).map((m: Shape) => m.fill));
    expect(page.url()).toContain('colors=7');
    await page.getByTestId('lock').uncheck();
    expect((await S(page)).colourSeed).toBe(8);
    // fills only ever come from the four glaze colours, and cobalt leads
    for (const seed of [1, 2, 3]) {
      await page.getByTestId('seed').fill(String(seed)); await page.getByTestId('seed').press('Enter');
      const s = await S(page);
      expect(s.motif[0].fill).toBe('cobalt');
      for (const m of s.motif) expect(['cobalt', 'yellow', 'green', 'terracotta']).toContain(m.fill);
    }
  });

  test('tile SVG download is well-formed and uses only the five palette colours', async ({ page }) => {
    await page.goto(URL + '?seed=7&sym=p4g');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-tile').click()]);
    expect(dl.suggestedFilename()).toBe('talavera-p4g-7.svg');
    const text = readFileSync((await dl.path())!, 'utf8');
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const parsed = await page.evaluate((t) => {
      const doc = new DOMParser().parseFromString(t, 'image/svg+xml');
      const err = doc.getElementsByTagName('parsererror').length;
      const root = doc.documentElement;
      const colours = [...doc.querySelectorAll('*')].flatMap((el) => ['fill', 'stroke'].map((a) => el.getAttribute(a)).filter(Boolean));
      return { err, name: root.localName, ns: root.namespaceURI, polys: doc.getElementsByTagName('polygon').length, colours };
    }, text);
    expect(parsed.err).toBe(0);
    expect(parsed.name).toBe('svg');
    expect(parsed.ns).toBe('http://www.w3.org/2000/svg');
    const s = await S(page);
    expect(parsed.polys).toBe(s.shapes.length + 1);                  // every shape plus the tile's ground
    const palette = ['#f7f2e4', '#1f3f94', '#e8b422', '#3f7d3a', '#b8532c'];
    expect(parsed.colours.length).toBeGreaterThan(20);
    for (const c of parsed.colours) expect(palette).toContain(c);
    // no colour sneaks in through style attributes, rgb() or named colours either
    expect(text).not.toMatch(/style=|rgb\(|hsl\(|url\(/);
    expect((text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).every((c) => palette.includes(c.toLowerCase()))).toBe(true);
  });

  test('wall SVG download repeats the tile on its lattice and stays in the palette', async ({ page }) => {
    await page.goto(URL + '?seed=7&sym=p6m');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-wall').click()]);
    expect(dl.suggestedFilename()).toBe('talavera-wall-p6m-7.svg');
    const text = readFileSync((await dl.path())!, 'utf8');
    const r = await page.evaluate((t) => {
      const doc = new DOMParser().parseFromString(t, 'image/svg+xml');
      const uses = [...doc.getElementsByTagName('use')].map((u) => (u.getAttribute('transform') || '').match(/-?[\d.]+/g)!.map(Number));
      return { err: doc.getElementsByTagName('parsererror').length, uses, hrefs: [...doc.getElementsByTagName('use')].map((u) => u.getAttribute('href')), target: !!doc.getElementById('tl') };
    }, text);
    expect(r.err).toBe(0);
    expect(r.target).toBe(true);
    expect(new Set(r.hrefs)).toEqual(new Set(['#tl']));
    expect(r.uses).toHaveLength(30);
    // hexagonal lattice: nearest neighbours are √3 apart (twice the apothem), and never closer
    for (const [x, y] of r.uses) {
      const d = Math.min(...r.uses.filter(([u, v]) => u !== x || v !== y).map(([u, v]) => Math.hypot(u - x, v - y)));
      expect(d).toBeCloseTo(Math.sqrt(3), 3);
    }
    const palette = ['#f7f2e4', '#1f3f94', '#e8b422', '#3f7d3a', '#b8532c'];
    expect((text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).every((c) => palette.includes(c.toLowerCase()))).toBe(true);
  });

  test('controls are labelled and keyboard operable, and the views describe themselves', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    await page.getByTestId('sym-p4m').focus();
    await page.keyboard.press('ArrowDown');                          // radio group: arrows move the choice
    await expect.poll(async () => (await S(page)).sym).toBe('p4g');
    await expect(page.getByTestId('status')).toContainText('Seed 7, p4g');
    await expect(page.getByRole('spinbutton', { name: 'Seed' })).toHaveValue('7');
    await expect(page.getByRole('checkbox', { name: /Lock colours/ })).not.toBeChecked();
    await expect(page.getByTestId('tile').locator('svg')).toHaveAttribute('role', 'img');
    await expect(page.getByTestId('tile').locator('svg title')).toHaveText('Talavera-style tile, seed 7, p4g symmetry');
    const s = await S(page);
    await expect(page.locator('#tileCap')).toHaveText(`One tile · ${s.motif.length} shapes × 8 copies`);
    await expect(page.getByTestId('wall').locator('use')).toHaveCount(16);
  });
});
