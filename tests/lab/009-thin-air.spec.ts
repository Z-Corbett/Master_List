import { test, expect } from '@playwright/test';

const URL = '/lab/009-thin-air.html';

async function commit(page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.fill(value);
  await input.press('Enter');
}

test.describe('Thin Air — altitude pace calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
  });

  test('goal time drives pace, unit toggle re-expresses pace and splits', async ({ page }) => {
    await page.getByTestId('dist-10k').click();
    await expect(page.getByTestId('dist-10k')).toHaveAttribute('aria-pressed', 'true');
    await commit(page, 'goal-time', '50:00');
    await expect(page.getByTestId('goal-pace')).toHaveValue('5:00');
    await expect(page.getByTestId('split-row')).toHaveCount(10);

    await page.getByTestId('unit-mi').click();
    await expect(page.getByTestId('goal-pace')).toHaveValue('8:03');
    // 6.21 miles → 6 full miles + one partial
    await expect(page.getByTestId('split-row')).toHaveCount(7);
    await expect(page.getByTestId('split-elapsed').last()).toHaveText('0:50:00');
  });

  test('typing a pace back-fills the goal time', async ({ page }) => {
    await page.getByTestId('dist-half').click();
    await commit(page, 'goal-pace', '5:00');
    await expect(page.getByTestId('goal-time')).toHaveValue('1:45:29');
    await expect(page.getByTestId('base-time')).toHaveText('1:45:29');
  });

  test('altitude presets and slider apply the labelled penalty model', async ({ page }) => {
    await expect(page.getByTestId('model-note')).toContainText('Approximate model');
    await expect(page.getByTestId('penalty')).toHaveText('+0.0%');
    await expect(page.getByTestId('adjusted-time')).toHaveText('1:45:00');

    await page.getByTestId('alt-denver').click();
    await expect(page.getByTestId('altitude-value')).toHaveText('5,280 ft');
    await expect(page.getByTestId('penalty')).toHaveText('+2.8%');
    await expect(page.getByTestId('adjusted-time')).toHaveText('1:47:56');

    const slider = page.getByTestId('altitude-slider');
    await slider.focus();
    await slider.press('End');
    await expect(page.getByTestId('altitude-value')).toHaveText('10,152 ft');
    await expect(page.getByTestId('penalty')).toHaveText('+10.3%');
    // splits follow the adjusted time
    await expect(page.getByTestId('split-elapsed').last()).toHaveText(await page.getByTestId('adjusted-time').innerText());
  });

  test('negative split front-loads slower kilometres but keeps the finish time', async ({ page }) => {
    await page.getByTestId('dist-5k').click();
    await commit(page, 'goal-time', '25:00');
    const paces = () => page.getByTestId('split-row').locator('td:nth-child(3)').allInnerTexts();
    expect(new Set(await paces()).size).toBe(1);

    await page.getByTestId('negative-split').check();
    await expect.poll(async () => new Set(await paces()).size).toBeGreaterThan(1);
    const p = await paces();
    const toSec = (s: string) => { const [m, ss] = s.split(':').map(Number); return m * 60 + ss; };
    expect(toSec(p[0])).toBeGreaterThan(toSec(p[p.length - 1]));
    await expect(page.getByTestId('split-elapsed').last()).toHaveText('0:25:00');
  });

  test('bad input shows a friendly error and keeps the last good plan', async ({ page }) => {
    await commit(page, 'goal-time', 'abc');
    await expect(page.getByTestId('error')).toContainText('h:mm:ss');
    await expect(page.getByTestId('goal-time')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('base-time')).toHaveText('1:45:00');

    await commit(page, 'goal-time', '1:75:00');
    await expect(page.getByTestId('error')).toContainText('59');

    await commit(page, 'custom-distance', '-3');
    await expect(page.getByTestId('error')).toContainText('positive number');

    await commit(page, 'goal-time', '1:40:00');
    await commit(page, 'custom-distance', '');
    await expect(page.getByTestId('error')).toBeHidden();
    await expect(page.getByTestId('goal-time')).toHaveAttribute('aria-invalid', 'false');
  });

  test('wristband lists a cumulative marker for every split', async ({ page }) => {
    await page.getByTestId('dist-5k').click();
    await commit(page, 'goal-time', '20:00');
    const cells = page.getByTestId('band-cell');
    await expect(cells).toHaveCount(5);
    await expect(cells.first()).toContainText('0:04:00');
    await expect(cells.last()).toContainText('0:20:00');
    await expect(page.getByTestId('wristband')).toContainText('5K @ 0 ft');
  });
});
