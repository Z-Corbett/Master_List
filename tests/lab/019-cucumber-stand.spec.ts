import { test, expect } from '@playwright/test';

test.describe('Cucumber Stand', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/019-cucumber-stand.html?fresh');
  });

  test('example feature: steps are matched, ambiguous and undefined steps are flagged', async ({ page }) => {
    await expect(page.getByTestId('n-scenarios')).toHaveText('4 scenarios'); // outline expands to 2
    await expect(page.getByTestId('n-ok')).toHaveText('7 matched');
    await expect(page.getByTestId('n-amb')).toHaveText('1 ambiguous');
    await expect(page.getByTestId('n-und')).toHaveText('1 undefined');

    const add = page.getByTestId('rep-9');
    await expect(add).toHaveAttribute('data-status', 'ok');
    await expect(add).toContainText('{int} 3');
    await expect(add).toContainText('{string} cucumbers');
    await expect(page.getByTestId('rep-11')).toContainText('{float} 4.50');
    // alternation: "I click/press {string}" matches "press"
    await expect(page.getByTestId('rep-25')).toContainText('clickButton');

    const amb = page.getByTestId('rep-10');
    await expect(amb).toHaveAttribute('data-status', 'amb');
    await expect(amb).toContainText('expectBasketCount');
    await expect(amb).toContainText('expectBasketOf');
    await expect(page.getByTestId('rep-26')).toHaveAttribute('data-status', 'und');
    // gutter mirrors the report
    await expect(page.locator('#gutter i[data-line="10"]')).toHaveAttribute('data-status', 'amb');
  });

  test('resolving: delete the overlapping definition and add one from the snippet', async ({ page }) => {
    await page.getByTestId('del-3').click(); // "the basket should contain {int} {word}"
    await expect(page.getByTestId('n-amb')).toHaveText('0 ambiguous');
    await expect(page.getByTestId('rep-10')).toContainText('expectBasketCount');

    await page.getByTestId('snippet-26').click();
    await expect(page.getByTestId('new-expr')).toHaveValue('I should get a receipt by email');
    await page.getByTestId('add-def').click();
    await expect(page.getByTestId('n-und')).toHaveText('0 undefined');
    await expect(page.getByTestId('n-ok')).toHaveText('9 matched');
    await expect(page.getByTestId('defs')).toContainText('iShouldGetAReceipt()');
  });

  test('editing the feature re-matches live, including every outline example row', async ({ page }) => {
    const editor = page.getByTestId('editor');
    const src = await editor.inputValue();
    // add an example row whose count is not an {int}
    await editor.fill(src.replace('| gherkin | 1     |', '| gherkin | 1     |\n      | relish  | lots  |'));
    await expect(page.getByTestId('n-scenarios')).toHaveText('5 scenarios');
    const row = page.getByTestId('rep-15');
    await expect(row).toHaveAttribute('data-status', 'und');
    await expect(row).toContainText('fails for: I should see lots results');
    // snippet suggests parameters from the concrete text
    await editor.fill('Feature: Scratch\n  Scenario: Weigh\n    When I weigh 2 "gherkins" at 1.25 each\n');
    await expect(page.getByTestId('snippet-3')).toContainText('I weigh {int} {string} at {float} each');
    await expect(page.getByTestId('n-scenarios')).toHaveText('1 scenario');
  });

  test('syntax problems and highlighting', async ({ page }) => {
    const editor = page.getByTestId('editor');
    await editor.fill('Given a step with no scenario\nFeature: Oops\n  Examples:\n    | a |\n');
    await expect(page.getByTestId('problems')).toContainText('not inside a Scenario');
    await expect(page.getByTestId('problems')).toContainText('only belongs under a Scenario Outline');
    await page.getByTestId('reset-feature').click();
    await expect(page.getByTestId('problems')).toBeEmpty();
    // Feature, Background, Scenario ×2, Scenario Outline, Examples
    await expect(page.locator('#hl .t-kw')).toHaveCount(6);
    await expect(page.locator('#hl .t-step')).toHaveCount(9);
    await expect(page.locator('#hl .t-ph')).toHaveCount(2);
    await expect(page.locator('#hl .t-tag')).toHaveText('@smoke');
  });

  test('generates a readable Playwright skeleton', async ({ page }) => {
    await page.getByTestId('generate').click();
    const out = page.getByTestId('gen-out');
    await expect(out).toBeVisible();
    await expect(out).toContainText("test.describe('Basket at the Cucumber Stand', { tag: ['@smoke'] }");
    await expect(out).toContainText("test.beforeEach(async ({ page }) => {");
    await expect(out).toContainText("await gotoPage(page, 'market');");
    await expect(out).toContainText("await addToBasket(page, 3, 'cucumbers');");
    await expect(out).toContainText('for (const ex of searchTheStandExamples)');
    await expect(out).toContainText('await expectResults(page, Number(ex.count));');
    await expect(out).toContainText("test.fixme(true, 'has undefined or ambiguous steps');");
    await expect(page.getByTestId('copy')).toBeEnabled();
  });
});
