import { test, expect, type Page } from '@playwright/test';

// Time is pinned with page.clock: install, pause at the same instant, then navigate.
async function open(page: Page, iso: string, query = '') {
  const t = new Date(iso);
  await page.clock.install({ time: t });
  await page.clock.pauseAt(t);
  await page.goto('/lab/055-cron-whisperer.html' + query);
}
const runs = (page: Page) => page.getByTestId('run');
const setExpr = (page: Page, e: string) => page.getByTestId('expr').fill(e);

test.describe('Cron Whisperer', () => {
  test('explains expressions and keeps the field builder in sync', async ({ page }) => {
    await open(page, '2027-01-06T12:00:00Z', '?tz=UTC');
    await expect(page.getByTestId('explanation')).toHaveText('At 09:30 on Monday through Friday.');
    await page.getByTestId('field-hour').fill('9,17');
    await expect(page.getByTestId('expr')).toHaveValue('30 9,17 * * MON-FRI');
    await expect(page.getByTestId('explanation')).toHaveText('At 09:30 and 17:30 on Monday through Friday.');
    await setExpr(page, '*/15 9-17 * * 1-5');
    await expect(page.getByTestId('field-min')).toHaveValue('*/15');
    await expect(page.getByTestId('explanation')).toHaveText('Every 15 minutes, between 09:00 and 17:59 on Monday through Friday.');
    await setExpr(page, '0 6 1 jan,apr,jul,oct *');
    await expect(page.getByTestId('explanation')).toHaveText('At 06:00 on day 1 of the month, in January, April, July and October.');

    await setExpr(page, '61 * * * *');
    await expect(page.getByTestId('explanation')).toHaveAttribute('data-valid', 'false');
    await expect(page.getByTestId('explanation')).toContainText('61 is out of range for minute (0–59)');
    await expect(page.getByTestId('field-min')).toHaveAttribute('aria-invalid', 'true');
    await setExpr(page, '0 0 * * * *');
    await expect(page.getByTestId('explanation')).toContainText('switch on “Seconds field”');
    await page.getByTestId('preset-6').click(); // every 30 s, a six-field expression
    await expect(page.getByTestId('seconds')).toBeChecked();
    await expect(page.getByTestId('explanation')).toHaveText('Every 30 seconds.');
    await expect(runs(page).first()).toHaveAttribute('data-local', '2027-01-06 12:00:30');
  });

  test('day-of-month OR day-of-week, and the * AND rule', async ({ page }) => {
    await open(page, '2027-01-01T12:00:00Z', '?tz=UTC');
    await setExpr(page, '0 0 1,15 * MON');
    await expect(page.getByTestId('explanation')).toContainText('either one is enough');
    await expect(runs(page).nth(0)).toHaveAttribute('data-local', '2027-01-04 00:00'); // Monday
    await expect(runs(page).nth(1)).toHaveAttribute('data-local', '2027-01-11 00:00'); // Monday
    await expect(runs(page).nth(2)).toHaveAttribute('data-local', '2027-01-15 00:00'); // the 15th, a Friday
    await setExpr(page, '0 0 */2 * MON');
    await expect(page.getByTestId('explanation')).toContainText('both required');
    // Mondays that are also odd days of the month: Jan 11, Jan 25, Feb 1
    await expect(runs(page).nth(0)).toHaveAttribute('data-local', '2027-01-11 00:00');
    await expect(runs(page).nth(1)).toHaveAttribute('data-local', '2027-01-25 00:00');
    await expect(runs(page).nth(2)).toHaveAttribute('data-local', '2027-02-01 00:00');
    await setExpr(page, '0 12 29 2 *');
    await expect(runs(page).nth(0)).toHaveAttribute('data-local', '2028-02-29 12:00');
    await expect(runs(page).nth(1)).toHaveAttribute('data-local', '2032-02-29 12:00');
  });

  test('spring-forward gap in America/New_York: Vixie shifts, wall-clock skips', async ({ page }) => {
    await open(page, '2027-03-13T12:00:00Z', '?tz=America/New_York');
    await expect(page.getByTestId('tz')).toHaveValue('America/New_York');
    await setExpr(page, '30 2 * * *');
    const first = runs(page).nth(0);
    await expect(first).toHaveAttribute('data-local', '2027-03-14 03:00');
    await expect(first).toHaveAttribute('data-utc', '2027-03-14T07:00:00.000Z');
    await expect(first).toHaveAttribute('data-note', 'gap');
    await expect(first.getByTestId('dst-note')).toContainText('02:30 does not exist');
    await expect(runs(page).nth(1)).toHaveAttribute('data-local', '2027-03-15 02:30');
    await expect(runs(page).nth(1)).toContainText('UTC−04:00');

    await page.getByTestId('pol-wall').check();
    await expect(runs(page).nth(0)).toHaveAttribute('data-local', '2027-03-15 02:30');
    await expect(page.getByTestId('skip-note')).toContainText('2027-03-14: 1 scheduled time (02:30) fall in the spring-forward gap');

    // a wildcard-hour job follows the new wall clock under Vixie rules too: no 02:xx runs at all
    await page.getByTestId('pol-vixie').check();
    await setExpr(page, '*/30 * * * *');
    await page.clock.setFixedTime(new Date('2027-03-14T06:00:00Z'));
    await page.getByTestId('field-min').fill('*/30'); // re-render at the new time
    const locals = await runs(page).evaluateAll((els) => els.slice(0, 4).map((e) => e.getAttribute('data-local')));
    expect(locals).toEqual(['2027-03-14 01:30', '2027-03-14 03:00', '2027-03-14 03:30', '2027-03-14 04:00']);
    await expect(page.getByTestId('day-14')).toHaveAttribute('data-count', '46'); // 23-hour day × 2
    await expect(page.getByTestId('day-14')).toHaveAttribute('aria-label', /clocks change/);
  });

  test('fall-back overlap: fixed-time job runs once, wall-clock runs twice', async ({ page }) => {
    await open(page, '2027-11-06T12:00:00Z', '?tz=America/New_York');
    await setExpr(page, '30 1 * * *');
    await expect(runs(page).nth(0)).toHaveAttribute('data-utc', '2027-11-07T05:30:00.000Z');
    await expect(runs(page).nth(0)).toHaveAttribute('data-note', 'overlap');
    await expect(runs(page).nth(1)).toHaveAttribute('data-local', '2027-11-08 01:30');
    await page.getByTestId('pol-wall').check();
    await expect(runs(page).nth(0)).toHaveAttribute('data-utc', '2027-11-07T05:30:00.000Z');
    await expect(runs(page).nth(1)).toHaveAttribute('data-utc', '2027-11-07T06:30:00.000Z');
    await expect(runs(page).nth(0)).toContainText('UTC−04:00');
    await expect(runs(page).nth(1)).toContainText('UTC−05:00');
    await expect(runs(page).nth(1).getByTestId('dst-note')).toContainText('second run');
    // hourly: the 25-hour day has 25 runs in the heatmap
    await setExpr(page, '0 * * * *');
    await expect(page.getByTestId('month-label')).toHaveText('November 2027');
    await expect(page.getByTestId('day-7')).toHaveAttribute('data-count', '25');
    await expect(page.getByTestId('day-8')).toHaveAttribute('data-count', '24');
  });

  test('relative times follow the fake clock; heatmap navigates; settings persist', async ({ page }) => {
    await open(page, '2027-03-13T12:00:00Z', '?tz=America/New_York');
    await setExpr(page, '0 9 * * *');
    await expect(runs(page).nth(0)).toHaveAttribute('data-local', '2027-03-13 09:00'); // 14:00Z, EST
    await expect(runs(page).nth(0)).toContainText('in 2h');
    await page.clock.fastForward('01:00:00');
    await expect(runs(page).nth(0)).toContainText('in 1h');
    await expect(page.getByTestId('month-label')).toHaveText('March 2027');
    await expect(page.getByTestId('day-13')).toHaveAttribute('data-count', '1');
    await page.getByTestId('next-month').click();
    await expect(page.getByTestId('month-label')).toHaveText('April 2027');
    await page.getByTestId('prev-month').click();
    await page.getByTestId('prev-month').click();
    await expect(page.getByTestId('month-label')).toHaveText('February 2027');

    await page.getByTestId('tz').selectOption('Asia/Tokyo');
    await page.goto('/lab/055-cron-whisperer.html');
    await expect(page.getByTestId('tz')).toHaveValue('Asia/Tokyo');
    await expect(page.getByTestId('expr')).toHaveValue('0 9 * * *');
  });
});
