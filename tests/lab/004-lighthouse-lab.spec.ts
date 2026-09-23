import { test, expect, type Page } from '@playwright/test';

const score = async (page: Page, key: string) =>
  Number(await page.getByTestId(`gauge-${key}`).getAttribute('data-score'));
const vital = async (page: Page, key: string) =>
  Number(await page.getByTestId(`vital-${key}`).getAttribute('data-value'));

test.describe('Report Card — web-perf what-if lab', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/004-lighthouse-lab.html');
  });

  test('baseline slow page gets poor performance and failing vitals', async ({ page }) => {
    expect(await score(page, 'performance')).toBeLessThan(50);
    await expect(page.getByTestId('gauge-performance')).toHaveAttribute('data-band', 'poor');
    await expect(page.getByTestId('vital-lcp')).toHaveAttribute('data-rating', 'poor');
    await expect(page.getByTestId('vital-inp')).toHaveAttribute('data-rating', 'poor');
    await expect(page.getByTestId('vital-cls')).not.toHaveAttribute('data-rating', 'good');
    await expect(page.getByTestId('fix-count')).toHaveText('0 of 18 applied');
    // the first filmstrip frame is a blank screen, the hero has not painted early on
    await expect(page.getByTestId('frame-0')).toHaveAttribute('data-state', 'blank');
    await expect(page.getByTestId('frame-4')).not.toHaveAttribute('data-state', 'complete');
  });

  test('compressing the hero image cuts LCP and raises performance, as its impact pill predicted', async ({ page }) => {
    const lcp0 = await vital(page, 'lcp');
    const perf0 = await score(page, 'performance');
    await expect(page.getByTestId('impact-hero')).toContainText('LCP −');
    await page.getByTestId('toggle-hero').check();
    await expect(page.getByTestId('fix-hero')).toHaveClass(/\bon\b/);
    expect(await vital(page, 'lcp')).toBeLessThan(lcp0 - 2000);
    expect(await score(page, 'performance')).toBeGreaterThan(perf0);
    await expect(page.getByTestId('fix-count')).toHaveText('1 of 18 applied');
  });

  test('image dimensions + reserved banner slot make CLS good and remove shift frames', async ({ page }) => {
    const film = page.getByTestId('filmstrip');
    expect(await film.locator('.frame.shift').count()).toBeGreaterThan(0);
    await page.getByTestId('toggle-dims').check();
    await page.getByTestId('toggle-adslot').check();
    expect(await vital(page, 'cls')).toBeLessThanOrEqual(0.1);
    await expect(page.getByTestId('vital-cls')).toHaveAttribute('data-rating', 'good');
    await expect(film.locator('.frame.shift')).toHaveCount(0);
  });

  test('accessibility fixes reach 100, and alt text also helps SEO', async ({ page }) => {
    const seo0 = await score(page, 'seo');
    await page.getByTestId('toggle-alt').check();
    expect(await score(page, 'seo')).toBeGreaterThan(seo0);
    await page.getByTestId('toggle-contrast').check();
    await page.getByTestId('toggle-labels').check();
    await expect(page.getByTestId('gauge-accessibility')).toHaveAttribute('data-score', '100');
    await expect(page.getByTestId('gauge-accessibility').locator('.num')).toHaveText('100');
    // explanations are available for each fix
    await page.getByTestId('fix-contrast').getByText('Why this helps').click();
    await expect(page.getByTestId('why-contrast')).toContainText('4.5:1');
  });

  test('apply every fix turns the report card green; reset restores the slow page', async ({ page }) => {
    const perf0 = await score(page, 'performance');
    await page.getByTestId('apply-all').click();
    for (const k of ['performance', 'accessibility', 'best-practices', 'seo']) {
      await expect(page.getByTestId(`gauge-${k}`)).toHaveAttribute('data-band', 'good');
    }
    for (const k of ['lcp', 'inp', 'cls']) {
      await expect(page.getByTestId(`vital-${k}`)).toHaveAttribute('data-rating', 'good');
    }
    await expect(page.getByTestId('frame-0')).toHaveAttribute('data-state', 'complete');
    await expect(page.getByTestId('fix-count')).toHaveText('18 of 18 applied');

    await page.getByTestId('reset').click();
    expect(await score(page, 'performance')).toBe(perf0);
    await expect(page.getByTestId('toggle-hero')).not.toBeChecked();
  });
});
