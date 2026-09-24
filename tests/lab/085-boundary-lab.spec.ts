import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/085-boundary-lab.html';
const boundary = (page: Page) => page.locator('[data-testid="case"][data-group="Boundary values"]');
const bvals = (page: Page) => boundary(page).evaluateAll((els) => els.map((e) => [e.getAttribute('data-value'), e.getAttribute('data-point'), e.getAttribute('data-exp')]));
async function tryValue(page: Page, v: string) {
  await page.getByTestId('try').fill(v);
  return page.getByTestId('verdict').getAttribute('data-verdict');
}

test.describe('Boundary Value Lab', () => {
  test('integer range: 3-value and 2-value BVA give the textbook points, and they follow the rule', async ({ page }) => {
    await page.goto(URL);
    expect(await bvals(page)).toEqual([
      ['0', 'off', 'reject'], ['1', 'on', 'accept'], ['2', 'in', 'accept'],
      ['9', 'in', 'accept'], ['10', 'on', 'accept'], ['11', 'off', 'reject']]);
    await page.getByTestId('bva-2').click();
    await expect(page.getByTestId('bva-2')).toHaveAttribute('aria-pressed', 'true');
    expect((await bvals(page)).map((r) => r[0])).toEqual(['0', '1', '10', '11']);
    await expect(page.locator('[data-testid="pin"][data-point="in"]').first()).toHaveCSS('opacity', '0');

    await page.getByTestId('r-min').fill('18');
    await page.getByTestId('r-max').fill('65');
    expect((await bvals(page)).map((r) => r[0])).toEqual(['17', '18', '65', '66']);
    await expect(page.getByTestId('rule-say')).toHaveText('Tickets per order: 18 ≤ x ≤ 65');
    await page.getByTestId('r-min').fill('70');
    await expect(page.getByTestId('rule-warn')).toContainText('Min is greater than max');
    await expect(page.getByTestId('case')).toHaveCount(0);
  });

  test('every generated case gets the verdict it predicts when tried live', async ({ page }) => {
    await page.goto(URL);
    for (const t of ['int', 'dec', 'len', 'date', 'enum']) {
      await page.getByTestId('tab-' + t).click();
      const rows = page.getByTestId('case');
      const n = await rows.count();
      expect(n).toBeGreaterThan(3);
      for (let i = 0; i < n; i++) {
        const exp = await rows.nth(i).getAttribute('data-exp');
        await rows.nth(i).getByRole('button').click();
        await expect(page.getByTestId('verdict'), `${t} case ${i}`).toHaveAttribute('data-verdict', exp!);
      }
    }
  });

  test('decimals are judged in whole steps, with precision and format errors', async ({ page }) => {
    await page.goto(URL + '?type=dec');
    expect((await bvals(page)).map((r) => r[0])).toEqual(['0.00', '0.01', '0.02', '4999.99', '5000.00', '5000.01']);
    expect(await tryValue(page, '5000.001')).toBe('reject');
    await expect(page.getByTestId('verdict-part')).toHaveText('too precise');
    expect(await tryValue(page, '5000.000')).toBe('accept'); // trailing zeros are fine
    expect(await tryValue(page, '0.1')).toBe('accept');
    expect(await tryValue(page, '1e3')).toBe('reject');
    await expect(page.getByTestId('verdict-part')).toHaveText('wrong format');
    expect(await tryValue(page, '5000.01')).toBe('reject');
    await expect(page.getByTestId('verdict')).toContainText('the off point');
    await page.getByTestId('r-step').selectOption('1');
    await expect(page.getByTestId('rule-warn')).toContainText("can't be more precise than the step");
    await page.getByTestId('r-min').fill('1');
    await page.getByTestId('r-max').fill('5000');
    expect((await bvals(page)).map((r) => r[0])).toEqual(['0', '1', '2', '4999', '5000', '5001']);
  });

  test('string length counts code points; dates respect the calendar', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('tab-len').click();
    const lens = await boundary(page).evaluateAll((els) => els.map((e) => [...e.getAttribute('data-value')!].length));
    expect(lens).toEqual([2, 3, 4, 15, 16, 17]);
    expect(await tryValue(page, 'a'.repeat(16))).toBe('accept');
    expect(await tryValue(page, 'a'.repeat(17))).toBe('reject');
    expect(await tryValue(page, '👍👍👍')).toBe('accept'); // 3 code points, 6 UTF-16 units
    await expect(page.getByTestId('verdict')).toContainText('3 code points');

    await page.getByTestId('tab-date').click();
    expect((await bvals(page)).map((r) => r[0])).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2027-03-30', '2027-03-31', '2027-04-01']);
    expect(await tryValue(page, '2027-02-29')).toBe('reject'); // 2027 is not a leap year
    await expect(page.getByTestId('verdict-part')).toHaveText('not a real date');
    await page.getByTestId('r-max').fill('2028-03-31');
    expect(await tryValue(page, '2028-02-29')).toBe('accept'); // 2028 is
    expect(await tryValue(page, '31/03/2027')).toBe('reject');
  });

  test('enum: each value is a class; the case toggle and keyboard tabs work', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('tab-int').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-enum')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-enum')).toBeFocused();
    await expect(page.getByTestId('echip')).toHaveCount(5);
    await expect(page.getByTestId('bva-3')).toBeDisabled();
    expect(await tryValue(page, 'M')).toBe('accept');
    expect(await tryValue(page, 'm')).toBe('reject');
    expect(await tryValue(page, ' M')).toBe('reject');
    await expect(page.getByTestId('verdict-part')).toHaveText('whitespace');
    await page.getByTestId('r-ci').check();
    expect(await tryValue(page, 'm')).toBe('accept');
    await page.getByTestId('r-values').fill('small, medium, large');
    await expect(page.getByTestId('echip')).toHaveCount(3);
    expect(await tryValue(page, 'XL')).toBe('reject');
  });
});
