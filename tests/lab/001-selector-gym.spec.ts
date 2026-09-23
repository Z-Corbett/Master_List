import { test, expect } from '@playwright/test';

test.describe('Selector Gym', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/001-selector-gym.html');
  });

  test('typing a role locator highlights exactly the matching element live', async ({ page }) => {
    const input = page.getByTestId('locator-input');
    await input.fill("getByRole('button', { name: 'Place order' })");
    await expect(page.getByTestId('match-count')).toHaveText('1 match');
    const app = page.getByTestId('mock-app');
    await expect(app.locator('[data-gym-hit]')).toHaveCount(1);
    await expect(app.locator('[data-gym-hit]')).toHaveText('Place order');
    await expect(page.getByTestId('match-list')).toContainText('button "Place order"');

    // a broader query highlights several elements
    await input.fill("getByRole('button', { name: 'Remove' })");
    await expect(page.getByTestId('match-count')).toHaveText('3 matches');
    await expect(app.locator('[data-gym-hit]')).toHaveCount(3);
  });

  test('parser reports syntax and unknown-method errors without matching anything', async ({ page }) => {
    const input = page.getByTestId('locator-input');
    await input.fill("getByRole('button', { name: 'Save'");
    await expect(page.getByTestId('parse-error')).toContainText(/Expected|Unclosed/);
    await expect(page.getByTestId('match-count')).toHaveText('0 matches');

    await input.fill("getByBanana('x')");
    await expect(page.getByTestId('parse-error')).toContainText('Unknown method "getByBanana"');

    await input.fill("locator('##bad')");
    await expect(page.getByTestId('parse-error')).toContainText('Invalid CSS selector');
  });

  test('solving challenge 1 with a role locator scores full points', async ({ page }) => {
    await page.getByTestId('locator-input').fill("getByRole('button', { name: 'Place order' })");
    await page.getByTestId('check-btn').click();
    await expect(page.getByTestId('feedback')).toContainText('Clean hit');
    await expect(page.getByTestId('score')).toHaveText('10');
    await expect(page.getByTestId('cleared')).toHaveText('1');
    await expect(page.getByTestId('ladder-1')).toHaveClass(/pass/);
  });

  test('disabled Save challenge: ambiguous locator fails, state filter passes', async ({ page }) => {
    await page.getByTestId('ladder-7').click();
    await expect(page.getByTestId('challenge-title')).toHaveText('The disabled Save');
    const input = page.getByTestId('locator-input');
    await input.fill("getByRole('button', { name: 'Save' })");
    await input.press('Enter');
    await expect(page.getByTestId('match-count')).toHaveText('2 matches');
    await expect(page.getByTestId('feedback')).toContainText('strict-mode violation');
    await expect(page.getByTestId('score')).toHaveText('0');

    await input.fill("getByRole('button', { name: 'Save', disabled: true })");
    await input.press('Enter');
    await expect(page.getByTestId('match-count')).toHaveText('1 match');
    await expect(page.getByTestId('challenge-status')).toContainText('cleared');
    await expect(page.getByTestId('score')).toHaveText('10');
  });

  test('CSS answers pass as brittle for partial credit; scoped chains resolve duplicates', async ({ page }) => {
    await page.getByTestId('ladder-10').click();
    const input = page.getByTestId('locator-input');
    await input.fill("getByLabel('City')");
    await expect(page.getByTestId('match-count')).toHaveText('2 matches');

    await input.fill('locator(\'#b-city\')');
    await page.getByTestId('check-btn').click();
    await expect(page.getByTestId('feedback')).toContainText('brittle');
    await expect(page.getByTestId('score')).toHaveText('4');

    await input.fill("getByRole('group', { name: 'Billing address' }).getByLabel('City')");
    await page.getByTestId('check-btn').click();
    await expect(page.getByTestId('feedback')).toContainText('Clean hit');
    await expect(page.getByTestId('score')).toHaveText('10');
    await expect(page.getByTestId('ladder-10')).toHaveClass(/pass/);
  });

  test('revealing the answer fills the input and caps credit', async ({ page }) => {
    await page.getByTestId('ladder-9').click();
    await page.getByTestId('answer-btn').click();
    await expect(page.getByTestId('locator-input')).toHaveValue(/newsletter/);
    await expect(page.getByTestId('hint')).toBeVisible();
    await expect(page.getByTestId('match-count')).toHaveText('1 match');
    await page.getByTestId('check-btn').click();
    await expect(page.getByTestId('score')).toHaveText('2');
  });
});
