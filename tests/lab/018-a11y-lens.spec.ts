import { test, expect, type Page } from '@playwright/test';

const report = async (page: Page, testid: string, type: string) => {
  await page.getByTestId(testid).click();
  await page.getByTestId('issue-type').selectOption(type);
  await page.getByTestId('report').click();
};
const reportVia = async (page: Page, label: string, type: string) => {
  await page.getByTestId('picker').selectOption({ label });
  await page.getByTestId('issue-type').selectOption(type);
  await page.getByTestId('report').click();
};

test.describe('a11y Lens', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/018-a11y-lens.html?fresh');
  });

  test('contrast lens lists exactly the failing pairs with real WCAG ratios', async ({ page }) => {
    // sanity-check the formula itself: black on white is 21:1
    expect(await page.evaluate(() => (window as any).__a11yLens.ratio('rgb(0,0,0)', 'rgb(255,255,255)'))).toBeCloseTo(21, 5);
    await page.getByTestId('lens-contrast').click();
    const pairs = page.getByTestId('contrast-list').getByTestId('pair');
    await expect(pairs).toHaveCount(2);
    // #ffffff on #f2a15e and #a3a39a on #f3f1ea, computed independently
    await expect(pairs.nth(0)).toContainText('Hero button: Shop the sale');
    await expect(pairs.nth(0).getByTestId('ratio')).toHaveText('2.09:1');
    await expect(pairs.nth(1)).toContainText('Footer text');
    await expect(pairs.nth(1).getByTestId('ratio')).toHaveText('2.25:1');
    await page.getByTestId('show-all').check();
    expect(await pairs.count()).toBeGreaterThan(10);
    await expect(page.locator('[data-testid="pair"][data-pass="false"]')).toHaveCount(2);
  });

  test('tab-order overlay matches real keyboard focus and skips the div button', async ({ page }) => {
    // the browser's own order: positive tabindex wins the very first Tab press on a fresh page
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('mock-subscribe')).toBeFocused();
    await page.getByTestId('lens-order').click();
    const list = page.getByTestId('order-list');
    await expect(list).toHaveAttribute('data-count', '11');
    await expect(list.locator('li').first()).toContainText('Subscribe button');
    await expect(list).not.toContainText('Ember Stove');
    await expect(page.locator('#ovSvg g[data-stop="1"]')).toHaveAttribute('data-for', 'Subscribe button');
  });

  test('name inspector computes role, name and name source', async ({ page }) => {
    await page.getByTestId('lens-names').click();
    await page.getByTestId('mock-search').click();
    await expect(page.getByTestId('f-role')).toHaveText('button');
    await expect(page.getByTestId('f-name')).toHaveText('(no accessible name)');
    await page.getByTestId('mock-email').click();
    await expect(page.getByTestId('f-role')).toHaveText('textbox');
    await expect(page.getByTestId('f-name')).toHaveText('"Email address"');
    await expect(page.getByTestId('f-source')).toContainText('placeholder');
    await page.getByTestId('mock-img').click();
    await expect(page.getByTestId('f-role')).toHaveText('img');
    await expect(page.getByTestId('f-source')).toContainText('no alt attribute');
    await page.getByTestId('mock-divbtn').click();
    await expect(page.getByTestId('f-focus')).toContainText('NOT focusable');
    await page.getByTestId('mock-cta').click();
    await expect(page.getByTestId('f-contrast')).toContainText('2.09:1 fails AA');
  });

  test('reporting: wrong guesses are rejected, all nine can be found', async ({ page }) => {
    await report(page, 'mock-search', 'contrast');
    await expect(page.getByTestId('verdict')).toContainText('not that one');
    await expect(page.getByTestId('found-count')).toHaveText('0/9');
    await reportVia(page, 'Hero heading', 'contrast');
    await expect(page.getByTestId('verdict')).toContainText('Nothing wrong');

    await report(page, 'mock-search', 'name');
    await expect(page.getByTestId('verdict')).toContainText('Found');
    await report(page, 'mock-img', 'alt');
    await report(page, 'mock-cta', 'contrast');
    await report(page, 'mock-dot', 'color');
    await report(page, 'mock-divbtn', 'keyboard');
    await report(page, 'mock-link', 'link');
    await report(page, 'mock-email', 'label');
    await report(page, 'mock-subscribe', 'order');
    await expect(page.getByTestId('found-count')).toHaveText('8/9');
    await expect(page.getByTestId('done')).toBeHidden();
    await reportVia(page, 'Footer text', 'contrast');
    await expect(page.getByTestId('found-count')).toHaveText('9/9');
    await expect(page.getByTestId('done')).toBeVisible();
    await expect(page.getByTestId('issue-8')).toContainText('WCAG 1.4.3');
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('found-count')).toHaveText('0/9');
  });

  test('colour-vision lenses apply the matching SVG filter', async ({ page }) => {
    const mock = page.getByTestId('mock');
    for (const k of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']) {
      await page.getByTestId(`cvd-${k}`).click();
      await expect(page.getByTestId(`cvd-${k}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(mock).toHaveCSS('filter', new RegExp(`cvd-${k}`));
      await expect(page.locator(`#cvd-${k} feColorMatrix`)).toHaveCount(1);
    }
    await page.getByTestId('cvd-none').click();
    await expect(mock).toHaveCSS('filter', 'none');
  });
});
