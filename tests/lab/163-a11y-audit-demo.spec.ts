import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PAGE = '/lab/163-a11y-audit-demo.html';

// The success criteria each issue must cite, written out from the WCAG 2.2 recommendation (number, name, level).
const EXPECTED_SC: Record<string, string[]> = {
  alt: ['1.1.1 Non-text Content (A)'],
  contrast: ['1.4.3 Contrast (Minimum) (AA)'],
  label: ['4.1.2 Name, Role, Value (A)', '3.3.2 Labels or Instructions (A)'],
  divbutton: ['2.1.1 Keyboard (A)', '4.1.2 Name, Role, Value (A)'],
  focus: ['2.4.7 Focus Visible (AA)'],
  heading: ['1.3.1 Info and Relationships (A)'],
  skip: ['2.4.1 Bypass Blocks (A)'],
  trap: ['2.1.2 No Keyboard Trap (A)'],
  coloronly: ['1.4.1 Use of Color (A)', '3.3.1 Error Identification (A)'],
  motion: ['2.2.2 Pause, Stop, Hide (A)'],
  target: ['2.5.8 Target Size (Minimum) (AA)'],
  lang: ['3.1.2 Language of Parts (AA)'],
};
const IDS = Object.keys(EXPECTED_SC);

// WCAG 2.x relative luminance and contrast ratio, computed here rather than borrowed from the page.
function luminance([r, g, b]: number[]) {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: number[], b: number[]) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const statuses = (page: Page) => page.getByTestId('check').evaluateAll((els) => Object.fromEntries(els.map((e) => [(e as HTMLElement).dataset.id!, (e as HTMLElement).dataset.status!])));
const toggle = (page: Page, id: string) => page.getByTestId(`fix-${id}`);

/** Text colour and effective background of an element, as the browser computed them. */
const colours = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => {
  const p = (s: string) => s.match(/[\d.]+/g)!.map(Number);
  let n: Element | null = el, bg = [255, 255, 255];
  while (n) { const c = p(getComputedStyle(n).backgroundColor); if ((c[3] ?? 1) > 0.99) { bg = c.slice(0, 3); break; } n = n.parentElement; }
  return { fg: p(getComputedStyle(el).color).slice(0, 3), bg };
});

test.describe('163 Accessibility Audit demo', () => {
  test('on load all twelve planted issues are detected, each citing the right success criteria', async ({ page }) => {
    await page.goto(PAGE);
    expect(await statuses(page)).toEqual(Object.fromEntries(IDS.map((id) => [id, 'fail'])));
    await expect(page.getByTestId('score')).toHaveText('0/12');
    await expect(page.getByTestId('summary')).toHaveText('0 of 12 in-page checks pass, 12 fail.');
    for (const id of IDS) {
      const row = page.locator(`[data-testid=check][data-id="${id}"]`);
      await expect(row.getByTestId('sc')).toHaveText(EXPECTED_SC[id]);
      await expect(row.getByTestId('evidence')).not.toBeEmpty();
    }
    await expect(page.locator('[data-id="target"]')).toContainText('New in WCAG 2.2.');
  });

  test('each fix clears exactly its own check, and breaking it again brings the failure back', async ({ page }) => {
    await page.goto(PAGE);
    for (const id of IDS) {
      await toggle(page, id).click();
      const s = await statuses(page);
      expect(s[id], `${id} fixed`).toBe('pass');
      expect(Object.entries(s).filter(([k, v]) => k !== id && v === 'pass'), `only ${id} changed`).toEqual([]);
      await expect(page.getByTestId('score')).toHaveText('1/12');
      await toggle(page, id).click();
      expect((await statuses(page))[id], `${id} broken again`).toBe('fail');
    }
    await page.getByTestId('fix-all').click();
    expect(Object.values(await statuses(page)).every((v) => v === 'pass')).toBe(true);
    await expect(page.getByTestId('summary')).toHaveText('12 of 12 in-page checks pass, 0 fail.');
  });

  test('contrast: the WCAG formula, checked against published values, agrees with the page before and after the fix', async ({ page }) => {
    // reference values: black on white is 21:1; #767676 on white is the lightest grey at 4.54:1; #777777 just misses at 4.48:1
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast(hex('#767676'), [255, 255, 255])).toBeCloseTo(4.54, 2);
    expect(contrast(hex('#777777'), [255, 255, 255])).toBeCloseTo(4.48, 2);

    await page.goto(PAGE);
    const broken = await colours(page, '[data-testid=price]');
    const r0 = contrast(broken.fg, broken.bg);
    expect(r0).toBeLessThan(4.5);
    await expect(page.locator('[data-id="contrast"] [data-testid=evidence]')).toContainText(`at ${r0.toFixed(2)}:1 (needs 4.5:1)`);

    await toggle(page, 'contrast').click();
    const good = await colours(page, '[data-testid=price]');
    expect(contrast(good.fg, good.bg)).toBeGreaterThanOrEqual(4.5);
    // and every other piece of visible text in the sample meets its own threshold, by the test's own scan
    const texts = await page.getByTestId('demo').evaluate((demo) => {
      const p = (s: string) => s.match(/[\d.]+/g)!.map(Number);
      const out: { t: string; fg: number[]; bg: number[]; large: boolean }[] = [];
      for (const el of demo.querySelectorAll('*')) {
        if (!el.getClientRects().length || el.closest('[hidden]')) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
        let n: Element | null = el, bg = [255, 255, 255];
        while (n) { const c = p(getComputedStyle(n).backgroundColor); if ((c[3] ?? 1) > 0.99) { bg = c.slice(0, 3); break; } n = n.parentElement; }
        const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
        out.push({ t: el.textContent!.trim().slice(0, 20), fg: p(cs.color).slice(0, 3), bg, large: size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) });
      }
      return out;
    });
    expect(texts.length).toBeGreaterThan(15);
    for (const x of texts) expect(contrast(x.fg, x.bg), x.t).toBeGreaterThanOrEqual(x.large ? 3 : 4.5);
    await expect(page.locator('[data-id="contrast"]')).toHaveAttribute('data-status', 'pass');
  });

  test('target size: measured quantity buttons are under 24 px and crowded, then at least 24 px once fixed', async ({ page }) => {
    await page.goto(PAGE);
    const measure = async () => {
      const a = (await page.getByTestId('qty-minus').first().boundingBox())!, b = (await page.getByTestId('qty-plus').first().boundingBox())!;
      return { a, b, gap: Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2)) };
    };
    const m0 = await measure();
    expect(m0.a.width).toBeLessThan(24);
    expect(m0.a.height).toBeLessThan(24);
    expect(m0.gap).toBeLessThan(24); // two undersized targets whose 24 px circles overlap: the spacing exception does not apply
    await expect(page.locator('[data-id="target"] [data-testid=evidence]')).toContainText(`${Math.round(m0.a.width)} × ${Math.round(m0.a.height)} px`);
    await toggle(page, 'target').click();
    const m1 = await measure();
    for (const r of [m1.a, m1.b]) { expect(r.width).toBeGreaterThanOrEqual(24); expect(r.height).toBeGreaterThanOrEqual(24); }
    await expect(page.locator('[data-id="target"]')).toHaveAttribute('data-status', 'pass');
  });

  test('keyboard trap: broken, Tab and Escape stay in the modal and only "Exit demo" gets out; fixed, Escape closes it', async ({ page }) => {
    await page.goto(PAGE);
    const opener = page.getByTestId('quick-view').first();
    const modal = page.getByTestId('modal');
    const inModal = () => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#qv-box'));
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('qv-link')).toBeFocused();
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); expect(await inModal(), `Tab ${i + 1}`).toBe(true); }
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Shift+Tab'); expect(await inModal()).toBe(true); }
    await page.keyboard.press('Escape');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('modal-close')).not.toHaveJSProperty('tagName', 'BUTTON');
    // the visible harness control is always reachable and always works
    const exit = page.getByTestId('exit-demo');
    await expect(exit).toBeVisible();
    for (let i = 0; i < 4 && !(await exit.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(exit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();

    await toggle(page, 'trap').click();
    await expect(page.locator('[data-id="trap"]')).toHaveAttribute('data-status', 'pass');
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(modal).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close quick view' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('focus visible: a keyboard-focused link shows no outline until the fix, then a solid one', async ({ page }) => {
    await page.goto(PAGE);
    const shop = page.getByTestId('demo').getByRole('link', { name: 'Shop' });
    const outline = () => shop.evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), fv: el.matches(':focus-visible') }; });
    await page.getByTestId('demo').evaluate((d) => { d.setAttribute('tabindex', '-1'); (d as HTMLElement).focus(); });
    await page.keyboard.press('Tab');
    await expect(shop).toBeFocused();
    expect(await outline()).toEqual({ style: 'none', width: expect.any(Number), fv: true });
    await toggle(page, 'focus').click();
    await shop.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(shop).toBeFocused();
    const o = await outline();
    expect(o.style).toBe('solid');
    expect(o.width).toBeGreaterThanOrEqual(2);
  });

  test('motion: the banner ignores reduced motion until fixed, and the fix adds a working pause button', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(PAGE);
    const running = () => page.getByTestId('promo').evaluate((p) => p.getAnimations({ subtree: true }).map((a) => a.playState));
    expect(await running()).toEqual(['running']);
    await expect(page.locator('[data-id="motion"] [data-testid=evidence]')).toContainText('no pause control and no reduced-motion rule');
    await toggle(page, 'motion').click();
    expect(await running()).toEqual([]);
    await expect(page.locator('[data-id="motion"]')).toHaveAttribute('data-status', 'pass');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(running).toEqual(['running']);
    const pause = page.getByTestId('promo-pause');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    expect(await running()).toEqual(['paused']);
    await page.getByTestId('audit').getByRole('button', { name: 'Fix everything' }).click();
    await expect(page.locator('[data-id="motion"]')).toHaveAttribute('data-status', 'pass');
  });

  test('the markup fixes are real: names, roles, heading levels, lang, alt and a text error, checked with accessibility locators', async ({ page }) => {
    await page.goto(PAGE);
    const demo = page.getByTestId('demo');
    await expect(demo.getByRole('textbox', { name: 'Email' })).toHaveCount(0);
    await expect(demo.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
    await expect(demo.getByRole('heading', { level: 3, name: 'Amber Jar' })).toHaveCount(0);
    await expect(demo.getByRole('link', { name: 'Skip to products' })).toHaveCount(0);
    await expect(page.getByTestId('frag')).not.toHaveAttribute('lang', /.+/);
    await expect(demo.locator('img:not([alt])')).toHaveCount(1);
    await expect(page.getByTestId('nl-email')).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('fix-all').click();
    await expect(demo.getByRole('textbox', { name: 'Email' })).toHaveCount(1);
    await expect(demo.getByRole('button', { name: 'Add to cart' })).toHaveCount(3);
    await expect(demo.getByRole('heading', { level: 3, name: 'Amber Jar' })).toHaveCount(1);
    await expect(demo.getByRole('img', { name: 'Amber glass jar candle with a wooden lid' })).toBeVisible();
    await expect(page.getByTestId('frag')).toHaveAttribute('lang', 'es');
    await expect(page.getByTestId('nl-email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('nl-email')).toHaveAccessibleDescription('⚠ Enter a full email address, like name@example.com.');
    // the skip link is now the first Tab stop in the sample and moves focus to the products
    await demo.evaluate((d) => { d.setAttribute('tabindex', '-1'); (d as HTMLElement).focus(); });
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#demo-main')).toBeFocused();
    // the real button still works from the keyboard
    await demo.getByRole('button', { name: 'Add to cart' }).first().press('Enter');
    await expect(demo.getByRole('link', { name: 'Cart (3)' })).toBeVisible();
  });

  test('the exported Markdown report lists every criterion and matches the live results', async ({ page }) => {
    await page.goto(PAGE);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
    expect(dl.suggestedFilename()).toBe('a11y-audit-bramblewick.md');
    const md = readFileSync((await dl.path())!, 'utf8');
    expect(md.startsWith('# Accessibility audit: Bramblewick Goods (fictional sample site)\n')).toBe(true);
    expect(md).toContain('not Lighthouse, axe or an official score');
    expect(md).toContain('**Result: 0 of 12 checks pass, 12 fail.**');
    expect(md).toContain('| 2 | Price text has low contrast | 1.4.3 Contrast (Minimum) | AA | Fail |');
    expect(md).toContain('| 11 | Quantity buttons are too small | 2.5.8 Target Size (Minimum) | AA | Fail |');
    expect(md).toContain('| 4 | "Add to cart" is a clickable div | 2.1.1 Keyboard; 4.1.2 Name, Role, Value | A | Fail |');
    expect(md).toContain('- Success criterion: 2.4.7 Focus Visible (Level AA)');
    expect(md.match(/^\| \d+ \|/gm)).toHaveLength(12);
    expect(md.match(/^- Fix: /gm)).toHaveLength(12);
    for (const sc of Object.values(EXPECTED_SC).flat()) expect(md).toContain(sc.replace(/ \((A|AA)\)$/, ''));
    expect(await page.getByTestId('report').textContent()).toBe(md); // the on-page preview is the same file

    await toggle(page, 'lang').click();
    await toggle(page, 'alt').click();
    const md2 = await page.evaluate(() => (window as any).__a11y.report());
    expect(md2).toContain('**Result: 2 of 12 checks pass, 10 fail.**');
    expect(md2).toContain('| 12 | Spanish phrase without a lang attribute | 3.1.2 Language of Parts | AA | Pass |');
    expect(md2.match(/^- Fix: /gm)).toHaveLength(10);
  });

  test('the fix toggles are keyboard operable switches, and the result is announced', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard operation is checked on desktop');
    await page.goto(PAGE);
    const first = toggle(page, 'alt');
    await expect(first).toHaveAttribute('role', 'switch');
    await expect(first).toHaveAccessibleName('Fix: Product image has no text alternative');
    await first.focus();
    await page.keyboard.press('Space');
    await expect(first).toBeChecked();
    await expect(page.locator('[data-id="alt"]')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('summary')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('summary')).toHaveText('1 of 12 in-page checks pass, 11 fail.');
    await page.keyboard.press('Tab');
    await expect(toggle(page, 'contrast')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('summary')).toHaveText('2 of 12 in-page checks pass, 10 fail.');
    await page.getByTestId('break-all').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('score')).toHaveText('0/12');
    await expect(first).not.toBeChecked();
  });

  test('the page is honest about the score and points to the services section', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.getByTestId('honest')).toContainText('not Lighthouse, axe or any official score');
    await expect(page.getByTestId('audit').getByRole('heading', { level: 2 })).toHaveText('Audit: twelve in-page checks');
    await expect(page.locator('.chrome .fictional')).toHaveText('fictional');
    await expect(page.locator('header .lede')).toContainText('fictional candle shop');
    const cta = page.getByTestId('cta');
    await expect(cta).toContainText('accessibility audit');
    await expect(cta).toContainText('hourly rate ($65/hr)');
    await expect(page.getByTestId('cta-link')).toHaveAttribute('href', '../index.html#services');
  });
});
