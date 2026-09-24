import { test, expect, type Page } from '@playwright/test';

// Independent WCAG 2 implementation used as the oracle for the page's numbers.
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const rampHexes = (page: Page, name: string) => Promise.all(STEPS.map((s) => page.getByTestId(`sw-${name}-${s}`).getAttribute('data-hex'))) as Promise<string[]>;

test.describe('Color System Studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/039-color-system-studio.html');
  });

  test('OKLCH → sRGB conversion matches reference values', async ({ page }) => {
    const out = await page.evaluate(() => {
      const c = (window as any).__color;
      return {
        red: c.oklchToHex(0.627955, 0.257683, 29.2339),
        green: c.oklchToHex(0.519752, 0.176858, 142.495),
        white: c.oklchToHex(1, 0, 0),
        black: c.oklchToHex(0, 0, 0),
        grey: c.oklchToHex(0.599871, 0, 0),
      };
    });
    expect(out).toEqual({ red: '#ff0000', green: '#008000', white: '#ffffff', black: '#000000', grey: '#808080' });
  });

  test('ramps have 11 valid steps getting darker, and follow the hue slider', async ({ page }) => {
    const hexes = await rampHexes(page, 'primary');
    hexes.forEach((h) => expect(h).toMatch(/^#[0-9a-f]{6}$/));
    const l = hexes.map(lum);
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);

    const before = await page.getByTestId('sw-primary-500').getAttribute('data-hex');
    await page.getByTestId('hue-0').fill('140');
    await expect(page.getByTestId('hue-out-0')).toHaveText('140°');
    await expect(page.getByTestId('sw-primary-500')).not.toHaveAttribute('data-hex', before!);
    const g = (await page.getByTestId('sw-primary-500').getAttribute('data-hex'))!;
    const [r, gr, b] = [1, 3, 5].map((i) => parseInt(g.slice(i, i + 2), 16));
    expect(gr).toBeGreaterThan(r); // a hue of 140° is green
    expect(gr).toBeGreaterThan(b);
    await expect(page.getByTestId('export')).toContainText(`--primary-500: ${g};`);
  });

  test('high chroma is gamut-clipped into sRGB, low chroma is not', async ({ page }) => {
    await page.getByTestId('hue-0').fill('145');
    await page.getByTestId('chroma-0').fill('0.37');
    await expect(page.getByTestId('chroma-out-0')).toHaveText('0.370');
    const clipped = Number(await page.getByTestId('clipped-0').getAttribute('data-count'));
    expect(clipped).toBeGreaterThanOrEqual(8);
    await expect(page.getByTestId('sw-primary-500')).toHaveAttribute('data-clipped', 'true');
    // the clipped result is still in gamut, and at the sRGB boundary (a little more chroma would fall out)
    const edge = await page.evaluate(() => {
      const c = (window as any).__color;
      const k = c.clipChroma(0.64, 0.37, 145);
      return { inside: c.inGamut(0.64, k.C, 145), outside: c.inGamut(0.64, k.C + 0.002, 145), clipped: k.clipped };
    });
    expect(edge).toEqual({ inside: true, outside: false, clipped: true });

    await page.getByTestId('chroma-0').fill('0.05');
    await expect(page.getByTestId('clipped-0')).toHaveAttribute('data-count', '0');
    await expect(page.getByTestId('clipped-0')).toHaveText('all steps inside sRGB');
  });

  test('contrast matrix ratios and badges agree with an independent WCAG calculation', async ({ page }) => {
    const white950 = page.getByTestId('cell-white-950');
    const fg = (await white950.getAttribute('data-fg'))!, bg = (await white950.getAttribute('data-bg'))!;
    const expected = Math.floor(ratio(fg, bg) * 100) / 100;
    await expect(white950).toHaveAttribute('data-ratio', expected.toFixed(2));
    await expect(white950.locator('small')).toHaveText(expected >= 7 ? 'AAA' : 'AA');
    await expect(page.getByTestId('cell-black-50')).toContainText('AAA');
    await expect(page.getByTestId('cell-white-50')).toContainText('FAIL');

    // switch the text palette and spot-check every cell in one row against the oracle
    await page.getByTestId('mx-text').selectOption('primary');
    for (const s of STEPS) {
      const cell = page.getByTestId(`cell-700-${s}`);
      const r = ratio((await cell.getAttribute('data-fg'))!, (await cell.getAttribute('data-bg'))!);
      await expect(cell).toHaveAttribute('data-ratio', (Math.floor(r * 100) / 100).toFixed(2));
      const g = r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA LG' : 'FAIL';
      await expect(cell.locator('small')).toHaveText(g);
    }
    expect(await page.getByTestId('cell-700-50').getAttribute('data-fg')).toBe(await page.getByTestId('sw-primary-700').getAttribute('data-hex'));
  });

  test('light and dark previews pass their checks; weak chroma choices are caught', async ({ page }) => {
    await expect(page.getByTestId('light-score')).toHaveText('8/8 checks pass');
    await expect(page.getByTestId('dark-score')).toHaveText('8/8 checks pass');
    const ck = page.getByTestId('ck-light-text-bg');
    await expect(ck).toHaveAttribute('data-pass', 'true');
    expect(Number(await ck.getAttribute('data-ratio'))).toBeGreaterThanOrEqual(4.5);

    // a bright yellow primary makes white-on-primary unreadable; the page should switch to a dark label
    await page.getByTestId('hue-0').fill('100');
    await page.getByTestId('chroma-0').fill('0.2');
    const on = page.getByTestId('ck-light-on-primary-primary');
    expect(Number(await on.getAttribute('data-ratio'))).toBeGreaterThanOrEqual(4.5);
  });

  test('export CSS and JSON tokens, add a palette, persist across reload', async ({ page }) => {
    const out = page.getByTestId('export');
    await expect(out).toContainText(':root {');
    await expect(out).toContainText('--neutral-950: #');
    await expect(out).toContainText('@media (prefers-color-scheme: dark)');
    await page.getByTestId('note-oklch').click();
    await expect(out).toContainText(/--primary-500: oklch\(64\.0% 0\.\d{3} 262\);/);

    await page.getByTestId('add-palette').click();
    await expect(page.getByTestId('name-3')).toHaveValue('success');
    await page.getByTestId('fmt-json').click();
    const json = JSON.parse((await out.textContent())!);
    expect(Object.keys(json)).toEqual(['primary', 'accent', 'neutral', 'success', 'semantic']);
    expect(Object.keys(json.success)).toHaveLength(11);
    expect(json.success['500'].$type).toBe('color');
    expect(json.semantic.dark.text.$value).toMatch(/^#[0-9a-f]{6}$/);

    await page.getByTestId('name-3').fill('Mint Leaf');
    await page.getByTestId('name-3').press('Enter');
    await page.reload();
    await expect(page.getByTestId('name-3')).toHaveValue('mint-leaf');
    await expect(page.getByTestId('fmt-json')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('sw-mint-leaf-500')).toBeVisible();
  });
});
