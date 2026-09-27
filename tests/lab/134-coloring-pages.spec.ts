import { test, expect, Page } from '@playwright/test';

const URL = '/lab/134-coloring-pages.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__color.state);
const C = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window as any).__color[fn as string](...(args as unknown[])), [fn, args] as const) as Promise<T>;
const W = 850, H = 1100;

/** Build a PNG in the browser: white page, then black rectangles (and optional white ones) drawn in order. */
async function png(page: Page, ops: [string, number, number, number, number][], w = W, h = H) {
  const url = await page.evaluate(([ops, w, h]) => {
    const c = document.createElement('canvas'); c.width = w as number; c.height = h as number;
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    for (const [col, x, y, ww, hh] of ops as [string, number, number, number, number][]) { g.fillStyle = col; g.fillRect(x, y, ww, hh); }
    return c.toDataURL('image/png');
  }, [ops, w, h] as const);
  return Buffer.from(url.split(',')[1], 'base64');
}
/** Two hollow rectangles with 4 px walls: A is 200 × 200 at (100, 200), B is 200 × 300 at (500, 600). */
const RINGS: [string, number, number, number, number][] = [
  ['#000', 100, 200, 200, 200], ['#fff', 104, 204, 192, 192],
  ['#000', 500, 600, 200, 300], ['#fff', 504, 604, 192, 292],
];
async function tap(page: Page, x: number, y: number) {
  const cv = page.getByTestId('sheet'), box = (await cv.boundingBox())!;
  await cv.click({ position: { x: ((x + 0.5) * box.width) / W, y: ((y + 0.5) * box.height) / H } });
}
async function loadRings(page: Page) {
  await page.getByTestId('style-photo').click();
  await page.getByTestId('weight-thin').check();
  await page.getByTestId('asis').check();
  await page.getByTestId('file').setInputFiles({ name: 'rings.png', mimeType: 'image/png', buffer: await png(page, RINGS) });
  await expect(page.getByTestId('status')).toContainText('Traced the line art');
}

test.describe('134 Coloring Pages', () => {
  test('flood fill stays inside a closed region: exact pixel counts on a synthetic page, and nothing is uploaded', async ({ page }) => {
    await page.goto(URL);
    await page.waitForLoadState('load');
    const requests: string[] = [];
    page.on('request', (r) => { if (!/^(data|blob):/.test(r.url())) requests.push(r.url()); });
    await loadRings(page);
    await expect(page.getByTestId('privacy')).toContainText('never uploaded');
    // walls: 200² − 192² and 200·300 − 192·292
    expect(await C(page, 'lineCount')).toBe(200 * 200 - 192 * 192 + (200 * 300 - 192 * 292));
    await page.getByTestId('crayon-red').click();
    await tap(page, 200, 300);
    expect((await S(page)).lastFill.count).toBe(192 * 192);
    expect(await C(page, 'countColor', '#d8432e')).toBe(192 * 192);
    expect(await C(page, 'colorAt', 600, 700)).toBe('#ffffff');                 // the other box is untouched
    expect(await C(page, 'colorAt', 99, 300)).toBe('#ffffff');                  // just outside the wall
    await page.getByTestId('crayon-sky').click();
    await tap(page, 20, 20);
    expect((await S(page)).lastFill.count).toBe(W * H - 200 * 200 - 200 * 300);  // everything outside both boxes
    await page.getByTestId('crayon-leaf-green').click();
    await tap(page, 600, 750);
    expect(await C(page, 'countColor', '#3f8a4d')).toBe(192 * 292);
    expect(requests).toEqual([]);
  });

  test('undo and redo: buttons, Ctrl+Z / Ctrl+Y, and a new fill clears the redo stack', async ({ page }) => {
    await page.goto(URL);
    await loadRings(page);
    await expect(page.getByTestId('undo')).toBeDisabled();
    await page.getByTestId('crayon-red').click();
    await tap(page, 200, 300);
    await page.getByTestId('crayon-violet').click();
    await tap(page, 600, 750);
    expect(await S(page)).toMatchObject({ undo: 2, redo: 0 });
    await page.getByTestId('undo').click();
    expect(await C(page, 'countColor', '#7d4fb0')).toBe(0);
    expect(await C(page, 'countColor', '#d8432e')).toBe(192 * 192);
    await page.getByTestId('undo').click();
    expect(await C(page, 'countColor', '#ffffff')).toBe(W * H - (await C<number>(page, 'lineCount')));
    await expect(page.getByTestId('undo')).toBeDisabled();
    await expect(page.getByTestId('redo')).toBeEnabled();
    await page.getByTestId('redo').click();
    await page.getByTestId('redo').click();
    expect(await C(page, 'countColor', '#7d4fb0')).toBe(192 * 292);
    await expect(page.getByTestId('redo')).toBeDisabled();
    // keyboard shortcuts, from the page itself
    await page.getByTestId('sheet').focus();
    await page.keyboard.press('Control+z');
    expect(await S(page)).toMatchObject({ undo: 1, redo: 1 });
    await page.keyboard.press('Control+y');
    expect(await S(page)).toMatchObject({ undo: 2, redo: 0 });
    await page.keyboard.press('Control+z');
    await page.getByTestId('crayon-gold').click();
    await tap(page, 20, 20);
    expect(await S(page)).toMatchObject({ undo: 2, redo: 0 });                   // redo is gone after a new fill
    // tapping a line, or a shape that's already that colour, records nothing
    await tap(page, 101, 300);
    await expect(page.getByTestId('status')).toContainText('is a line');
    await tap(page, 20, 20);
    await expect(page.getByTestId('status')).toContainText('already that color');
    expect((await S(page)).undo).toBe(2);
  });

  test('mandala shapes are n-fold symmetric: each one rotated by 360°/n lands on another', async ({ page }) => {
    await page.goto(URL);
    for (const n of ['6', '8', '12', '16']) {
      await page.getByTestId('folds').selectOption(n);
      const m = (await S(page)).mandala;
      expect(m.n).toBe(+n);
      await expect(page.getByTestId('status')).toContainText(`${n}-fold mandala`);
      const a = (2 * Math.PI) / m.n, rot = ([x, y]: number[]) => [m.cx + (x - m.cx) * Math.cos(a) - (y - m.cy) * Math.sin(a), m.cy + (x - m.cx) * Math.sin(a) + (y - m.cy) * Math.cos(a)];
      const close = (p: number[], q: number[]) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
      const motifs = m.shapes.filter((s: any) => !(s.type === 'circle' && close([s.cx, s.cy], [m.cx, m.cy])));
      expect(motifs.length % m.n).toBe(0);
      expect(motifs.length).toBeGreaterThanOrEqual(m.n * 3);
      for (const s of motifs) {
        const match = motifs.some((t: any) => t !== s && t.type === s.type && (s.type === 'circle'
          ? Math.abs(t.r - s.r) < 1e-9 && close(rot([s.cx, s.cy]), [t.cx, t.cy])
          : t.pts.length === s.pts.length && s.pts.every((p: number[], i: number) => close(rot(p), t.pts[i]))));
        expect(match, `shape in ring ${s.ring} has a partner at +${360 / m.n}°`).toBe(true);
      }
      // the rest are rings centred on the mandala, so they are symmetric under any rotation
      m.shapes.filter((s: any) => !motifs.includes(s)).forEach((s: any) => expect(s.type).toBe('circle'));
    }
    // the same seed and fold count gives the same shapes; another seed does not
    const [a1, a2, b] = await page.evaluate(() => { const c = (window as any).__color; return [c.mandala(7, 8), c.mandala(7, 8), c.mandala(8, 8)].map((m: any) => JSON.stringify(m.shapes)); });
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
  });

  test('Sobel on a synthetic step edge: 4 × 255 on the two columns at the step, zero elsewhere', async ({ page }) => {
    await page.goto(URL);
    const w = 8, h = 6;
    const step = Array.from({ length: w * h }, (_, i) => (i % w < 4 ? 0 : 255));
    const mag: number[] = await C(page, 'sobel', step, w, h);
    // Gx = (1 + 2 + 1)·255 either side of the step, Gy = 0, edges replicated so every row agrees
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(mag[y * w + x], `(${x},${y})`).toBe(x === 3 || x === 4 ? 1020 : 0);
    // a horizontal step gives the same magnitudes, transposed
    const hstep = Array.from({ length: w * h }, (_, i) => (Math.floor(i / w) < 3 ? 0 : 255));
    const hm: number[] = await C(page, 'sobel', hstep, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(hm[y * w + x]).toBe(y === 2 || y === 3 ? 1020 : 0);
    // a flat image has no edges, and the [1 2 1]/4 blur leaves it flat
    expect((await C<number[]>(page, 'sobel', Array(w * h).fill(90), w, h)).every((v) => v === 0)).toBe(true);
    expect((await C<number[]>(page, 'blur', Array(w * h).fill(90), w, h)).every((v) => v === 90)).toBe(true);
  });

  test('photo mode traces a step image: edge columns follow blur and threshold exactly', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('style-photo').click();
    await page.getByTestId('weight-thin').check();
    await page.getByTestId('blur').selectOption('0');
    await page.getByTestId('file').setInputFiles({ name: 'step.png', mimeType: 'image/png', buffer: await png(page, [['#000', 0, 0, 425, H]]) });
    await expect(page.getByTestId('status')).toContainText('Traced edges');
    expect(await C(page, 'lineColumns')).toEqual([424, 425]);
    expect(await C(page, 'lineCount')).toBe(2 * H);
    // one [1 2 1]/4 pass gives 0, 63.75, 191.25, 255 across the step, so Sobel (4 × the central difference) is 255, 765, 765, 255
    await page.getByTestId('blur').selectOption('1');
    expect(await C(page, 'lineColumns')).toEqual([423, 424, 425, 426]);
    await page.getByTestId('threshold').fill('300');
    await page.getByTestId('threshold').dispatchEvent('change');
    expect(await C(page, 'lineColumns')).toEqual([424, 425]);
    // bold lines grow one pixel each side
    await page.getByTestId('weight-bold').check();
    expect(await C(page, 'lineColumns')).toEqual([423, 424, 425, 426]);
    // the demo picture needs no upload at all
    await page.getByTestId('demo-photo').click();
    await expect(page.getByTestId('status')).toContainText('Traced edges');
    expect(await C<number>(page, 'lineCount')).toBeGreaterThan(2000);                // the settings above still apply (threshold 300)
    expect((await C<number[]>(page, 'lineColumns')).length).toBeGreaterThan(200);    // outlines spread across the page
  });

  test('print CSS prints only the page', async ({ page }) => {
    await page.goto(URL);
    await page.emulateMedia({ media: 'print' });
    for (const id of ['back-link', 'styles', 'palette', 'undo', 'download', 'status']) await expect(page.getByTestId(id)).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Coloring Pages' })).toBeHidden();
    const sheet = page.getByTestId('sheet');
    await expect(sheet).toBeVisible();
    const [box, vw] = await Promise.all([sheet.boundingBox(), page.evaluate(() => document.documentElement.clientWidth)]);
    expect(box!.width).toBeGreaterThan(vw * 0.9);
    expect(box!.height / box!.width).toBeCloseTo(H / W, 2);
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect(page.getByTestId('back-link')).toBeVisible();
  });

  test('download: a real 850 × 1100 PNG named after the style and seed', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('crayon-bluebonnet').click();
    await tap(page, 425, 1060);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    expect(dl.suggestedFilename()).toBe('coloring-page-mandala-7.png');
    const stream = await dl.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(buf.readUInt32BE(16)).toBe(W);                                            // IHDR width
    expect(buf.readUInt32BE(20)).toBe(H);                                            // IHDR height
  });

  test('styles and seeds: every style draws, the URL keeps the seed, and a seed redraws the same page', async ({ page }) => {
    await page.goto(URL);
    const counts: Record<string, number> = {};
    for (const s of ['mandala', 'meadow', 'zentangle', 'animal']) {
      await page.getByTestId(`style-${s}`).click();
      await expect(page.getByTestId(`style-${s}`)).toHaveAttribute('aria-pressed', 'true');
      counts[s] = await C<number>(page, 'lineCount');
      expect(counts[s], s).toBeGreaterThan(10_000);
      expect(page.url()).toContain(`style=${s}`);
      expect(page.url()).toContain('seed=7');
    }
    const st = await S(page);
    expect(['owl', 'cat', 'fish', 'turtle']).toContain(st.animalName);
    await page.getByTestId('animal').selectOption('turtle');
    await expect(page.getByTestId('status')).toContainText('a turtle (seed 7)');
    await page.getByTestId('style-meadow').click();
    const m = (await S(page)).meadow;
    expect(m.bluebonnet + m.paintbrush + m.susan).toBe(12);
    await page.reload();                                                              // ?style=meadow&seed=7
    expect((await S(page)).style).toBe('meadow');
    expect(await C(page, 'lineCount')).toBe(counts.meadow);
    await page.getByTestId('new-page').click();
    const seed = (await S(page)).seed;
    expect(seed).not.toBe(7);
    await expect(page.getByTestId('seed')).toHaveValue(String(seed));
    expect(page.url()).toContain(`seed=${seed}`);
  });

  test('keyboard coloring: arrows move the ring, Enter fills under it', async ({ page }) => {
    await page.goto(URL);
    await loadRings(page);
    await page.getByTestId('crayon-magenta').click();
    await page.getByTestId('sheet').focus();
    await expect(page.locator('#cursor')).toBeVisible();
    expect((await S(page)).cursor).toEqual({ x: 425, y: 550 });
    for (let i = 0; i < 9; i++) await page.keyboard.press('Shift+ArrowLeft');       // 425 − 225 = 200
    for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowUp');        // 550 − 250 = 300
    expect((await S(page)).cursor).toEqual({ x: 200, y: 300 });
    await page.keyboard.press('Enter');
    expect((await S(page)).lastFill).toMatchObject({ x: 200, y: 300, count: 192 * 192, color: '#c7358f' });
    await expect(page.getByTestId('status')).toHaveText('Filled 36,864 pixels with Magenta.');
    await page.getByTestId('clear').click();
    expect(await C(page, 'countColor', '#c7358f')).toBe(0);
    expect((await S(page)).undo).toBe(0);
  });
});
