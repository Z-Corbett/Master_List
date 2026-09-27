import { test, expect, Page } from '@playwright/test';

const URL = '/lab/169-embroidery-hoop.html';
const H = (page: Page) => page.evaluate(() => { const h = (window as any).__hoop; return { fit: h.fit, regions: h.regions, state: h.state }; });

// ---- independent oracles ----
function lab(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; });
  const f = (t: number) => (t > 0.008856451679 ? Math.cbrt(t) : (903.2962963 * t + 16) / 116);
  const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047), fy = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b), fz = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIEDE2000 after Sharma, Wu & Dalal (2005). */
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
const nearestName = (hx: string, pal: any[]) => pal.reduce((b, p) => (de00(lab(hex(hx)), lab(hex(p.hex))) < de00(lab(hex(hx)), lab(hex(b.hex))) ? p : b)).name;
/** scale (in per design unit) so the design box's corners sit on fill × the hoop's inner ellipse */
const scaleFor = (w: number, h: number, A: number, B: number, f: number) => f / Math.sqrt((w / A) ** 2 + (h / B) ** 2);
const stitchOracle = (across: number | null) => (across === null || across <= 0.08 ? 'Backstitch' : across <= 0.375 ? 'Satin stitch' : 'Long-and-short');

async function upload(page: Page, w: number, h: number, draw: string) {
  const url = await page.evaluate(([w, h, draw]) => {
    const c = document.createElement('canvas'); c.width = w as number; c.height = h as number;
    new Function('g', 'w', 'h', draw as string)(c.getContext('2d'), w, h);
    return c.toDataURL('image/png');
  }, [w, h, draw] as const);
  await page.getByTestId('file').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
}

test.describe('169 Embroidery Hoop', () => {
  test('hoop list: real round sizes 4–10 in plus two ovals', async ({ page }) => {
    await page.goto(URL);
    const opts = await page.getByTestId('hoop').locator('option').allTextContents();
    expect(opts).toEqual(['4 in round', '5 in round', '6 in round', '7 in round', '8 in round', '10 in round', '5 × 7 in oval', '6 × 9 in oval']);
    await expect(page.getByTestId('hoop')).toHaveValue('r6');
    await expect(page.getByTestId('privacy')).toContainText('never uploaded');
  });

  test('scaling: the design box fits the hoop inner diameter at the chosen fill, round and oval', async ({ page }) => {
    await page.goto(URL);
    const designs: Record<string, [number, number]> = await page.evaluate(() => {
      const D = (window as any).__hoop.DESIGNS, o: any = {}; for (const k in D) o[k] = [D[k].w, D[k].h]; return o;
    });
    expect(designs.wildflower).toEqual([160, 200]);
    const hoops: [string, number, number][] = [['r4', 4, 4], ['r6', 6, 6], ['r10', 10, 10], ['o5x7', 5, 7], ['o6x9', 6, 9]];
    for (const [id, [w, h]] of Object.entries(designs)) {
      await page.getByTestId(`design-${id}`).click();
      for (const [hoop, A, B] of hoops) {
        await page.getByTestId('hoop').selectOption(hoop);
        for (const f of [75, 50]) {
          await page.getByTestId('fill').fill(String(f));
          const s = scaleFor(w, h, A, B, f / 100);
          const { fit } = await H(page);
          expect(fit.scale).toBeCloseTo(s, 10);
          // corner on the ellipse: (x/a)² + (y/b)² = fill²
          expect(((w * s) / A) ** 2 + ((h * s) / B) ** 2).toBeCloseTo((f / 100) ** 2, 10);
          await expect(page.getByTestId('design-size')).toHaveText(`${(w * s).toFixed(2)} × ${(h * s).toFixed(2)} in`);
        }
      }
    }
    // round hoop: a rectangle fits a circle when its diagonal does, so 75% of 6 in = 4.5 in of diagonal
    await page.getByTestId('design-wildflower').click();
    await page.getByTestId('hoop').selectOption('r6');
    await page.getByTestId('fill').fill('75');
    const { fit } = await H(page);
    expect(Math.hypot(fit.wIn, fit.hIn)).toBeCloseTo(4.5, 10);
    await expect(page.getByTestId('fill-out')).toHaveText('75%');
    // drawn: the design group is inside the fabric ellipse, at the same ratio on screen
    const [gb, fb] = await Promise.all([page.getByTestId('design-g').boundingBox(), page.getByTestId('fabric').boundingBox()]);
    expect(gb!.width / fb!.width).toBeLessThanOrEqual(fit.wIn / 6 + 0.01);
    expect(gb!.height / fb!.height).toBeLessThanOrEqual(fit.hIn / 6 + 0.01);
  });

  test('palette mapping picks the smallest CIEDE2000 among 20 generic threads', async ({ page }) => {
    expect(de00([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);          // Sharma et al. pair 1
    expect(de00([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);                      // pair 17
    expect(de00([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(1.2644, 4);  // pair 25
    await page.goto(URL);
    const pal: any[] = await page.evaluate(() => (window as any).__hoop.PALETTE.map((p: any) => ({ name: p.name, hex: p.hex, lab: p.lab })));
    expect(pal).toHaveLength(20);
    pal.forEach((p) => { expect(p.name).not.toMatch(/\d/); lab(hex(p.hex)).forEach((v, i) => expect(p.lab[i]).toBeCloseTo(v, 6)); });
    let x = 777; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const samples = Array.from({ length: 60 }, () => '#' + [0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join(''));
    const got: string[] = await page.evaluate((s) => s.map((h: string) => (window as any).__hoop.nearest(h)), samples);
    samples.forEach((s, i) => expect(got[i], s).toBe(nearestName(s, pal)));
    // the thread list for each bundled design is the oracle's nearest thread for each design colour
    for (const id of ['wildflower', 'moon', 'mountain']) {
      await page.getByTestId(`design-${id}`).click();
      const colours: string[] = await page.evaluate((id) => (window as any).__hoop.DESIGNS[id].shapes.map((s: any) => s.color), id);
      const want = [...new Set(colours.map((c) => nearestName(c, pal)))];
      await expect(page.getByTestId('thread')).toHaveCount(want.length);
      expect(await page.getByTestId('thread').evaluateAll((els) => els.map((e) => e.getAttribute('data-name')))).toEqual(want);
    }
  });

  test('stitch suggestions follow the stated widths, and change with the hoop size', async ({ page }) => {
    await page.goto(URL);
    const shapes: any[] = await page.evaluate(() => (window as any).__hoop.DESIGNS.wildflower.shapes.map((s: any) => ({ kind: s.kind, across: s.across ?? null })));
    for (const [hoop, D] of [['r6', 6], ['r4', 4], ['r10', 10]] as const) {
      await page.getByTestId('hoop').selectOption(hoop);
      const s = scaleFor(160, 200, D, D, 0.75);
      const want = shapes.map((sh) => stitchOracle(sh.kind === 'line' ? null : sh.across * s));
      expect(await page.getByTestId('stitch').allTextContents()).toEqual(want);
    }
    // at 6 in the petals (26 units) are 0.46 in across → long-and-short; at 4 in they are 0.30 in → satin
    await page.getByTestId('hoop').selectOption('r6');
    await expect(page.getByTestId('region-row').filter({ hasText: 'Petal 1' }).getByTestId('stitch')).toHaveText('Long-and-short');
    await expect(page.getByTestId('region-row').filter({ hasText: 'Petal 1' }).getByTestId('across')).toHaveText(`${(26 * scaleFor(160, 200, 6, 6, 0.75)).toFixed(2)} in`);
    await page.getByTestId('hoop').selectOption('r4');
    await expect(page.getByTestId('region-row').filter({ hasText: 'Petal 1' }).getByTestId('stitch')).toHaveText('Satin stitch');
    await expect(page.getByTestId('region-row').filter({ hasText: 'Main stem' }).getByTestId('stitch')).toHaveText('Backstitch');
  });

  test('transfer pattern prints at true size in CSS inches, with a 1 in calibration square', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('hoop').selectOption('r7');
    const { fit } = await H(page);
    const s = scaleFor(160, 200, 7, 7, 0.75);
    await expect(page.getByTestId('pattern')).toHaveAttribute('width', `${(160 * s).toFixed(4)}in`);
    await expect(page.getByTestId('pattern')).toHaveAttribute('height', `${(200 * s).toFixed(4)}in`);
    await expect(page.getByTestId('pattern')).toHaveAttribute('viewBox', '0 0 160 200');
    await page.emulateMedia({ media: 'print' });
    const pb = await page.getByTestId('pattern').boundingBox();
    expect(Math.abs(pb!.width - fit.wIn * 96)).toBeLessThan(1);                          // CSS: 1 in = 96 px
    expect(Math.abs(pb!.height - fit.hIn * 96)).toBeLessThan(1);
    const cb = await page.getByTestId('calib').boundingBox();
    expect(Math.abs(cb!.width - 96)).toBeLessThan(0.5);
    expect(Math.abs(cb!.height - 96)).toBeLessThan(0.5);
    for (const id of ['preview', 'designs', 'hoop', 'threads', 'regions', 'print', 'services-link']) await expect(page.getByTestId(id)).toBeHidden();
    await expect(page.getByTestId('sheet-title')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByTestId('preview')).toBeVisible();
  });

  test('mirror: x → width − x for the iron-on transfer', async ({ page }) => {
    await page.goto(URL);
    for (const id of ['wildflower', 'moon', 'mountain']) {
      await page.getByTestId(`design-${id}`).click();
      const pos = () => page.evaluate(() => {
        const svg = document.querySelector('[data-testid=pattern]')!.getBoundingClientRect(), m = document.querySelector('[data-testid=pattern] [data-shape=marker]')!.getBoundingClientRect();
        return { left: m.left - svg.left, right: svg.right - m.right, top: m.top - svg.top, w: m.width };
      });
      await page.getByTestId('mirror').setChecked(false);
      const a = await pos();
      await page.getByTestId('mirror').setChecked(true);
      const w: number = await page.evaluate((id) => (window as any).__hoop.DESIGNS[id].w, id);
      await expect(page.getByTestId('pattern-g')).toHaveAttribute('transform', `matrix(-1 0 0 1 ${w} 0)`);
      const b = await pos();
      expect(Math.abs(b.left - a.right)).toBeLessThan(0.6);                              // left edge moves to where the right gap was
      expect(Math.abs(b.right - a.left)).toBeLessThan(0.6);
      expect(Math.abs(b.top - a.top)).toBeLessThan(0.6);                                 // vertical position unchanged
      expect(Math.abs(b.w - a.w)).toBeLessThan(0.6);
      await expect(page.getByTestId('sheet-title')).toContainText('MIRRORED');
      await expect(page.getByTestId('pattern')).toHaveAttribute('aria-label', /mirrored/);
    }
    await page.getByTestId('mirror').setChecked(false);
    await expect(page.getByTestId('pattern-g')).toHaveAttribute('transform', 'matrix(1 0 0 1 0 0)');
  });

  test('upload: a synthetic picture is matched, split into regions and sized, with no network requests', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(URL);
    const before = requests.length;
    // 120 × 80 white canvas: a red block, a thin blue line and a small green square, all exact palette colours
    await upload(page, 120, 80, `g.fillStyle = '#f7f5f0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c62f2f'; g.fillRect(10, 10, 60, 40);
      g.fillStyle = '#5b7fd1'; g.fillRect(10, 65, 100, 2);
      g.fillStyle = '#4f8a3a'; g.fillRect(90, 20, 8, 8);`);
    await expect(page.getByTestId('status')).toContainText('120 × 80 px, 3 thread colours, 3 regions');
    expect(requests.slice(before).filter((u) => !u.startsWith('data:') && !u.startsWith('blob:'))).toEqual([]);
    const { regions, fit } = await H(page);
    const s = scaleFor(120, 80, 6, 6, 0.75);
    expect(fit.scale).toBeCloseTo(s, 10);
    const want = [
      { name: 'Poppy red', area: 2400, per: 200 },
      { name: 'Cornflower', area: 200, per: 204 },
      { name: 'Leaf green', area: 64, per: 32 },
    ];
    expect(regions).toHaveLength(3);
    want.forEach((wnt, i) => {
      expect(regions[i].thread.name).toBe(wnt.name);
      const across = ((2 * wnt.area) / wnt.per) * s;
      expect(regions[i].across).toBeCloseTo(across, 10);
      expect(regions[i].stitch).toBe(stitchOracle(across));
    });
    expect(regions.map((r: any) => r.stitch)).toEqual(['Long-and-short', 'Backstitch', 'Satin stitch']);
    await expect(page.getByTestId('design-size')).toHaveText(`${(120 * s).toFixed(2)} × ${(80 * s).toFixed(2)} in`);
    await expect(page.getByTestId('thread')).toHaveCount(3);
    // the preview shows the matched picture; the transfer is its boundary outline, 1 px edges
    await expect(page.getByTestId('design-g').locator('image')).toHaveAttribute('href', /^data:image\/png/);
    const d = await page.locator('[data-testid=pattern] [data-shape=outline]').getAttribute('d');
    const segs = d!.match(/M/g)!.length;
    expect(segs).toBe(200 + 204 + 32);                                                   // every region edge that meets another colour
    for (const id of ['designs']) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('design-wildflower')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a file that is not an image is refused politely', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByTestId('status')).toHaveText('That file is not an image.');
    await expect(page.getByTestId('design-wildflower')).toHaveAttribute('aria-pressed', 'true');
  });

  test('fabric colour: preview follows it, and threads too close to it (ΔE00 < 12) are flagged', async ({ page }) => {
    await page.goto(URL);
    const fabrics: [string, string][] = await page.evaluate(() => (window as any).__hoop.FABRICS);
    const pal: any[] = await page.evaluate(() => (window as any).__hoop.PALETTE.map((p: any) => ({ name: p.name, hex: p.hex })));
    await page.getByTestId('design-moon').click();
    // keyboard: the fabric swatches are a radio group
    await page.getByTestId('fabric-0').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('fabric-1')).toBeChecked();
    for (const i of [1, 2, 3, 0]) {
      await page.getByTestId(`fabric-${i}`).check({ force: true });
      const fab = fabrics[i][1];
      await expect(page.locator('#weave rect')).toHaveAttribute('fill', fab);
      const names = await page.getByTestId('thread').evaluateAll((els) => els.map((e) => [e.getAttribute('data-hex'), !!e.querySelector('[data-testid=low-contrast]')]));
      for (const [hx, low] of names as [string, boolean][]) expect(low, `${hx} on ${fab}`).toBe(de00(lab(hex(hx!)), lab(hex(fab))) < 12);
      await expect(page.getByTestId('preview')).toHaveAttribute('aria-label', new RegExp(`on ${fabrics[i][0].toLowerCase()} fabric`));
    }
    expect(pal.length).toBe(20);
  });
});
