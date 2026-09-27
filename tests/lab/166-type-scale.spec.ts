import { test, expect, Page } from '@playwright/test';

const URL = '/lab/166-type-scale.html';
const RATIOS: [string, number][] = [
  ['Minor second', 1.067], ['Major second', 1.125], ['Minor third', 1.2], ['Major third', 1.25],
  ['Perfect fourth', 1.333], ['Augmented fourth', 1.414], ['Perfect fifth', 1.5], ['Golden ratio', 1.618],
];
const r4 = (x: number) => +x.toFixed(4);

/** WCAG 2.x relative luminance and contrast, written out from the spec. */
function wcag(a: string, b: string) {
  const L = (hex: string) => {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** The fluid value for step n, from the definition: straight line through (vwMin, min) and (vwMax, max). */
function fluid(n: number, o = { base: 16, ratio: 1.25, baseMax: 20, ratioMax: 1.333, vwMin: 360, vwMax: 1280 }) {
  const min = o.base * o.ratio ** n, max = o.baseMax * o.ratioMax ** n;
  const slope = (max - min) / (o.vwMax - o.vwMin);
  const b = min - slope * o.vwMin;
  return { min, max, css: `clamp(${r4(Math.min(min, max) / 16)}rem, ${r4(b / 16)}rem + ${r4(slope * 100)}vw, ${r4(Math.max(min, max) / 16)}rem)` };
}
const rows = (page: Page) => page.getByTestId('scale-table').locator('tbody tr').evaluateAll((trs) => trs.map((tr) => ({
  n: Number((tr as HTMLElement).dataset.step), px: tr.querySelector('[data-px]')!.textContent, rem: tr.querySelector('[data-rem]')!.textContent, lh: tr.querySelector('[data-lh]')!.textContent,
  aa: tr.querySelector('[data-aa]')!.textContent, sample: parseFloat(getComputedStyle(tr.querySelector('[data-sample]')!).fontSize),
})));

test.describe('166 Type Scale & Pairing', () => {
  test('every ratio: each step is base × ratio^n, shown to 2 decimals in px and 4 in rem', async ({ page }) => {
    await page.goto(URL);
    const opts = await page.getByTestId('ratio').locator('option').evaluateAll((os) => os.map((o) => [o.textContent, Number((o as HTMLOptionElement).value)]));
    expect(opts).toEqual(RATIOS.map(([n, v]) => [`${n} · ${v}`, v]));
    for (const [, ratio] of RATIOS) {
      await page.getByTestId('ratio').selectOption(String(ratio));
      const rs = await rows(page);
      expect(rs.map((r) => r.n)).toEqual([5, 4, 3, 2, 1, 0, -1, -2]);
      for (const r of rs) {
        const px = 16 * ratio ** r.n;
        expect(r.px, `${ratio}^${r.n}`).toBe(px.toFixed(2));
        expect(Number(r.rem)).toBe(r4(px / 16));
        expect(r.sample).toBeCloseTo(px, 1);                          // the sample really is set at that size
      }
    }
    // published anchor values: 16 × 1.25⁵ = 48.828125, 16 × 1.618² = 41.887…, 16 / 1.2² = 11.111…
    await page.getByTestId('ratio').selectOption('1.25');
    await expect(page.locator('tr[data-step="5"] [data-px]')).toHaveText('48.83');
    await page.getByTestId('ratio').selectOption('1.618');
    await expect(page.locator('tr[data-step="2"] [data-px]')).toHaveText('41.89');
    await page.getByTestId('ratio').selectOption('1.2');
    await expect(page.locator('tr[data-step="-2"] [data-px]')).toHaveText('11.11');
    // base and number of steps
    await page.getByTestId('base').fill('18');
    await page.getByTestId('up').fill('3');
    await page.getByTestId('down').fill('1');
    const rs = await rows(page);
    expect(rs.map((r) => r.n)).toEqual([3, 2, 1, 0, -1]);
    expect(rs[0].px).toBe((18 * 1.2 ** 3).toFixed(2));               // 31.10
    expect(rs[0].px).toBe('31.10');
  });

  test('line-height guidance is 1.5 − 0.1 × step, clamped to 1.1–1.6', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('up').fill('8');
    await page.getByTestId('down').fill('4');
    const rs = await rows(page);
    expect(rs).toHaveLength(13);
    for (const r of rs) expect(Number(r.lh), `step ${r.n}`).toBeCloseTo(Math.min(1.6, Math.max(1.1, 1.5 - 0.1 * r.n)), 9);
    expect(rs.map((r) => r.lh)).toEqual(['1.1', '1.1', '1.1', '1.1', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.6', '1.6', '1.6']);
  });

  test('clamp() text: min and max from the two ratios, slope and intercept reproduce both ends exactly', async ({ page }) => {
    await page.goto(URL);
    const text = (await page.getByTestId('css').textContent())!;
    for (let n = -2; n <= 5; n++) {
      const f = fluid(n);
      expect(text).toContain(`  --step-${n}: ${f.css};`);
      // parse the generated numbers back and evaluate the line at both viewport widths
      const m = new RegExp(`--step-${n}: clamp\\(([-\\d.]+)rem, ([-\\d.]+)rem \\+ ([-\\d.]+)vw, ([-\\d.]+)rem\\)`).exec(text)!;
      const [lo, b, v, hi] = m.slice(1).map(Number);
      const at = (w: number) => b * 16 + (v / 100) * w;
      expect(Math.abs(at(360) - f.min), `step ${n} at 360`).toBeLessThan(0.01);
      expect(Math.abs(at(1280) - f.max), `step ${n} at 1280`).toBeLessThan(0.01);
      expect(lo * 16).toBeCloseTo(Math.min(f.min, f.max), 2);
      expect(hi * 16).toBeCloseTo(Math.max(f.min, f.max), 2);
    }
    // other settings: the formula still holds
    await page.getByTestId('vw-min').fill('400');
    await page.getByTestId('vw-max').fill('1440');
    await page.getByTestId('base-max').fill('22');
    await page.getByTestId('ratio-max').selectOption('1.618');
    const t2 = (await page.getByTestId('css').textContent())!;
    for (let n = -2; n <= 5; n++) expect(t2).toContain(`  --step-${n}: ${fluid(n, { base: 16, ratio: 1.25, baseMax: 22, ratioMax: 1.618, vwMin: 400, vwMax: 1440 }).css};`);
    expect(t2.split('\n')[0]).toBe('/* Fluid type scale: 16px × Major third (1.25) at 400px → 22px × Golden ratio (1.618) at 1440px */');
  });

  test('resizing the viewport: computed font-size hits the minimum at 360 px, the maximum at 1280 px and a straight line between', async ({ page }) => {
    await page.goto(URL);
    const sizes = () => page.getByTestId('fluid-demo').locator('[data-fluid]').evaluateAll((els) => els.map((e) => [Number(e.getAttribute('data-fluid')), parseFloat(getComputedStyle(e).fontSize)]));
    /** the preferred value alone, without clamp(), applied to a probe element: does the line itself pass through both ends? */
    const probe = (n: number) => page.evaluate((k) => {
      const css = document.querySelector('[data-testid=css]')!.textContent!;
      const m = new RegExp(`--step-${k}: clamp\\([^,]+, ([^,]+), [^)]+\\)`).exec(css)!;
      const el = document.createElement('div'); el.style.fontSize = `calc(${m[1]})`; document.body.appendChild(el);
      const v = parseFloat(getComputedStyle(el).fontSize); el.remove(); return v;
    }, n);
    for (const [w, pick] of [[360, 'min'], [1280, 'max'], [820, 'mid'], [300, 'min'], [1600, 'max']] as const) {
      await page.setViewportSize({ width: w, height: 800 });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(w);
      const got = await sizes();
      expect(got.map(([n]) => n)).toEqual([4, 3, 2, 1, 0, -1]);
      for (const [n, px] of got) {
        const f = fluid(n);
        const want = pick === 'min' ? f.min : pick === 'max' ? f.max : f.min + (f.max - f.min) * (820 - 360) / (1280 - 360);
        expect(Math.abs(px - want), `step ${n} at ${w}px: ${px} vs ${want}`).toBeLessThan(0.02);
      }
      if (w === 360 || w === 1280) for (const n of [5, 0, -2]) {
        const f = fluid(n);
        expect(Math.abs((await probe(n)) - (w === 360 ? f.min : f.max)), `preferred value, step ${n} at ${w}`).toBeLessThan(0.02);
      }
    }
  });

  test('measure counter agrees with an independent word-by-word layout, and the verdict follows 45–75 characters', async ({ page }) => {
    await page.goto(URL);
    /** Lay the same text out word by word in a clone of the paragraph and count characters per full line. */
    const oracle = () => page.evaluate(() => {
      const p = document.querySelector('#mtext') as HTMLElement;
      const c = p.cloneNode(false) as HTMLElement;
      c.removeAttribute('id'); c.removeAttribute('data-testid');
      Object.assign(c.style, { position: 'absolute', visibility: 'hidden', width: p.clientWidth + 'px', left: '0', top: '0' });
      const words = p.textContent!.trim().split(/\s+/);
      words.forEach((w, i) => { const s = document.createElement('span'); s.textContent = w; c.appendChild(s); if (i < words.length - 1) c.appendChild(document.createTextNode(' ')); });
      p.parentElement!.appendChild(c);
      const lines: string[][] = []; let top: number | null = null;
      for (const s of c.querySelectorAll('span')) { const t = (s as HTMLElement).offsetTop; if (top === null || Math.abs(t - top) > 2) { lines.push([]); top = t; } lines[lines.length - 1].push(s.textContent!); }
      c.remove();
      const lens = lines.map((l) => l.join(' ').length);
      const full = lens.slice(0, -1);
      return { avg: full.reduce((a, b) => a + b, 0) / full.length, lines: lens.length };
    });
    for (const w of ['300', '560', '900']) {
      await page.getByTestId('mw').fill(w);
      const o = await oracle();
      // Word-by-word spans can wrap a word differently from the page's own measurement under some fonts
      // (CI's Linux fonts gave 94.7 vs 94.5), so agree within one character and one line, not to the digit.
      await expect.poll(async () => Math.abs(parseFloat((await page.getByTestId('cpl').textContent())!) - o.avg)).toBeLessThanOrEqual(1);
      expect(Math.abs(parseInt((await page.getByTestId('lines').textContent())!, 10) - o.lines)).toBeLessThanOrEqual(1);
      const shown = parseFloat((await page.getByTestId('cpl').textContent())!);
      const verdict = shown < 45 ? 'Short' : shown > 75 ? 'Long' : 'Comfortable';
      await expect(page.getByTestId('measure-verdict')).toContainText(verdict);
    }
    await page.getByTestId('mw').fill('200');
    await expect(page.getByTestId('measure-verdict')).toContainText('Short');
    await page.getByTestId('fit-measure').click();
    const o = await oracle();
    const room = await page.evaluate(() => { const b = document.querySelector('#mbox')!; return b.getBoundingClientRect().width + 1 >= Number((document.querySelector('#mw') as HTMLInputElement).value); });
    if (room) {
      expect(o.avg).toBeGreaterThanOrEqual(45);
      expect(o.avg).toBeLessThanOrEqual(75);
      await expect(page.getByTestId('measure-verdict')).toHaveText('Comfortable (45–75)');
      await expect(page.getByTestId('fit-status')).toContainText('for about 66 characters');
    } else {
      // on a phone the column is capped by the screen: the page says so, with the real count, instead of pretending
      await expect(page.getByTestId('fit-status')).toHaveText(`This screen is too narrow for 66 characters at this size: the widest column here holds about ${Math.round(o.avg)}.`);
    }
    // a wide desktop always has room
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('fit-measure').click();
    const wide = await oracle();
    expect(wide.avg).toBeGreaterThanOrEqual(55);
    expect(wide.avg).toBeLessThanOrEqual(70);
    await expect(page.getByTestId('measure-verdict')).toHaveText('Comfortable (45–75)');
  });

  test('contrast: the WCAG ratio matches published values, large steps use the 3:1 rule, and Adjust fixes a failing colour', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('fg').fill('#777777');
    await page.getByTestId('bg').fill('#ffffff');
    // #777 on white is the textbook near-miss: 4.48:1
    expect(wcag('#777777', '#ffffff')).toBeCloseTo(4.478, 3);
    await expect(page.getByTestId('contrast')).toHaveText('4.48:1. Body text: fails AA. Large text: passes AA.');
    const rs = await rows(page);
    for (const r of rs) {
      const px = 16 * 1.25 ** r.n, large = px >= 24 || (r.n >= 1 && px >= 18.66);
      expect(r.aa, `step ${r.n}`).toBe(large ? 'AA large' : 'Fails AA');
    }
    await page.getByTestId('fg').fill('#000000');
    await expect(page.getByTestId('contrast')).toHaveText('21.00:1. Body text: passes AAA. Large text: passes AAA.');
    // a pale grey on cream, then the fix
    await page.getByTestId('fg').fill('#b0a898');
    await page.getByTestId('bg').fill('#fbf7ef');
    expect(wcag('#b0a898', '#fbf7ef')).toBeLessThan(3);
    await page.getByTestId('fix-contrast').click();
    const fixed = await page.getByTestId('fg').inputValue();
    expect(wcag(fixed, '#fbf7ef')).toBeGreaterThanOrEqual(4.5);
    expect(wcag(fixed, '#fbf7ef')).toBeLessThan(4.8);                    // it stops soon after passing, not at black
    await expect(page.getByTestId('contrast')).toContainText(`Text adjusted to ${fixed}.`);
    await expect(page.getByTestId('css')).toContainText(`--text: ${fixed};`);
    // on a dark background it lightens instead
    await page.getByTestId('bg').fill('#202020');
    await page.getByTestId('fg').fill('#404040');
    await page.getByTestId('fix-contrast').click();
    expect(wcag(await page.getByTestId('fg').inputValue(), '#202020')).toBeGreaterThanOrEqual(4.5);
  });

  test('pairings use only system and generic font stacks: no web fonts, no font requests', async ({ page }) => {
    const fontReqs: string[] = [];
    page.on('request', (r) => { if (r.resourceType() === 'font' || /\.(woff2?|ttf|otf)(\?|$)/.test(r.url())) fontReqs.push(r.url()); });
    await page.goto(URL);
    const cards = page.getByTestId('pairs').locator('button.pair');
    await expect(cards).toHaveCount(6);
    const generic = /(^|,\s*)(serif|sans-serif|monospace|system-ui)\s*$/;
    const fams = await cards.locator('span[style]').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.fontFamily));
    expect(fams.length).toBe(24);
    for (const f of fams) expect(f, f).toMatch(generic);
    // no @font-face and no url() anywhere in the page's CSS
    const cssText = await page.evaluate(() => [...document.styleSheets].map((s) => [...s.cssRules].map((r) => r.cssText).join('\n')).join('\n'));
    expect(cssText).not.toContain('@font-face');
    expect(cssText).not.toMatch(/url\(/);
    expect(await page.evaluate(() => (document as any).fonts.size)).toBe(0);
    // choosing a pairing restyles the page and the exported CSS
    await page.getByTestId('pair-slab').click();
    await expect(page.getByTestId('pair-slab')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pair-humanist')).toHaveAttribute('aria-pressed', 'false');
    const body = await page.getByTestId('measure-text').evaluate((e) => getComputedStyle(e).fontFamily);
    expect(body).toContain('system-ui');
    await expect(page.getByTestId('css')).toContainText('--font-head: Rockwell, "Rockwell Nova", "Roboto Slab", "DejaVu Serif", serif;');
    await page.waitForLoadState('load');
    expect(fontReqs).toEqual([]);
  });

  test('exported CSS: exact custom-property text in fluid and static modes, and Copy puts it on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(URL);
    const lh = (n: number) => +Math.min(1.6, Math.max(1.1, 1.5 - 0.1 * n)).toFixed(2);
    const steps = [5, 4, 3, 2, 1, 0, -1, -2];
    const tail = ['  --measure: 66ch;', '  --font-head: Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", sans-serif;', '  --font-body: Charter, "Bitstream Charter", "Sitka Text", Cambria, serif;', '  --text: #1d1b16;', '  --bg: #fbf7ef;', '}'];
    const expectFluid = [
      '/* Fluid type scale: 16px × Major third (1.25) at 360px → 20px × Perfect fourth (1.333) at 1280px */', ':root {',
      ...steps.map((n) => `  --step-${n}: ${fluid(n).css};`), ...steps.map((n) => `  --lh-${n}: ${lh(n)};`), ...tail,
    ].join('\n');
    await expect(page.getByTestId('css')).toHaveText(expectFluid);
    await page.getByTestId('copy').click();
    await expect(page.getByTestId('copy-status')).toHaveText(`Copied ${expectFluid.split('\n').length} lines of CSS.`);
    // the Windows clipboard stores line breaks as CRLF, so compare with normalised line endings
    const clip = () => page.evaluate(() => navigator.clipboard.readText()).then((t) => t.replace(/\r\n/g, '\n'));
    expect(await clip()).toBe(expectFluid);
    // static mode: plain rem values, same line heights
    await page.getByTestId('mode-static').click();
    await expect(page.getByTestId('mode-static')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('vw-min')).toBeDisabled();
    const expectStatic = ['/* Type scale: 16px × Major third (1.25) */', ':root {',
      ...steps.map((n) => `  --step-${n}: ${r4(16 * 1.25 ** n / 16)}rem;`), ...steps.map((n) => `  --lh-${n}: ${lh(n)};`), ...tail].join('\n');
    await expect(page.getByTestId('css')).toHaveText(expectStatic);
    expect(expectStatic).toContain('--step-5: 3.0518rem;');                 // 48.828125 / 16
    await page.getByTestId('copy').click();
    await expect.poll(clip).toBe(expectStatic);
    // the CSS the page applies to itself is the same text it exports
    expect(await page.locator('#scaleStyle').textContent()).toBe(expectStatic);
  });
});
