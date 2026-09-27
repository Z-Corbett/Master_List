import { test, expect, Page } from '@playwright/test';

const URL = '/lab/138-bouquet-builder.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__bouquet.state);
const PHI = (1 + Math.sqrt(5)) / 2;

/** Hue and lightness from a computed CSS colour, the standard RGB → HSL conversion, written here independently. */
function hueOf(css: string) {
  const [r, g, b] = css.match(/[\d.]+/g)!.slice(0, 3).map((v) => Number(v) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, l: (max + min) / 2 * 100 };
}
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

/** Every stem on the stage, read from the SVG: role, flower, the rendered colour of its bloom, and its screen box. */
async function stems(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('#stage .stem')].map((g) => {
    const fill = g.querySelector('.bloom-fill');
    const box = g.querySelector('.hit')!.getBoundingClientRect();
    return { role: g.getAttribute('data-role')!, flower: g.getAttribute('data-flower')!, fill: fill ? getComputedStyle(fill).fill : '', top: box.top, bottom: box.bottom };
  }));
}
async function setHue(page: Page, h: number) {
  await page.getByTestId('hue').evaluate((el: HTMLInputElement, h) => { el.value = String(h); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, h);
}
const scheme = (page: Page, name: string) => page.locator(`input[name=scheme][value="${name}"]`).check();
const shape = (page: Page, name: string) => page.locator(`input[name=shape][value="${name}"]`).check();

// The colour-wheel definitions, from the test's side: which hues each scheme should use, by role.
const EXPECT: Record<string, (b: number) => number[]> = {
  monochrome: (b) => [b],
  analogous: (b) => [b, b + 30, b - 30],
  complementary: (b) => [b, b + 180],
  triadic: (b) => [b, b + 120, b + 240],
};

test.describe('138 Bouquet Builder', () => {
  test('complementary: every bloom is within tolerance of the base hue or its opposite, and both are used', async ({ page }) => {
    await page.goto(URL);
    for (const base of [340, 0, 125, 210]) {
      await setHue(page, base);
      await expect(page.getByTestId('hue-text')).toHaveText(`${base}°`);
      const all = (await stems(page)).filter((s) => s.role !== 'greenery');
      expect(all.length).toBeGreaterThanOrEqual(15);
      const hs = all.map((s) => ({ ...s, ...hueOf(s.fill) }));
      for (const s of hs) expect(Math.min(hueDist(s.h, base), hueDist(s.h, base + 180)), `${s.flower} hue ${s.h.toFixed(1)} vs ${base}`).toBeLessThanOrEqual(10);
      // the focal flowers carry the base hue, the secondaries its complement: 180° ± 20 apart
      const focal = hs.filter((s) => s.role === 'focal'), sec = hs.filter((s) => s.role === 'secondary');
      for (const f of focal) expect(hueDist(f.h, base)).toBeLessThanOrEqual(10);
      for (const s of sec) expect(hueDist(s.h, focal[0].h)).toBeGreaterThanOrEqual(160);
    }
  });

  test('analogous, triadic and monochrome hold their wheel relationships, and greenery stays green', async ({ page }) => {
    await page.goto(URL);
    for (const name of ['analogous', 'triadic', 'monochrome']) {
      await scheme(page, name);
      for (const base of [15, 200]) {
        await setHue(page, base);
        const all = await stems(page);
        const want = EXPECT[name](base);
        const blooms = all.filter((s) => s.role !== 'greenery').map((s) => ({ ...s, ...hueOf(s.fill) }));
        for (const s of blooms) expect(Math.min(...want.map((w) => hueDist(s.h, w))), `${name} ${base}: ${s.flower} at ${s.h.toFixed(1)}°`).toBeLessThanOrEqual(10);
        for (const w of want) expect(blooms.some((s) => hueDist(s.h, w) <= 10), `${name} ${base}: someone uses ${w}°`).toBe(true);
        if (name === 'monochrome') {
          const L = (role: string) => blooms.filter((s) => s.role === role).map((s) => s.l);
          expect(Math.max(...L('focal')) + 15).toBeLessThan(Math.min(...L('filler')));  // one hue, clearly different lightness
        }
      }
    }
    // greenery isn't part of the scheme: its fill is a green whatever the base hue
    const greens = await page.evaluate(() => [...document.querySelectorAll('#stage .stem[data-role=greenery] circle:not(.hit)')].slice(0, 5).map((c) => getComputedStyle(c).fill));
    for (const g of greens.filter((f) => f.startsWith('rgb'))) { const { h } = hueOf(g); expect(h).toBeGreaterThan(70); expect(h).toBeLessThan(170); }
    await expect(page.getByTestId('scheme-note')).toContainText('One hue');
  });

  test('odd-number grouping: every role comes in an odd count, for all sizes, shapes and many seeds', async ({ page }) => {
    await page.goto(URL);
    const bad = await page.evaluate(() => {
      const b = (window as any).__bouquet, out: string[] = [];
      let n = 0;
      for (const size of ['small', 'medium', 'large']) for (const shape of ['round', 'cascade', 'hand-tied']) for (let seed = 1; seed <= 40; seed++) {
        const a = b.generate({ seed, size, shape });
        for (const role of ['focal', 'secondary', 'filler', 'greenery']) {
          n++;
          const c = a.stems.filter((s: any) => s.role === role).length;
          if (c % 2 !== 1 || c !== a.counts[role] || c < 3) out.push(`${size}/${shape}/${seed} ${role}: ${c}`);
        }
      }
      return { out, n };
    });
    expect(bad.n).toBe(1440);
    expect(bad.out).toEqual([]);
    // and on the stage itself, counted from the SVG
    for (const size of ['small', 'medium', 'large']) {
      await page.getByTestId('size').selectOption(size);
      const st = await stems(page);
      for (const role of ['focal', 'secondary', 'filler', 'greenery']) {
        const c = st.filter((s) => s.role === role).length;
        expect(c % 2, `${size} ${role} = ${c}`).toBe(1);
        await expect(page.getByTestId(`n-${role}`)).toHaveText(String(c));
      }
    }
  });

  test('golden-ratio height: the tallest bloom stands φ vase-heights above the rim, measured on screen', async ({ page }) => {
    await page.goto(URL);
    for (const sh of ['round', 'cascade', 'hand-tied']) {
      await shape(page, sh);
      const vase = await page.getByTestId('vase-body').evaluate((el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
      const st = await stems(page);
      const minTop = Math.min(...st.map((s) => s.top));
      // the vase outline has a 2-unit stroke; its geometry is what matters, so measure from the path's own box
      const g = await page.getByTestId('vase-body').evaluate((el: SVGGraphicsElement) => { const b = el.getBBox(); const m = el.getScreenCTM()!; return { top: b.y * m.d + m.f, h: b.height * m.d }; });
      expect(vase.bottom - vase.top).toBeGreaterThan(g.h - 4);
      expect((g.top - minTop) / g.h, sh).toBeCloseTo(PHI, 2);
      const s = await S(page);
      expect(s.arrangement.ratio).toBeCloseTo(PHI, 9);
      if (sh === 'cascade') expect(st.some((x) => x.bottom > g.top + g.h * 0.2), 'a cascade trails below the rim').toBe(true);
    }
  });

  test('stems and cost: counts × editable prices, spares add one per ten rounded up, totals in cents', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('size').selectOption('large');
    const roles = ['focal', 'secondary', 'filler', 'greenery'];
    const prices: Record<string, number> = { focal: 4.35, secondary: 1.1, filler: 0.65, greenery: 2.05 };
    for (const r of roles) {
      await page.getByTestId(`price-${r}`).fill(String(prices[r]));
    }
    const st = await stems(page);
    const count = (r: string) => st.filter((s) => s.role === r).length;
    let total = 0;
    for (const r of roles) {
      const cents = count(r) * Math.round(prices[r] * 100);
      total += cents;
      await expect(page.getByTestId(`buy-${r}`)).toHaveText(String(count(r)));
      await expect(page.getByTestId(`sub-${r}`)).toHaveText('$' + (cents / 100).toFixed(2));
    }
    await expect(page.getByTestId('total')).toHaveText('$' + (total / 100).toFixed(2));
    // spares: n + ⌈n / 10⌉, e.g. 9 → 10, 11 → 13
    await page.getByTestId('spares').check();
    total = 0;
    for (const r of roles) {
      const buy = count(r) + Math.ceil(count(r) / 10);
      total += buy * Math.round(prices[r] * 100);
      await expect(page.getByTestId(`buy-${r}`)).toHaveText(String(buy));
    }
    await expect(page.getByTestId('total')).toHaveText('$' + (total / 100).toFixed(2));
    await expect(page.getByTestId('summary')).toContainText(`Total $${(total / 100).toFixed(2)}`);
  });

  test('deterministic per seed: same arrangement from the URL and from generate(); other seeds differ; Rearrange', async ({ page }) => {
    await page.goto(URL);
    const s = await S(page);
    expect(s.seed).toBe(7);
    const again = await page.evaluate(() => (window as any).__bouquet.generate({ seed: 7 }));
    expect(again).toEqual(s.arrangement);
    const svg = await page.getByTestId('stage').innerHTML();
    await page.reload();
    expect(await page.getByTestId('stage').innerHTML()).toBe(svg);
    const others = await page.evaluate(() => [1, 2, 3, 4].map((k) => JSON.stringify((window as any).__bouquet.generate({ seed: k }).stems.map((x: any) => [Math.round(x.cx), Math.round(x.cy)]))));
    expect(new Set(others).size).toBe(4);
    await page.getByTestId('rearrange').click();
    const n = (await S(page)).seed;
    expect(page.url()).toContain(`seed=${n}`);
    await expect(page.getByTestId('seed')).toHaveValue(String(n));
    await expect(page.getByTestId('summary')).toContainText(`seed ${n}`);
  });

  test('the illustrated set: fifteen flowers and three greens, and picking one redraws the stage', async ({ page }) => {
    await page.goto(URL);
    const fl = await page.evaluate(() => (window as any).__bouquet.flowers);
    expect(fl.filter((f: any) => f.role !== 'greenery')).toHaveLength(15);
    expect(fl.filter((f: any) => f.role === 'greenery')).toHaveLength(3);
    for (const f of fl) await expect(page.getByTestId(`pick-${f.id}`)).toHaveCount(1);
    await expect(page.locator('.pick svg')).toHaveCount(18);
    await page.getByTestId('pick-sunflower').check();
    await expect(page.locator('#stage .stem[data-role=focal]').first()).toHaveAttribute('data-flower', 'sunflower');
    await expect(page.locator('[data-testid=cost] tr[data-role=focal] td').first()).toContainText('Sunflower');
    // radio groups are keyboard operable: arrow keys move within the greenery choices
    await page.getByTestId('pick-eucalyptus').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('pick-fern')).toBeChecked();
    await expect(page.locator('#stage .stem[data-role=greenery]').first()).toHaveAttribute('data-flower', 'fern');
    await expect(page.getByTestId('stage')).toHaveAttribute('aria-label', /sunflower.*fern stems/);
  });

  test('hue wheel: clicking the wheel picks the hue at that angle; the slider works from the keyboard', async ({ page }) => {
    await page.goto(URL);
    const b = (await page.getByTestId('wheel').boundingBox())!;
    // 0° is at the top and hues run clockwise, so the right-hand edge is 90° and the bottom 180°
    await page.getByTestId('wheel').click({ position: { x: b.width * 0.93, y: b.height / 2 } });
    await expect(page.getByTestId('hue-text')).toHaveText('90°');
    await page.getByTestId('wheel').click({ position: { x: b.width / 2, y: b.height * 0.93 } });
    await expect(page.getByTestId('hue-text')).toHaveText('180°');
    await expect(page.getByTestId('hue')).toHaveValue('180');
    await page.getByTestId('hue').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('hue-text')).toHaveText('181°');
    await expect(page.getByTestId('wheel')).toHaveAttribute('aria-label', /181°, 1°/);   // complementary pair
  });

  test('cut lengths follow the vase: flowers stand φ × vase height above the rim', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('cuts')).toContainText(`stand about ${Math.round(PHI * 20)} cm above the rim`);
    await page.getByTestId('vase').fill('30');
    await page.getByTestId('vase').press('Enter');
    await page.getByTestId('vase').blur();
    await expect(page.getByTestId('cuts')).toContainText(`for a 30 cm vase: the flowers stand about ${Math.round(PHI * 30)} cm`);
    const txt = await page.getByTestId('cuts').textContent();
    const [lo, hi] = txt!.match(/between (\d+) and (\d+) cm/)!.slice(1).map(Number);
    expect(lo).toBeGreaterThan(30);                 // every stem reaches down into the vase
    expect(hi).toBeLessThanOrEqual(Math.ceil(30 + PHI * 30 + 30));
  });
});
