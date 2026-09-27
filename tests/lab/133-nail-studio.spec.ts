import { test, expect, Page } from '@playwright/test';

const URL = '/lab/133-nail-studio.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__nails.state);

// ---- independent oracles (written for the test, not copied from the page) ----
/** sRGB (0-255) → CIELAB, D65 reference white, via the IEC 61966-2-1 transfer curve and the sRGB→XYZ matrix. */
function lab(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; });
  const xyz = [
    (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883,
  ];
  const e = 0.008856451679, k = 903.2962963;
  const [fx, fy, fz] = xyz.map((t) => (t > e ? Math.cbrt(t) : (k * t + 16) / 116));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hueDeg = (l: number[]) => ((Math.atan2(l[2], l[1]) * 180) / Math.PI + 360) % 360;
/** The page states its rule in words: h ≥ 60° warm, h ≤ 50° cool, otherwise neutral. */
const tone = (l: number[]) => (hueDeg(l) >= 60 ? 'warm' : hueDeg(l) <= 50 ? 'cool' : 'neutral');
/** Chardon et al. (1991) ITA groups. */
const group = (a: number) => (a > 55 ? 'very light' : a > 41 ? 'light' : a > 28 ? 'intermediate' : a > 10 ? 'tan' : a > -30 ? 'brown' : 'dark');

/** Draw vertical stripes of solid colour in the browser and return a PNG buffer. */
async function stripesPng(page: Page, w: number, h: number, colours: string[]) {
  const dataUrl = await page.evaluate(([w, h, colours]) => {
    const c = document.createElement('canvas'); c.width = w as number; c.height = h as number;
    const g = c.getContext('2d')!;
    (colours as string[]).forEach((col, i, a) => { g.fillStyle = col; g.fillRect(Math.floor((i * (w as number)) / a.length), 0, Math.ceil((w as number) / a.length), h as number); });
    return c.toDataURL('image/png');
  }, [w, h, colours] as const);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}
/** Click the canvas at canvas-pixel coordinates, whatever its CSS size. */
async function tapCanvas(page: Page, x: number, y: number) {
  const cv = page.getByTestId('canvas');
  const box = (await cv.boundingBox())!;
  const { w, h } = (await S(page)).canvas;
  await cv.click({ position: { x: ((x + 0.5) * box.width) / w, y: ((y + 0.5) * box.height) / h } });
}

test.describe('133 Nail Studio', () => {
  test('sRGB → CIELAB matches published values, and CIEDE2000 matches the Sharma et al. (2005) test pairs', async ({ page }) => {
    await page.goto(URL);
    const res = await page.evaluate(() => {
      const n = (window as any).__nails;
      const pairs: [number[], number[]][] = [
        [[50, 2.6772, -79.7751], [50, 0, -82.7485]], [[50, 3.1571, -77.2803], [50, 0, -82.7485]], [[50, 2.8361, -74.02], [50, 0, -82.7485]],
        [[50, -1.3802, -84.2814], [50, 0, -82.7485]], [[50, 0, 0], [50, -1, 2]], [[50, 2.49, -0.001], [50, -2.49, 0.0009]],
        [[50, 2.5, 0], [50, 0, -2.5]], [[50, 2.5, 0], [73, 25, -18]], [[50, 2.5, 0], [61, -5, 29]], [[50, 2.5, 0], [56, -27, -3]],
        [[50, 2.5, 0], [58, 24, 15]], [[50, 2.5, 0], [50, 3.1736, 0.5854]], [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387]],
        [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514]],
      ];
      return {
        de: pairs.map(([a, b]) => [n.deltaE2000(a, b), n.deltaE2000(b, a)]),
        labs: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [128, 128, 128]].map((c) => n.srgbToLab(...c)),
      };
    });
    // Sharma, Wu & Dalal, "The CIEDE2000 color-difference formula", Table 1 (pairs 1-4, 7, 12, 14, 17-21, 25, 34)
    const published = [2.0425, 2.8615, 3.4412, 1.0, 2.3669, 7.1792, 4.3065, 27.1492, 22.8977, 31.903, 19.4535, 1.0, 1.2644, 0.9082];
    res.de.forEach(([ab, ba], i) => {
      expect(ab, `pair ${i}`).toBeCloseTo(published[i], 4);
      expect(ba, `pair ${i} reversed`).toBeCloseTo(published[i], 4);
    });
    // sRGB primaries, white and mid grey in CIELAB (D65), as tabulated by e.g. Lindbloom's calculator
    const want = [[53.2408, 80.0925, 67.2032], [87.7347, -86.1827, 83.1793], [32.297, 79.1875, -107.8602], [100, 0, 0], [53.585, 0, 0]];
    res.labs.forEach((l, i) => l.forEach((v, j) => expect(v, `colour ${i} channel ${j}`).toBeCloseTo(want[i][j], 3)));
  });

  test('each demo hand samples to its own tone: Lab, ITA and group agree with an independent conversion', async ({ page }) => {
    await page.goto(URL);
    const tones: string[] = await page.evaluate(() => (window as any).__nails.demoTones);
    expect(tones).toHaveLength(6);
    for (let i = 0; i < tones.length; i++) {
      await page.getByTestId(`tone-${i}`).click();
      await expect(page.getByTestId(`tone-${i}`)).toHaveAttribute('aria-pressed', 'true');
      const s = (await S(page)).skin;
      const want = lab(hex(tones[i]));
      s.lab.forEach((v: number, j: number) => expect(v).toBeCloseTo(want[j], 6));
      expect(s.patch).toBe(49);                                               // a 7 × 7 patch
      const ita = (Math.atan((want[0] - 50) / want[2]) * 180) / Math.PI;       // ITA = arctan((L* − 50) / b*)
      expect(s.ita).toBeCloseTo(ita, 6);
      expect(s.group).toBe(group(ita));
      expect(s.undertone).toBe(tone(want));
      await expect(page.getByTestId('ita')).toHaveText(`${ita.toFixed(1)}°`);
      await expect(page.getByTestId('lab-l')).toHaveText(want[0].toFixed(1));
    }
  });

  test('uploading a photo: setInputFiles with a synthetic PNG, no network requests at all', async ({ page, baseURL }) => {
    await page.goto(URL);
    await page.waitForLoadState('load');
    const requests: string[] = [];
    page.on('request', (r) => { if (!r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url()); });
    await expect(page.getByTestId('privacy')).toContainText('never uploaded');
    const png = await stripesPng(page, 300, 200, ['#c68a5c']);
    await page.getByTestId('file').setInputFiles({ name: 'hand.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('status')).toContainText('Photo loaded (300 × 200');
    let s = await S(page);
    expect(s.source).toBe('upload');
    expect(s.canvas).toEqual({ w: 300, h: 200 });
    expect(s.skin).toBeNull();
    expect(s.nails).toEqual([]);
    await expect(page.getByTestId('review')).toContainText('Sample your skin first');
    await tapCanvas(page, 150, 100);
    s = await S(page);
    lab([198, 138, 92]).forEach((v, j) => expect(s.skin.lab[j]).toBeCloseTo(v, 6));
    await page.getByTestId('shade-fire-engine').click();
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('look')).toHaveCount(1);
    expect(requests, `requests after load (base ${baseURL})`).toEqual([]);
  });

  test('undertone on synthetic swatches of known colour: warm, neutral and cool stripes', async ({ page }) => {
    await page.goto(URL);
    // hue angles 67.5°, 55.3° and 47.2° in CIELAB
    const sw = [['#d4a070', 'warm'], ['#8a5536', 'neutral'], ['#d9a08a', 'cool'], ['#f1c7a3', 'warm'], ['#7a4a3a', 'cool']];
    for (const [h, t] of sw) expect(tone(lab(hex(h))), h).toBe(t);                 // the oracle agrees with the labels
    const png = await stripesPng(page, 500, 120, sw.map((s) => s[0]));
    await page.getByTestId('file').setInputFiles({ name: 'swatches.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('status')).toContainText('Photo loaded');
    for (let i = 0; i < sw.length; i++) {
      await tapCanvas(page, i * 100 + 50, 60);
      await expect(page.getByTestId('undertone')).toHaveText(sw[i][1]);
      const s = (await S(page)).skin;
      expect(s.hue).toBeCloseTo(hueDeg(lab(hex(sw[i][0]))), 6);
    }
  });

  test('the review tracks contrast: ΔE₀₀ per pick, bands in order, and they flip between light and deep hands', async ({ page }) => {
    await page.goto(URL);
    const ids = ['porcelain-cup', 'sandbar', 'fire-engine', 'midnight-ink'];
    const bandOf = (d: number) => (d < 12 ? 1 : d < 25 ? 2 : d < 40 ? 3 : d < 55 ? 4 : 5);
    const check = async () => {
      const s = await S(page);
      expect(s.review.map((r: any) => r.id)).toEqual(ids);
      for (const r of s.review) {
        const p = (await page.evaluate(() => (window as any).__nails.palette)).find((q: any) => q.id === r.id);
        const de = await page.evaluate(([a, b]) => (window as any).__nails.deltaE2000(a, b), [s.skin.lab, p.lab]);
        expect(r.deltaE).toBeCloseTo(de, 9);
        expect(r.contrast).toBe(bandOf(r.deltaE));
      }
      await expect(page.getByTestId('review-item')).toHaveCount(4);
      const shown = await page.getByTestId('delta-e').allTextContents();
      expect(shown).toEqual(s.review.map((r: any) => r.deltaE.toFixed(1)));
      return s.review;
    };
    await page.getByTestId('tone-0').click();
    for (const id of ids) await page.getByTestId(`shade-${id}`).click();
    const light = await check();
    // on the lightest demo hand, contrast climbs from the pale nude to the near-black
    expect(light[0].contrast).toBeLessThanOrEqual(2);
    expect(light[3].contrast).toBe(5);
    for (let i = 1; i < 4; i++) expect(light[i].deltaE).toBeGreaterThan(light[i - 1].deltaE);
    await page.getByTestId('tone-5').click();
    const deep = await check();
    // on the deepest one the same picks reverse: the pale nude is the statement, the near-black a whisper
    expect(deep[0].contrast).toBe(5);
    expect(deep[3].contrast).toBeLessThanOrEqual(2);
    expect(deep[0].deltaE).toBeGreaterThan(light[0].deltaE);
    expect(deep[3].deltaE).toBeLessThan(light[3].deltaE);
    await expect(page.getByTestId('review-item').first().getByTestId('contrast-word')).toHaveText('statement');
  });

  test('always positive: every demo tone gets 3-5 suggestions and no review says anything unkind about skin', async ({ page }) => {
    await page.goto(URL);
    const out = await page.evaluate(() => {
      const n = (window as any).__nails;
      return n.demoTones.map((h: string) => {
        const rgb = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        const l = n.srgbToLab(...rgb), u = n.undertone(l);
        return { sugs: n.suggest(l, u, 7), all: n.palette.map((p: any) => n.reviewShade(l, u, { ...p })) };
      });
    });
    const banned = /flatter|unflattering|wash(es)? (you )?out|avoid|clash|wrong|bad|not for you|too dark|too pale|sallow/i;
    for (const t of out) {
      expect(t.sugs.length).toBeGreaterThanOrEqual(3);
      expect(t.sugs.length).toBeLessThanOrEqual(5);
      expect(new Set(t.sugs.map((s: any) => s.id)).size).toBe(t.sugs.length);
      expect(new Set(t.sugs.map((s: any) => s.contrast)).size, 'suggestions span contrast levels').toBeGreaterThanOrEqual(3);
      for (const r of t.all) {
        expect(r.text).not.toMatch(banned);
        expect(r.harmony).toBeGreaterThanOrEqual(3);
      }
    }
    await expect(page.getByTestId('suggestion')).not.toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(banned);
    // "Try it" paints a suggestion and adds it to the picks
    const first = page.getByTestId('suggestion').first();
    const id = await first.getAttribute('data-id');
    await first.getByRole('button', { name: 'Try it' }).click();
    const s = await S(page);
    expect(s.shade).toBe(id);
    expect(s.picks).toContain(id);
  });

  test('nails: tap to place, drag or arrow keys to move, finishes composite over the photo', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('clear-nails').click();
    await page.getByTestId('mode-nails').click();
    await tapCanvas(page, 100, 500);
    let s = await S(page);
    expect(s.nails).toHaveLength(1);
    expect(s.nails[0].x).toBeCloseTo(100.5, 0);
    expect(s.nails[0].y).toBeCloseTo(500.5, 0);
    // drag it 40 canvas px right and back again
    const box = (await page.getByTestId('canvas').boundingBox())!;
    const k = box.width / s.canvas.w;
    await page.mouse.move(box.x + 100.5 * k, box.y + 500.5 * k);
    await page.mouse.down();
    await page.mouse.move(box.x + 140.5 * k, box.y + 500.5 * k, { steps: 4 });
    await page.mouse.up();
    s = await S(page);
    expect(s.nails).toHaveLength(1);
    expect(s.nails[0].x).toBeCloseTo(140.5, 0);
    await page.mouse.move(box.x + 140.5 * k, box.y + 500.5 * k);
    await page.mouse.down();
    await page.mouse.move(box.x + 100.5 * k, box.y + 500.5 * k, { steps: 4 });
    await page.mouse.up();
    expect((await S(page)).nails[0].x).toBeCloseTo(100.5, 0);
    // matte is flat colour: the centre pixel is exactly the polish
    await page.getByTestId('finish-matte').check();
    await page.getByTestId('shade-teal-tide').click();
    const px = (x: number, y: number) => page.evaluate(([x, y]) => (window as any).__nails.pixel(x, y), [x, y]);
    expect(await px(100, 500)).toEqual(hex('#1b7f86'));
    // keyboard: the nail is selected, arrows nudge it 3 px (10 with Shift)
    await page.getByTestId('canvas').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    s = await S(page);
    expect(Math.round(s.nails[0].x - 100.5)).toBe(3);
    expect(Math.round(s.nails[0].y - 500.5)).toBe(10);
    // shimmer adds sparkles inside the oval; matte had none
    const count = () => page.evaluate(() => {
      const n = (window as any).__nails, st = n.state, nail = st.nails[0];
      n.pixel(0, 0);                                                        // renders clean
      const cv = document.querySelector('canvas')!, d = cv.getContext('2d')!.getImageData(Math.round(nail.x) - 8, Math.round(nail.y) - 8, 17, 17).data;
      let off = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x1b) + Math.abs(d[i + 1] - 0x7f) + Math.abs(d[i + 2] - 0x86) > 30) off++;
      return off;
    });
    await page.keyboard.press('Tab');                                         // blur: hides the focus crosshair
    const matteOff = await count();
    await page.getByTestId('finish-shimmer').check();
    expect(matteOff).toBe(0);
    expect(await count()).toBeGreaterThan(0);
    await page.getByTestId('canvas').focus();
    await page.keyboard.press('Delete');
    expect((await S(page)).nails).toHaveLength(0);
    // auto-place drops five ovals on the demo hand's nail beds
    await page.getByTestId('auto').click();
    s = await S(page);
    expect(s.nails).toHaveLength(5);
    expect(s.nails).toEqual(s.fingertips);
  });

  test('keyboard sampling: arrow keys move the crosshair and Enter samples under it', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('tone-4').click();
    const bg = await page.evaluate(() => (window as any).__nails.pixel(10, 10));
    await page.getByTestId('canvas').focus();
    let s = await S(page);
    expect(s.cursor).toEqual({ x: 240, y: 300 });
    for (let i = 0; i < 23; i++) await page.keyboard.press('Shift+ArrowLeft');   // 230 px left, clamped at the edge
    for (let i = 0; i < 29; i++) await page.keyboard.press('Shift+ArrowUp');
    s = await S(page);
    expect(s.cursor).toEqual({ x: 10, y: 10 });
    await page.keyboard.press('Enter');
    s = await S(page);
    expect(s.skin.at).toEqual({ x: 10, y: 10 });
    // a patch of the backdrop is close to the backdrop pixel, and far from the tone we loaded
    lab(bg).forEach((v, j) => expect(Math.abs(s.skin.lab[j] - v)).toBeLessThan(3));
    await expect(page.getByTestId('status')).toContainText('Sampled skin');
  });

  test('look book: submit saves to localStorage, survives a reload, and delete removes it', async ({ page }) => {
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByTestId('shade-plum-jam').click();
    await page.getByTestId('finish-shimmer').check();
    await page.getByTestId('submit').click();
    await page.getByTestId('shade-mint-julep').click();
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('look')).toHaveCount(2);
    await expect(page.getByTestId('gallery-status')).toHaveText('Look saved to this browser.');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nail-studio.looks')!));
    expect(stored.map((l: any) => l.shades[0])).toEqual(['Mint Julep', 'Plum Jam']);
    expect(stored[0].img).toMatch(/^data:image\/jpeg;base64,/);
    expect(stored[0].img.length).toBeLessThan(60_000);                          // a small thumbnail, not the photo
    await page.reload();
    await expect(page.getByTestId('look')).toHaveCount(2);
    await expect(page.getByTestId('look').first().locator('img')).toHaveAttribute('alt', /Mint Julep, shimmer finish/);
    await page.getByTestId('look').first().getByTestId('delete-look').click();
    await expect(page.getByTestId('look')).toHaveCount(1);
    await expect(page.getByTestId('submit')).toBeFocused();
    await page.getByTestId('clear-gallery').click();
    await expect(page.getByTestId('look')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('nail-studio.looks'))).toBeNull();
  });

  test('a full storage quota is handled with a clear message, not an error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    await page.goto(URL);
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('gallery-status')).toContainText('Storage is full');
    await expect(page.getByTestId('look')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
