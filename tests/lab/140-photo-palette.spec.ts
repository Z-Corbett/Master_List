import { test, expect, Page } from '@playwright/test';

const URL = '/lab/140-photo-palette.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__palette.state);

type Band = { hex: string; rows: number };
/** A synthetic PNG built in the browser: horizontal bands of known colours on a 100-pixel-wide image. */
async function makePng(page: Page, bands: Band[]) {
  const url = await page.evaluate((bands) => {
    const H = bands.reduce((a, b) => a + b.rows, 0), c = document.createElement('canvas');
    c.width = 100; c.height = H;
    const g = c.getContext('2d')!;
    let y = 0;
    for (const b of bands) { g.fillStyle = b.hex; g.fillRect(0, y, 100, b.rows); y += b.rows; }
    return c.toDataURL('image/png');
  }, bands);
  return Buffer.from(url.split(',')[1], 'base64');
}
async function upload(page: Page, bands: Band[], name = 'synthetic.png') {
  await page.getByTestId('file').setInputFiles({ name, mimeType: 'image/png', buffer: await makePng(page, bands) });
  await expect(page.getByTestId('status')).toContainText(`Read ${name}`);
}
const algo = (page: Page, a: 'kmeans' | 'median') => page.locator(`input[name=algo][value=${a}]`).check();
async function setK(page: Page, k: number) {
  await page.getByTestId('k').evaluate((el: HTMLInputElement, k) => { el.value = String(k); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, k);
  await expect(page.getByTestId('k-out')).toHaveText(String(k));
}

// Independent colour maths: WCAG 2 relative luminance and contrast, sRGB → CIELAB (D65) and ΔE*ab 1976.
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const wcagL = (h: string) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const x = wcagL(a), y = wcagL(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function toLab(h: string) {
  const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a: string, b: string) => { const p = toLab(a), q = toLab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

const THREE: Band[] = [{ hex: '#d62828', rows: 50 }, { hex: '#1f5fd6', rows: 30 }, { hex: '#f5c518', rows: 20 }];
const FOUR: Band[] = [{ hex: '#2f6f73', rows: 40 }, { hex: '#f3e9d2', rows: 25 }, { hex: '#c4623f', rows: 20 }, { hex: '#6a4bc4', rows: 15 }];

test.describe('140 Photo Palette', () => {
  test('upload: a synthetic three-colour image gives the right colours and areas, read locally with no requests', async ({ page, baseURL }) => {
    await page.goto(URL);
    await expect(page.getByTestId('privacy')).toContainText('nothing is uploaded');
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await setK(page, 3);
    await upload(page, THREE);
    await expect(page.getByTestId('status')).toContainText('(100 × 100 px) in your browser');
    await expect(page.getByTestId('status')).toContainText('Nothing was uploaded');
    const s = await S(page);
    expect(s.source).toBe('upload: synthetic.png');
    expect(s.size).toEqual([100, 100]);
    expect(s.palette.map((p: any) => p.hex)).toEqual(THREE.map((b) => b.hex));
    s.palette.forEach((p: any, i: number) => expect(Math.abs(p.share - THREE[i].rows / 100)).toBeLessThanOrEqual(0.02));
    await expect(page.getByTestId('preview')).toHaveAttribute('aria-label', 'Your picture, synthetic.png');
    expect(requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith(baseURL!))).toEqual([]);
  });

  test('both algorithms recover a four-colour image within tolerance', async ({ page }) => {
    await page.goto(URL);
    await setK(page, 4);
    await upload(page, FOUR, 'four.png');
    for (const a of ['kmeans', 'median'] as const) {
      await algo(page, a);
      const s = await S(page);
      expect(s.algo).toBe(a);
      expect(s.palette).toHaveLength(4);
      for (const band of FOUR) {
        const hit = s.palette.find((p: any) => dE(p.hex, band.hex) < 2);
        expect(hit, `${a} finds ${band.hex}`).toBeTruthy();
        expect(Math.abs(hit.share - band.rows / 100), `${a} share of ${band.hex}`).toBeLessThanOrEqual(0.02);
      }
      expect(s.palette.reduce((x: number, p: any) => x + p.share, 0)).toBeCloseTo(1, 9);
    }
    await expect(page.getByTestId('method-note')).toContainText('Median cut');
    // asking for more colours than the picture has is reported, not faked
    await setK(page, 6);
    await expect(page.getByTestId('method-note')).toContainText('Only 4 colours could be found');
  });

  test('contrast matrix matches the WCAG 2 formula, and the formula matches published reference values', async ({ page }) => {
    await page.goto(URL);
    const C = (a: string, b: string) => page.evaluate(([a, b]) => (window as any).__palette.contrast(a, b), [a, b]);
    expect(await C('#ffffff', '#000000')).toBeCloseTo(21, 9);
    expect(await C('#767676', '#ffffff')).toBeCloseTo(4.54, 2);       // the classic lightest AA grey on white
    expect(await C('#777777', '#ffffff')).toBeLessThan(4.5);          // one step lighter fails (4.48)
    expect(await C('#0000ff', '#ffffff')).toBeCloseTo(8.59, 2);
    expect(await C('#ff0000', '#ffffff')).toBeCloseTo(4.0, 2);
    await upload(page, FOUR, 'four.png');
    const cells = await page.getByTestId('matrix').locator('td[data-ratio]').evaluateAll((tds) => tds.map((td) => ({ i: +td.getAttribute('data-i')!, j: +td.getAttribute('data-j')!, r: +td.getAttribute('data-ratio')!, level: td.getAttribute('data-level'), text: td.textContent })));
    const pal = (await S(page)).palette.map((p: any) => p.hex);
    expect(cells).toHaveLength(pal.length * (pal.length - 1));
    for (const c of cells) {
      const want = ratio(pal[c.i], pal[c.j]);
      expect(c.r).toBeCloseTo(want, 9);
      expect(c.text).toContain(want.toFixed(2));
      expect(c.level).toBe(want >= 4.5 ? 'AA' : want >= 3 ? 'AA large' : 'fail');
    }
    expect(cells.find((c) => c.i === 0 && c.j === 1)!.r).toBeCloseTo(cells.find((c) => c.i === 1 && c.j === 0)!.r, 12); // symmetric
  });

  test('suggested pairs all pass AA by the test\'s own formula', async ({ page }) => {
    await page.goto(URL);
    for (const demo of ['sunset', 'bluebonnets', 'desert']) {
      await page.getByTestId(`demo-${demo}`).click();
      const pairs = await page.getByTestId('pairs').locator('li[data-text]').evaluateAll((li) => li.map((l) => ({ t: l.getAttribute('data-text')!, b: l.getAttribute('data-bg')! })));
      expect(pairs.length, demo).toBeGreaterThan(0);
      for (const p of pairs) expect(ratio(p.t, p.b), `${demo}: ${p.t} on ${p.b}`).toBeGreaterThanOrEqual(4.5);
      const pal = (await S(page)).palette.map((x: any) => x.hex);
      for (const p of pairs) expect(pal).toContain(p.b);
    }
  });

  test('names: each colour takes the nearest entry of the built-in list by ΔE*ab', async ({ page }) => {
    await page.goto(URL);
    const names: { name: string; hex: string }[] = await page.evaluate(() => (window as any).__palette.names);
    expect(names).toHaveLength(40);
    const nearest = (h: string) => names.reduce((b, n) => (dE(h, n.hex) < dE(h, b.hex) ? n : b));
    await upload(page, THREE);
    let s = await S(page);
    expect(s.palette.map((p: any) => p.name).slice(0, 3)).toEqual(['Scarlet', 'Cobalt', 'Sunflower']);   // exact list colours
    for (const p of s.palette.slice(0, 3)) expect(p.dE).toBeLessThan(1e-6);
    for (const demo of ['sunset', 'desert', 'bluebonnets']) {
      await page.getByTestId(`demo-${demo}`).click();
      s = await S(page);
      for (const [i, p] of s.palette.entries()) {
        const n = nearest(p.hex);
        expect(p.name, `${demo} ${p.hex}`).toBe(n.name);
        expect(p.dE).toBeCloseTo(dE(p.hex, n.hex), 1);
        await expect(page.getByTestId(`name-${i}`)).toHaveText(n.name);
      }
    }
  });

  test('exports: exact CSS variables and JSON text for a known image', async ({ page }) => {
    await page.goto(URL);
    await setK(page, 3);
    await upload(page, THREE);
    await expect(page.getByTestId('css')).toHaveValue(
      ':root {\n' +
      '  --palette-1: #d62828; /* Scarlet, 50.0% */\n' +
      '  --palette-2: #1f5fd6; /* Cobalt, 30.0% */\n' +
      '  --palette-3: #f5c518; /* Sunflower, 20.0% */\n' +
      '}\n');
    const json = await page.getByTestId('json').inputValue();
    expect(json).toBe(`{
  "source": "upload: synthetic.png",
  "method": "k-means (CIELAB)",
  "colours": [
    {
      "hex": "#d62828",
      "name": "Scarlet",
      "share": 0.5
    },
    {
      "hex": "#1f5fd6",
      "name": "Cobalt",
      "share": 0.3
    },
    {
      "hex": "#f5c518",
      "name": "Sunflower",
      "share": 0.2
    }
  ]
}`);
    await algo(page, 'median');
    expect(JSON.parse(await page.getByTestId('json').inputValue()).method).toBe('median cut');
  });

  test('copy HEX and copy CSS reach the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(URL);
    await setK(page, 3);
    await upload(page, THREE);
    await page.getByTestId('copy-1').click();
    await expect(page.getByTestId('status')).toHaveText('Copied #1f5fd6.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#1f5fd6');
    await page.getByTestId('copy-css').click();
    await expect(page.getByTestId('status')).toHaveText('Copied the CSS variables.');
    // the Windows clipboard hands text back with CRLF line endings, so normalise them first
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.replace(/\r\n/g, '\n')).toBe(await page.getByTestId('css').inputValue());
    await expect(page.getByTestId('copy-0')).toHaveAttribute('aria-label', 'Copy #d62828');
  });

  test('demo scenes: drawn in the page, seeded, and the bluebonnet field has its blue', async ({ page }) => {
    await page.goto(URL);
    const s = await S(page);
    expect(s.source).toBe('demo: sunset');
    expect(s.palette).toHaveLength(5);
    await page.getByTestId('demo-bluebonnets').click();
    await expect(page.getByTestId('demo-bluebonnets')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('preview')).toHaveAttribute('aria-label', /bluebonnet/);
    await setK(page, 8);
    const b = await S(page);
    expect(b.palette).toHaveLength(8);
    const hue = (h: string) => { const [r, g, bl] = rgb(h).map((v) => v / 255), mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn; if (!d) return -1; const x = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };
    expect(b.palette.some((p: any) => hue(p.hex) >= 215 && hue(p.hex) <= 240 && p.share > 0.05)).toBe(true);
    // same seed, same scene, same palette; another page agrees
    const p2 = await page.context().newPage();
    await p2.goto(URL);
    await p2.getByTestId('demo-bluebonnets').click();
    await p2.getByTestId('k').evaluate((el: HTMLInputElement) => { el.value = '8'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    expect((await S(p2)).palette.map((p: any) => p.hex)).toEqual(b.palette.map((p: any) => p.hex));
    await p2.close();
    await page.getByTestId('seed').fill('8');
    await page.getByTestId('seed').press('Enter');
    await page.getByTestId('seed').blur();
    await expect.poll(async () => (await S(page)).seed).toBe(8);
    expect(page.url()).toContain('seed=8');
  });

  test('for your hobby: yarn stripes in proportion, an Ohio star, and a polish set linking to Nail Studio', async ({ page }) => {
    await page.goto(URL);
    await setK(page, 3);
    await upload(page, THREE);
    await expect(page.getByTestId('yarn-text')).toHaveText('Stripe repeat of 30 rows: 15 Scarlet, 9 Cobalt, 6 Sunflower.');
    await expect(page.getByTestId('quilt-text')).toContainText('Scarlet background');
    await expect(page.getByTestId('nails').locator('.bottle')).toHaveCount(3);
    await expect(page.getByTestId('nail-link')).toHaveAttribute('href', '../lab/133-nail-studio.html');
    await setK(page, 10);
    await page.getByTestId('demo-desert').click();
    await expect(page.getByTestId('nails').locator('.bottle')).toHaveCount(5);
  });

  test('a file that is not an image is refused politely and the palette is kept', async ({ page }) => {
    await page.goto(URL);
    const before = (await S(page)).palette;
    await page.getByTestId('file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByTestId('status')).toContainText('isn\'t an image');
    await expect(page.getByTestId('status')).toHaveClass(/err/);
    expect((await S(page)).palette).toEqual(before);
    await expect(page.getByLabel('Choose a photo')).toBeVisible();
  });
});
