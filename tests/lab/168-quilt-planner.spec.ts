import { test, expect, Page } from '@playwright/test';

const URL = '/lab/168-quilt-planner.html';
const plan = (page: Page) => page.evaluate(() => (window as any).__quilt.plan);

// ---- independent oracles ----
const WOF = 42;
/** round up to the next ⅛ yard */
const yards = (inches: number) => Math.ceil((inches / 36) * 8 - 1e-9) / 8;
const FR: Record<number, string> = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' };
const fmt = (x: number) => { const n = Math.round(x * 8), w = Math.floor(n / 8), f = n % 8; return f ? (w ? `${w}${FR[f]}` : FR[f]) : String(w); };
/** strips of height h across 42 in, pieces of length w side by side */
const strips = (qty: number, w: number) => Math.ceil(qty / Math.floor(WOF / w));
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const Y = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toGrey = (y: number) => { const v = Math.round((y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055) * 255); const h = v.toString(16).padStart(2, '0'); return `#${h}${h}${h}`; };
/** backing: 4 in extra per side, 42 in widths joined with ½ in seams, the cheaper direction */
function backingInches(W: number, H: number) {
  const bw = W + 8, bh = H + 8, panels = (need: number) => { let k = 1; while (k * 42 - (k - 1) < need) k++; return k; };
  return Math.min(panels(bw) * bh, panels(bh) * bw);
}

async function pick(page: Page, block: string, size: string, bsize: number, border: number) {
  await page.getByTestId(`block-${block}`).click();
  await page.getByTestId('quilt-size').selectOption(size);
  await page.getByTestId('block-size').selectOption(String(bsize));
  await page.getByTestId('border').fill(String(border));
  await page.getByTestId('border').dispatchEvent('change');
}

test.describe('168 Quilt Planner', () => {
  test('the half-square triangle rule: finished + ⅞ in, checked against the seam geometry', async ({ page }) => {
    // Square of side s, corner at the origin, sewn ¼ in either side of the diagonal x + y = s and cut on it.
    // The seam line sits ¼ in in from the cut, i.e. x + y = s − ¼√2. The finished square starts ¼ in in from the
    // outer edges, so its leg along y = ¼ runs from x = ¼ to x = s − ¼√2 − ¼: finished = s − ½ − ¼√2.
    const finishedFrom = (s: number) => (s - Math.SQRT2 / 4 - 0.25) - 0.25;
    const exactAdd = 0.5 + Math.SQRT2 / 4;
    expect(exactAdd).toBeCloseTo(0.8536, 4);
    expect(Math.ceil(exactAdd * 8) / 8).toBe(7 / 8);                      // ⅞ is the exact figure rounded up to the ruler's ⅛
    await page.goto(URL);
    for (const f of [1.5, 2, 2.5, 3]) {
      const s = await page.evaluate((f) => (window as any).__quilt.hstCut(f), f);
      expect(s).toBe(f + 0.875);
      const got = finishedFrom(s);
      expect(got).toBeGreaterThanOrEqual(f);                              // never too small
      expect(got - f).toBeLessThan(1 / 32);                               // and only a sliver to trim
    }
    // in the UI: an 8 in HST block is a 4 × 4 grid of 2 in units, so squares are cut 2⅞ in
    await pick(page, 'hst', 'throw', 8, 0);
    const p = await plan(page);
    expect([p.cols, p.rows]).toEqual([8, 9]);
    const light = p.cut.find((c: any) => c.role === 'light');
    expect(light.w).toBe(2.875);
    expect(light.qty).toBe(8 * 72);                                       // 8 squares per block make 16 HSTs with their dark pair
    const row = page.locator('[data-testid=cut-row][data-role=light]');
    await expect(row.getByTestId('cut-size')).toHaveText('2⅞ in square');
    await expect(row).toContainText('makes 1152 HSTs with its pair');
  });

  test('nine-patch cutting list: cut = finished + ½ in, strips across 42 in, yardage rounded up to ⅛', async ({ page }) => {
    await page.goto(URL);
    // defaults: nine-patch, 9 in blocks, throw (60 × 72), 3 in border
    const p = await plan(page);
    expect([p.cols, p.rows]).toEqual([Math.round(54 / 9), Math.round(66 / 9)]);
    const n = p.cols * p.rows;
    await expect(page.getByTestId('dims')).toContainText(`${p.cols} × ${p.rows} = ${n} blocks of 9 in`);
    await expect(page.getByTestId('dims')).toContainText('finished 60 × 69 in');
    const cut = 3 + 0.5;
    const dark = page.locator('[data-testid=cut-row][data-role=dark]');
    await expect(dark.getByTestId('cut-size')).toHaveText('3½ in square');
    await expect(dark).toHaveAttribute('data-qty', String(5 * n));
    const dStrips = strips(5 * n, cut), lStrips = strips(4 * n, cut);
    expect(Math.floor(42 / 3.5)).toBe(12);
    await expect(dark).toHaveAttribute('data-strips', String(dStrips));
    await expect(page.locator('[data-testid=cut-row][data-role=light]')).toHaveAttribute('data-strips', String(lStrips));
    await expect(page.getByTestId('yards-dark')).toHaveText(`${fmt(yards(dStrips * cut))} yd`);
    await expect(page.getByTestId('yards-light')).toHaveText(`${fmt(yards(lStrips * cut))} yd`);
    expect(yards(dStrips * cut)).toBe(1.75);                             // 18 strips × 3½ = 63 in = 1.75 yd
    expect(yards(lStrips * cut)).toBe(1.375);                            // 14 × 3½ = 49 in = 1.36 → 1⅜
  });

  test('yardage always rounds up to the next ⅛ yd, and exact eighths stay put', async ({ page }) => {
    await page.goto(URL);
    const got = await page.evaluate(() => [4.5, 4.51, 36, 36.01, 49, 17.5, 0.1].map((x) => (window as any).__quilt.yd(x)));
    expect(got).toEqual([0.125, 0.25, 1, 1.125, 1.375, 0.5, 0.125]);
    // every yardage row in the UI, at several settings, is its inches rounded up to ⅛
    for (const [b, s, bs, bd] of [['logcabin', 'queen', 12, 4], ['geese', 'crib', 8, 2.5], ['railfence', 'king', 6, 6]] as const) {
      await pick(page, b, s, bs, bd);
      const p = await plan(page);
      for (const y of p.yards) {
        expect(y.yards).toBe(yards(y.inches));
        expect(y.yards * 8).toBe(Math.round(y.yards * 8));
        expect(y.yards).toBeGreaterThanOrEqual(y.inches / 36);
        await expect(page.getByTestId(`yards-${y.role}`)).toHaveText(`${fmt(y.yards)} yd`);
      }
    }
  });

  test('every block type: piece sizes and counts match the traditional construction', async ({ page }) => {
    await page.goto(URL);
    const expected: Record<string, (B: number) => [string, number, number, number][]> = {       // role, cut w, cut h, per block
      ninepatch: (B) => [['dark', B / 3 + 0.5, B / 3 + 0.5, 5], ['light', B / 3 + 0.5, B / 3 + 0.5, 4]],
      railfence: (B) => ['light', 'medium', 'dark'].map((r) => [r, B + 0.5, B / 3 + 0.5, 1] as [string, number, number, number]),
      // centre 2u, then logs 2u,3u (light) 3u,4u (dark), 4u,5u / 5u,6u, 6u,7u / 7u,8u: an 8u block
      logcabin: (B) => { const u = B / 8, o: [string, number, number, number][] = [['accent', 2 * u + 0.5, 2 * u + 0.5, 1]];
        [2, 3, 4, 5, 6, 7].forEach((k) => o.push(['light', k * u + 0.5, u + 0.5, 1]));
        [3, 4, 5, 6, 7, 8].forEach((k) => o.push(['dark', k * u + 0.5, u + 0.5, 1])); return o; },
      hst: (B) => [['light', B / 4 + 0.875, B / 4 + 0.875, 8], ['dark', B / 4 + 0.875, B / 4 + 0.875, 8]],
      geese: (B) => [['dark', B / 2 + 0.5, B / 4 + 0.5, 8], ['light', B / 4 + 0.5, B / 4 + 0.5, 16]],
    };
    const norm = (a: any[]) => a.map((x) => x.join('|')).sort();
    for (const [block, fn] of Object.entries(expected)) {
      for (const B of [6, 9, 12]) {
        await pick(page, block, 'twin', B, 0);
        const p = await plan(page);
        const n = p.cols * p.rows;
        const got = p.cut.filter((c: any) => c.role !== 'binding').map((c: any) => [c.role, c.w, c.h, c.qty / n]);
        expect(norm(got), `${block} ${B}`).toEqual(norm(fn(B)));
        // straight-cut pieces: their finished areas tile the block exactly
        if (block !== 'geese' && block !== 'hst') expect(fn(B).reduce((a, [, w, h, k]) => a + (w - 0.5) * (h - 0.5) * k, 0)).toBeCloseTo(B * B, 9);
      }
    }
  });

  test('block sizes that do not land on ⅛ in are disabled, and the page moves you to a valid one', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('block-logcabin').click();
    await page.getByTestId('block-size').selectOption('8');
    for (const [block, bad] of [['ninepatch', ['8', '10']], ['railfence', ['8', '10']], ['logcabin', []], ['hst', []], ['geese', []]] as const) {
      await page.getByTestId(`block-${block}`).click();
      await expect(page.getByTestId(`block-${block}`)).toHaveAttribute('aria-pressed', 'true');
      for (const v of ['6', '8', '9', '10', '12']) {
        const opt = page.locator(`[data-testid=block-size] option[value="${v}"]`);
        if ((bad as readonly string[]).includes(v)) await expect(opt).toBeDisabled(); else await expect(opt).toBeEnabled();
      }
      if (block === 'ninepatch') {
        await expect(page.getByTestId('block-size')).toHaveValue('6');                 // 8 in was not cuttable (8/3 = 2.667)
        await expect(page.getByTestId('size-hint')).toContainText('8 and 10 in are off');
      }
    }
  });

  test('binding: perimeter + 12 in, in 40 in usable lengths, at the chosen strip width', async ({ page }) => {
    await page.goto(URL);
    let p = await plan(page);
    expect([p.W, p.H]).toEqual([60, 69]);
    expect(p.binding.perim).toBe(2 * (60 + 69));
    expect(p.binding.length).toBe(258 + 12);
    expect(p.binding.strips).toBe(Math.ceil(270 / 40));                 // 7
    await expect(page.getByTestId('yards-binding')).toHaveText(`${fmt(yards(7 * 2.5))} yd`);   // 17.5 in → ½ yd
    const row = page.locator('[data-testid=cut-row][data-role=binding]');
    await expect(row.getByTestId('cut-size')).toHaveText('2½ in × WOF');
    await expect(row).toContainText('270 in joined');
    // a king quilt with 2¼ in binding
    await pick(page, 'hst', 'king', 12, 6);
    await page.getByTestId('binding').selectOption('2.25');
    p = await plan(page);
    const W = p.cols * 12 + 12, H = p.rows * 12 + 12;
    expect([p.W, p.H]).toEqual([W, H]);
    const s = Math.ceil((2 * (W + H) + 12) / 40);
    expect(p.binding.strips).toBe(s);
    await expect(page.getByTestId('yards-binding')).toHaveText(`${fmt(yards(s * 2.25))} yd`);
    await expect(page.locator('[data-testid=cut-row][data-role=binding]').getByTestId('cut-size')).toHaveText('2¼ in × WOF');
  });

  test('backing and borders: 4 in overhang, pieced 42 in widths, butted border strips', async ({ page }) => {
    await page.goto(URL);
    for (const [size, bd] of [['throw', 3], ['queen', 5], ['crib', 0], ['king', 4]] as const) {
      await pick(page, 'ninepatch', size, 9, bd);
      const p = await plan(page);
      expect(p.backing.w).toBe(p.W + 8);
      expect(p.backing.inches).toBe(backingInches(p.W, p.H));
      await expect(page.getByTestId('yards-backing')).toHaveText(`${fmt(yards(backingInches(p.W, p.H)))} yd`);
      if (bd > 0) {
        // two sides at the centre height, top and bottom across the bordered width, each + ½ in seams
        const total = 2 * (p.ch + 0.5) + 2 * (p.cw + 2 * bd + 0.5);
        let k = 1; while (k * 42 - 0.5 * (k - 1) < total) k++;
        expect(p.border.strips).toBe(k);
        expect(p.border.h).toBe(bd + 0.5);
        await expect(page.getByTestId('yards-border')).toHaveText(`${fmt(yards(k * (bd + 0.5)))} yd`);
      } else {
        await expect(page.getByTestId('yards-border')).toHaveCount(0);
      }
    }
    // the throw at 60 × 69: back 68 × 77, two panels run sideways (2 × 68 in) beats two long ones (2 × 77 in)
    await pick(page, 'ninepatch', 'throw', 9, 3);
    expect(backingInches(60, 69)).toBe(136);
    await expect(page.getByTestId('yards-backing')).toHaveText('3⅞ yd');
  });

  test('greyscale value check uses relative luminance, matching published L* values', async ({ page }) => {
    await page.goto(URL);
    // published CIE L* (D65) of the sRGB primaries: red 53.24, green 87.73, blue 32.30
    const L = (y: number) => 116 * Math.cbrt(y) - 16;
    expect(L(Y('#ff0000'))).toBeCloseTo(53.24, 1);
    expect(L(Y('#00ff00'))).toBeCloseTo(87.73, 1);
    expect(L(Y('#0000ff'))).toBeCloseTo(32.30, 1);
    expect(toGrey(Y('#808080'))).toBe('#808080');                         // a grey keeps its value
    await page.getByTestId('colour-dark').fill('#0000ff');
    await page.getByTestId('colour-light').fill('#00ff00');
    await expect(page.getByTestId('lstar-dark')).toHaveText('L* 32');
    await expect(page.getByTestId('lstar-light')).toHaveText('L* 88');
    await page.getByTestId('view-grey').click();
    await expect(page.getByTestId('view-grey')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('quilt')).toHaveAttribute('aria-label', /greyscale/);
    const fills = await page.evaluate(() => {
      const o: Record<string, string> = {};
      document.querySelectorAll('#quilt [data-role]').forEach((e) => { o[e.getAttribute('data-role')!] = e.getAttribute('fill')!; });
      return o;
    });
    expect(fills.dark).toBe(toGrey(Y('#0000ff')));
    expect(fills.light).toBe(toGrey(Y('#00ff00')));
    expect(fills.border).toBe(toGrey(Y('#2f4a3a')));
    expect(fills.binding).toBe(toGrey(Y('#7a2331')));
    for (const f of Object.values(fills)) expect(f).toMatch(/^#([0-9a-f]{2})\1\1$/);
    await page.getByTestId('view-colour').click();
    await expect(page.locator('#quilt [data-role=dark]').first()).toHaveAttribute('fill', '#0000ff');
  });

  test('value warnings: a "light" that reads dark, inverted pairs and low contrast are flagged', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('checks').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('checks')).toContainText('reads the way you meant');
    // a saturated red "light" fabric: L* 53 reads medium, and it is still lighter than the dark navy
    await page.getByTestId('colour-light').fill('#ff0000');
    await expect(page.locator('[data-check=mismatch-light]')).toContainText('meant as light but reads medium');
    await expect(page.locator('[data-check^=inverted]')).toHaveCount(0);
    // a light fabric darker than the dark one
    await page.getByTestId('colour-light').fill('#101820');
    await expect(page.locator('[data-check=inverted-light-dark]')).toBeVisible();
    // rail fence: medium and dark within 15 L*
    await page.getByTestId('block-railfence').click();
    await page.getByTestId('colour-light').fill('#f4efe2');
    await page.getByTestId('colour-medium').fill('#3b4f78');                // L* ≈ 34, next to the navy's ≈ 24
    const Lm = 116 * Math.cbrt(Y('#3b4f78')) - 16, Ld = 116 * Math.cbrt(Y('#233a66')) - 16;
    expect(Math.abs(Lm - Ld)).toBeLessThan(15);
    await expect(page.locator('[data-check=close-medium-dark]')).toBeVisible();
  });

  test('layout: block counts are the nearest fit inside the border for every quilt size', async ({ page }) => {
    await page.goto(URL);
    const targets: Record<string, [number, number]> = { crib: [36, 52], throw: [60, 72], twin: [70, 90], queen: [90, 108], king: [108, 108] };
    for (const [id, [tw, th]] of Object.entries(targets)) {
      await pick(page, 'geese', id, 10, 4);
      const p = await plan(page);
      const cols = Math.max(1, Math.round((tw - 8) / 10)), rows = Math.max(1, Math.round((th - 8) / 10));
      expect([p.cols, p.rows, p.W, p.H]).toEqual([cols, rows, cols * 10 + 8, rows * 10 + 8]);
      await expect(page.locator('#quilt .blk')).toHaveCount(cols * rows);
      await expect(page.getByTestId('quilt-size').locator(`option[value=${id}]`)).toHaveText(new RegExp(`${tw} × ${th} in`));
    }
  });

  test('print stylesheet keeps the cutting list and yardage and hides the controls', async ({ page }) => {
    await page.goto(URL);
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('cut-table')).toBeVisible();
    await expect(page.getByTestId('yard-table')).toBeVisible();
    await expect(page.getByTestId('print-summary')).toBeVisible();
    await expect(page.getByTestId('print-summary')).toContainText('Nine-patch, 6 × 7 blocks of 9 in');
    for (const id of ['blocks', 'fabrics', 'quilt', 'print', 'back-link', 'services-link']) await expect(page.getByTestId(id)).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByTestId('print-summary')).toBeHidden();
    await expect(page.getByTestId('services-link')).toHaveAttribute('href', '../index.html#services');
  });
});
