import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/066-contract-lab.html';
const cell = (page: Page, c: string, v: string) => page.getByTestId(`cell-${c}-${v}`);

async function matrix(page: Page) {
  const out: Record<string, string> = {};
  for (const c of ['c1', 'c2', 'c3']) for (const v of ['v1', 'v2', 'v3', 'v4']) out[`${c}-${v}`] = (await cell(page, c, v).getAttribute('data-result'))!;
  return out;
}

test.describe('Contract Test Lab', () => {
  test('the compatibility matrix matches each consumer release to the provider it was built on', async ({ page }) => {
    await page.goto(URL);
    expect(await matrix(page)).toEqual({
      'c1-v1': 'pass', 'c1-v2': 'pass', 'c1-v3': 'fail', 'c1-v4': 'fail',
      'c2-v1': 'fail', 'c2-v2': 'fail', 'c2-v3': 'pass', 'c2-v4': 'fail',
      'c3-v1': 'fail', 'c3-v2': 'fail', 'c3-v3': 'fail', 'c3-v4': 'pass',
    });
    await expect(page.getByTestId('summary')).toHaveText('4/12 PAIRS VERIFIED');
    await expect(cell(page, 'c1', 'v4')).toContainText('6 issues');
  });

  test('a failing cell names every broken JSON path and highlights it in the provider example', async ({ page }) => {
    await page.goto(URL);
    await cell(page, 'c1', 'v4').click();
    await expect(page.getByTestId('verdict')).toContainText('Larder 1.0 × Pantry API v4');
    const paths = await page.getByTestId('issue').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-path')} ${e.getAttribute('data-kind')}`));
    expect(paths).toEqual([
      '$.name required',
      '$.items[0].total type', '$.items[1].total type', '$.items[2].total type', '$.items[2].status enum',
      '$.deliverySlot required',
    ]);
    await expect(page.getByTestId('issue').nth(1)).toContainText('expected number, got string "23.50"');
    await page.getByTestId('inter-orders').click();
    await expect(page.getByTestId('example').locator('.hit')).toHaveCount(4);
    await expect(page.getByTestId('example').locator('[data-path="$.items[2].status"]')).toContainText('cancelled');
    await cell(page, 'c3', 'v4').click();
    await expect(page.getByTestId('verdict-status')).toContainText('Compatible');
    await expect(page.getByTestId('example').locator('.hit')).toHaveCount(0);
  });

  test('the provider diff classifies breaking and safe changes by path', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('ver-v2').click();
    const v2 = page.getByTestId('change');
    await expect(v2).toHaveCount(3);
    await expect(page.locator('[data-testid="change"][data-breaking="true"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="change"][data-path="$.tier"]')).toContainText('optional → required');
    await page.getByTestId('ver-v3').click();
    await expect(page.locator('[data-testid="change"][data-path="$.name"]')).toContainText('renamed $.name → $.fullName');
    await expect(page.locator('[data-testid="change"][data-path="$.name"]')).toHaveAttribute('data-breaking', 'true');
    await page.getByTestId('ver-v4').click();
    await expect(page.locator('[data-testid="change"][data-path="$.items[].total"]')).toContainText('type changed from number to string');
    const slot = page.locator('[data-testid="change"][data-path="$.deliverySlot"]');
    await expect(slot).toContainText('optional → required');
    await expect(slot).toHaveAttribute('data-breaking', 'true');
    await expect(page.getByTestId('ver-v4')).toContainText('2 breaking');
  });

  test('strict reader turns added fields into breaking changes', async ({ page }) => {
    await page.goto(URL);
    await expect(cell(page, 'c1', 'v2')).toHaveAttribute('data-result', 'pass');
    await page.getByTestId('strict').check();
    await expect(cell(page, 'c1', 'v2')).toHaveAttribute('data-result', 'fail');
    await cell(page, 'c1', 'v2').click();
    await expect(page.locator('[data-testid="issue"][data-path="$.phone"]')).toContainText('not in the contract');
    await expect(page.locator('[data-testid="issue"][data-kind="unexpected"]')).toHaveCount(4); // tier, phone, 2 × currency
    await expect(page.getByTestId('deploy-v2')).toHaveAttribute('data-ok', 'false');
  });

  test('editing the contract re-runs the matrix, rejects bad JSON and persists', async ({ page }) => {
    await page.goto(URL);
    const schema = page.getByTestId('schema');
    await schema.fill('{ "type": "object", ');
    await expect(page.getByTestId('parse-msg')).toContainText('✗');
    await expect(schema).toHaveAttribute('aria-invalid', 'true');
    await expect(cell(page, 'c1', 'v1')).toHaveAttribute('data-result', 'fail');
    // Larder 1.0 only reads the email: v3's rename no longer matters, only the new enum value does
    await schema.fill('{"type":"object","required":["email"],"properties":{"email":{"type":"string","format":"email"}}}');
    await expect(page.getByTestId('parse-msg')).toContainText('Valid JSON');
    await cell(page, 'c1', 'v3').click();
    await expect(page.getByTestId('inter-result-customer')).toContainText('passes');
    await expect(page.getByTestId('inter-result-orders')).toContainText('fails');

    await page.getByTestId('prod-c2').check();
    await expect(page.getByTestId('deploy-v3')).toHaveAttribute('data-ok', 'false'); // still Larder 1.0's enum
    await page.reload();
    await expect(page.getByTestId('schema')).toHaveValue(/"required":\["email"\]/);
    await expect(page.getByTestId('prod-c2')).toBeChecked();
    await page.getByTestId('reset-contract').click();
    await expect(page.getByTestId('schema')).toHaveValue(/"name"/);
  });
});
