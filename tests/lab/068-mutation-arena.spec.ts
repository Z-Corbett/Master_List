import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/068-mutation-arena.html';

async function run(page: Page) {
  await page.getByTestId('run').click();
  await expect(page.getByTestId('dishes')).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
}
async function addAssertion(page: Page, args: string, expected: string) {
  await page.getByTestId('arg-input').fill(args);
  await page.getByTestId('expect-input').fill(expected);
  await page.getByTestId('add-assert').click();
}
const survivors = (page: Page) => page.locator('[data-testid="mutant"][data-status="survived"]');

test.describe('Mutation Testing Arena', () => {
  test('isLeapYear: a two-test suite lets the century rules survive', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('pick-isLeapYear')).toHaveAttribute('aria-pressed', 'true');
    await run(page);
    await expect(page.getByTestId('count-total')).toHaveText('18');
    await expect(page.getByTestId('count-survived')).toHaveText('8');
    await expect(page.getByTestId('score')).toHaveText('56 %');
    await page.getByTestId('filter-survived').click();
    await expect(page.getByTestId('mutant')).toHaveCount(8);
    const cats = await survivors(page).evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-cat')))].sort());
    expect(cats).toEqual(['Arithmetic', 'Boundary']);

    await page.locator('[data-testid="mutant"][data-id="M15"]').click(); // 400 → 401
    await expect(page.getByTestId('src-caption')).toContainText('M15');
    await expect(page.getByTestId('source').locator('ins')).toHaveText('401');
    await expect(page.getByTestId('detail-body')).toContainText('exact boundary value');
    await page.getByTestId('show-original').click();
    await expect(page.getByTestId('source').locator('ins')).toHaveCount(0);
  });

  test('adding the 1900 and 2000 cases kills every mutant, and the assertions persist', async ({ page }) => {
    await page.goto(URL);
    await addAssertion(page, '1900', 'false');
    await addAssertion(page, '2000', 'true');
    await expect(page.locator('[data-testid="row"][data-builtin="false"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="row"][data-builtin="false"][data-valid="true"]')).toHaveCount(2);
    await run(page);
    await expect(page.getByTestId('score')).toHaveText('100 %');
    await expect(page.getByTestId('score-big')).toHaveText('100%');
    await expect(page.getByTestId('all-killed')).toBeVisible();
    await page.locator('[data-testid="mutant"][data-id="M09"]').click(); // 100 → 101, killed by the 1900 row
    await expect(page.getByTestId('detail-body')).toContainText('isLeapYear(1900)');

    await page.reload();
    await expect(page.locator('[data-testid="row"][data-builtin="false"]')).toHaveCount(2);
  });

  test('bad assertions are rejected or flagged and left out of the run', async ({ page }) => {
    await page.goto(URL + '?fn=passwordOk');
    await expect(page.getByTestId('pick-passwordOk')).toHaveAttribute('aria-pressed', 'true');
    await addAssertion(page, 'Secret12', 'true'); // not JSON: a bare word
    await expect(page.getByTestId('arg-input')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('form-msg')).toContainText('JSON values');
    await addAssertion(page, '"Secret12"', 'maybe');
    await expect(page.getByTestId('expect-input')).toHaveAttribute('aria-invalid', 'true');

    await addAssertion(page, '"password"', 'true'); // wrong: no digit or capital
    const bad = page.locator('[data-testid="row"][data-builtin="false"]').first();
    await expect(bad).toHaveAttribute('data-valid', 'false');
    await expect(bad).toContainText('returns false');
    await run(page);
    await expect(page.getByTestId('count-total')).toHaveText('9');
    await expect(page.getByTestId('score')).toHaveText('44 %'); // the bad row changed nothing
    await bad.getByTestId('del-row').click();
    await expect(page.locator('[data-testid="row"][data-builtin="false"]')).toHaveCount(0);

    // kill all five survivors: exact boundary, one short, missing capital, short with digit+capital
    await addAssertion(page, '"Secret12"', 'true');
    await addAssertion(page, '"Abcdef1"', 'false');
    await addAssertion(page, '"secret123"', 'false');
    await run(page);
    await expect(page.getByTestId('count-survived')).toHaveText('0');
  });

  test('digitSum: mutants that loop forever are stopped by the worker watchdog', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('pick-digitSum').click();
    await run(page);
    const hung = page.locator('[data-testid="mutant"][data-status="timeout"]');
    await expect(hung).toHaveCount(2);
    await expect(hung.first()).toContainText('killed by timeout');
    await hung.first().click();
    await expect(page.getByTestId('detail-body')).toContainText('terminated its worker');
    await expect(page.getByTestId('score')).toHaveText('100 %');
    // the page stays responsive: switching functions after a hang works
    await page.getByTestId('pick-discount').click();
    await run(page);
    await expect(page.getByTestId('count-total')).toHaveText('13');
    await expect(page.getByTestId('count-survived')).toHaveText('6');
  });
});
