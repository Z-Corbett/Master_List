import { test, expect, type Page } from '@playwright/test';

const num = async (page: Page, id: string) =>
  parseFloat((await page.getByTestId(id).textContent())!.replace(/[^\d.]/g, ''));

test.describe('Flaky — test suite weather report', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('same ?seed= produces an identical weather report', async ({ page }) => {
    const snapshot = async () => {
      await page.goto('/lab/002-flaky.html?seed=42');
      await expect(page.getByTestId('seed')).toHaveText('42');
      await page.getByTestId('run-10').click();
      await expect(page.getByTestId('stat-runs')).toHaveText('10');
      return Promise.all(['stat-green', 'stat-firsttry', 'stat-flaky', 'rate-6', 'rate-7'].map(id => page.getByTestId(id).textContent()));
    };
    const first = await snapshot();
    const second = await snapshot();
    expect(second).toEqual(first);
  });

  test('run buttons accumulate runs and produce a forecast', async ({ page }) => {
    await page.goto('/lab/002-flaky.html?seed=7');
    await expect(page.getByTestId('heat-empty')).toBeVisible();
    await expect(page.getByTestId('forecast-cond')).toHaveText('No data yet');
    await page.getByTestId('run-1').click();
    await page.getByTestId('run-10').click();
    await page.getByTestId('run-100').click();
    await expect(page.getByTestId('stat-runs')).toHaveText('111');
    await expect(page.getByTestId('heat-empty')).toBeHidden();
    await expect(page.getByTestId('forecast-pct')).toContainText('chance of green');
    // stable tests never fail
    await expect(page.getByTestId('rate-0')).toHaveText('0%');
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('stat-runs')).toHaveText('0');
  });

  test('retries mask flakiness: green goes up, first-try failures do not change', async ({ page }) => {
    await page.goto('/lab/002-flaky.html?seed=42');
    await page.getByTestId('run-100').click();
    await expect(page.getByTestId('stat-masked')).toHaveText('0');
    const greenBefore = await num(page, 'stat-green');
    const firstBefore = await page.getByTestId('stat-firsttry').textContent();

    await page.getByTestId('toggle-retries').check();
    await expect(page.getByTestId('stat-masked-d')).toContainText('CI min retrying');
    expect(await num(page, 'stat-masked')).toBeGreaterThan(0);
    expect(await num(page, 'stat-green')).toBeGreaterThan(greenBefore);
    await expect(page.getByTestId('stat-firsttry')).toHaveText(firstBefore!);
    await expect(page.getByTestId('forecast-sub')).toContainText('retries are hiding the clouds');
  });

  test('quarantine excludes every flaky test and warns it is hiding a real bug', async ({ page }) => {
    await page.goto('/lab/002-flaky.html?seed=42');
    await page.getByTestId('run-100').click();
    const flaky = await page.getByTestId('stat-flaky').textContent();
    const greenBefore = await num(page, 'stat-green');
    await page.getByTestId('toggle-quarantine').check();
    await expect(page.getByTestId('stat-quarantined')).toHaveText(flaky!);
    await expect(page.getByTestId('stat-green')).toHaveText('100%');
    expect(greenBefore).toBeLessThan(100);
    await expect(page.getByTestId('forecast-sub')).toContainText('hiding a real product bug');
    await expect(page.getByTestId('test-20')).toHaveClass(/\bq\b/);
  });

  test('diagnosis reveals root cause; order-dependent test is green without shuffling', async ({ page }) => {
    await page.goto('/lab/002-flaky.html?seed=3');
    await page.getByTestId('run-10').click();
    await page.getByTestId('test-7').click();
    await expect(page.getByTestId('test-7')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('diag-name')).toHaveText('settings › default theme is light');
    await expect(page.getByTestId('diag-cause')).toHaveText('Order dependence');
    await expect(page.getByTestId('diag-fix')).toContainText('clean context');
    expect(await num(page, 'rate-7')).toBeGreaterThan(0);

    await page.getByTestId('toggle-shuffle').uncheck();
    await page.getByTestId('reset').click();
    await page.getByTestId('run-10').click();
    await expect(page.getByTestId('rate-7')).toHaveText('0%');
    await expect(page.getByTestId('diag-truth')).toContainText('fixed order');

    await page.getByTestId('test-20').click();
    await expect(page.getByTestId('diag-cause')).toHaveText('Real product bug');
    await expect(page.getByTestId('diag-fix')).toContainText('Do NOT quarantine');
  });
});
