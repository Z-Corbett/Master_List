import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/008-magic-city-coffee.html';

async function answer(page: Page, picks: string[]) {
  for (const p of picks) {
    await page.getByTestId(`opt-${p}`).click();
    await page.getByTestId('next').click();
  }
}

test.describe('008 Magic City Coffee Finder', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await page.getByTestId('start').click();
  });

  test('a perfect set of answers produces a 100-point match with a full breakdown', async ({ page }) => {
    await expect(page.getByTestId('progress-label')).toHaveText('Question 1 of 5');
    await answer(page, ['vibe-focus', 'drink-pourover', 'wifi-2', 'hood-highland', 'time-early']);

    await expect(page.getByTestId('result')).toBeVisible();
    await expect(page.getByTestId('match-name')).toHaveText('The Quiet Kiln');
    await expect(page.getByTestId('match-hood')).toHaveText('Highland Park');
    await expect(page.getByTestId('match-score')).toContainText('100');
    const why = page.getByTestId('why-list').locator('li');
    await expect(why).toHaveCount(5);
    for (const id of ['vibe', 'drink', 'wifi', 'hood', 'time']) {
      await expect(page.getByTestId(`why-${id}`)).toHaveAttribute('data-level', 'full');
    }
    await expect(page.getByTestId('why-vibe')).toContainText('30/30');
  });

  test('partial matches are explained and runner-ups are ranked below the winner', async ({ page }) => {
    await answer(page, ['vibe-patio', 'drink-cold', 'wifi-2', 'hood-downtown', 'time-evening']);
    // Railyard is the downtown patio cold bar, but it has no wifi and closes before evening
    await expect(page.getByTestId('match-name')).toHaveText('Railyard Cold Bar');
    await expect(page.getByTestId('match-score')).toContainText('75');
    await expect(page.getByTestId('why-wifi')).toHaveAttribute('data-level', 'miss');
    await expect(page.getByTestId('why-time')).toHaveAttribute('data-level', 'miss');
    await expect(page.getByTestId('why-wifi')).toContainText('0/15');

    const runners = page.getByTestId('runner-up');
    await expect(runners).toHaveCount(3);
    const scores = await runners.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-score'))));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[0]).toBeLessThanOrEqual(75);
  });

  test('Next is gated on a choice and Back keeps previous answers', async ({ page }) => {
    const next = page.getByTestId('next');
    await expect(next).toBeDisabled();
    await page.getByTestId('opt-vibe-cozy').click();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.getByTestId('question')).toHaveAttribute('data-qid', 'drink');
    await expect(page.getByTestId('progress-label')).toHaveText('Question 2 of 5');

    await page.getByTestId('back').click();
    await expect(page.getByTestId('question')).toHaveAttribute('data-qid', 'vibe');
    await expect(page.getByTestId('opt-vibe-cozy').locator('input')).toBeChecked();
    await expect(next).toBeEnabled();
  });

  test('keyboard: arrow keys choose an option and Enter advances', async ({ page, isMobile }) => {
    test.skip(isMobile, 'hardware keyboard flow is a desktop concern');
    await expect(page.getByTestId('question-title')).toBeFocused();
    await page.keyboard.press('Tab'); // first radio in the group
    await page.keyboard.press('ArrowDown'); // moves to and selects "Buzzy & social"
    await expect(page.getByTestId('opt-vibe-buzzy').locator('input')).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('question')).toHaveAttribute('data-qid', 'drink');
    await expect(page.getByTestId('question-title')).toBeFocused();
  });

  test('change answers returns to the last question, and start over clears everything', async ({ page }) => {
    await answer(page, ['vibe-buzzy', 'drink-sweet', 'wifi-1', 'hood-avondale', 'time-afternoon']);
    await expect(page.getByTestId('match-name')).toHaveText('Furnace & Foam');

    await page.getByTestId('change-answers').click();
    await expect(page.getByTestId('question')).toHaveAttribute('data-qid', 'time');
    await page.getByTestId('opt-time-early').click();
    await page.getByTestId('next').click();
    await expect(page.getByTestId('result')).toBeVisible();

    await page.getByTestId('restart').click();
    await expect(page.getByTestId('intro')).toBeVisible();
    await page.getByTestId('start').click();
    await expect(page.getByTestId('opt-vibe-buzzy').locator('input')).not.toBeChecked();
    await expect(page.getByTestId('next')).toBeDisabled();
  });
});
