import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/071-json-schema-studio.html';
const errorList = (page: Page) =>
  page.getByTestId('error').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-ip') || '/'} ${e.getAttribute('data-kp')!.split('/').pop()}`));

test.describe('JSON Schema Studio', () => {
  test('the Order preset reports every error with instance and schema pointers', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-valid', 'true');
    await expect(page.getByTestId('doc-tab-1')).toHaveAttribute('data-state', 'bad');
    await page.getByTestId('doc-tab-1').click();
    await expect(page.getByTestId('verdict')).toContainText('9 errors');
    expect(await errorList(page)).toEqual([
      '/ required', '/id pattern', '/status enum', '/items/0/qty minimum', '/items/1/sku pattern',
      '/items/1/qty type', '/items/1/price exclusiveMinimum', '/items/1/gift additionalProperties', '/coupon additionalProperties',
    ]);
    const qty = page.locator('[data-testid="error"][data-ip="/items/0/qty"]');
    await expect(qty).toHaveAttribute('data-kp', '#/properties/items/items/$ref/properties/qty/minimum');
    await expect(qty).toContainText('must be ≥ 1');
    await page.getByTestId('doc-tab-2').click();
    expect(await errorList(page)).toEqual(['/items minItems']);
  });

  test('editing the schema and the document re-validates live', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('doc-tab-2').click(); // empty cart fails minItems
    const schema = page.getByTestId('schema');
    const text = await schema.inputValue();
    await schema.fill(text.replace('"minItems": 1', '"minItems": 0'));
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-valid', 'true');
    await schema.fill('{ "type": "object", ');
    await expect(page.getByTestId('schema-msg')).toContainText('not valid JSON');
    await expect(schema).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('verdict')).toContainText('Fix the schema first');
    await schema.fill('{ "type": "object", "required": ["id"], "format": "uuid", "properties": { "id": { "type": "integer", "minimum": 1 } } }');
    await expect(page.getByTestId('unsupported')).toContainText('format');
    await page.getByTestId('doc').fill('{ "id": 1.0 }');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-valid', 'true'); // 1.0 is an integer in JSON Schema
    await page.getByTestId('doc').fill('{ "id": "7" }');
    expect(await errorList(page)).toEqual(['/id type']);
    await page.getByTestId('doc').fill('{ "id": ');
    await expect(page.getByTestId('verdict')).toContainText('Document is not valid JSON');
    // persisted, then restored by the reset button
    await page.reload();
    await expect(page.getByTestId('schema')).toHaveValue(/"uuid"/);
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('schema')).toHaveValue(/"title": "Order"/);
  });

  test('oneOf distinguishes no match from more than one match', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-payment').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-valid', 'true');
    await page.getByTestId('doc-tab-1').click();
    await expect(page.getByTestId('errors')).toContainText('matched 2: branches 0 and 2');
    await page.getByTestId('doc-tab-2').click();
    await expect(page.getByTestId('errors')).toContainText('matched none of 3');
    await expect(page.getByTestId('errors')).toContainText('closest was branch 2');
  });

  test('recursive $ref and allOf/anyOf produce deep, precise paths', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-tree').click();
    await page.getByTestId('doc-tab-1').click();
    expect(await errorList(page)).toEqual(['/children/0/children/1/name minLength', '/children/1/size additionalProperties']);
    await expect(page.locator('[data-testid="error"]').first()).toHaveAttribute('data-kp', '#/$ref/properties/children/items/$ref/properties/children/items/$ref/properties/name/minLength');
    await page.getByTestId('preset-config').click();
    await page.getByTestId('doc-tab-1').click();
    expect(await errorList(page)).toEqual(['/mode const', '/name pattern', '/replicas minimum', '/ anyOf']);
    await expect(page.getByTestId('doc-tab-2')).toHaveAttribute('data-state', 'ok');
  });

  test('generated examples validate for every preset and can be loaded', async ({ page }) => {
    await page.goto(URL);
    for (const p of ['order', 'payment', 'tree', 'config']) {
      await page.getByTestId('preset-' + p).click();
      await page.getByTestId('generate').click();
      await expect(page.getByTestId('gen-verdict')).toHaveAttribute('data-valid', 'true');
    }
    await expect(page.getByTestId('generated')).toContainText('"port": 1024');
    await page.getByTestId('preset-order').click();
    await page.getByTestId('generate').click();
    await expect(page.getByTestId('generated')).toContainText('"id": "ORD-0000"');
    await page.getByTestId('doc-tab-1').click();
    await page.getByTestId('use-generated').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-valid', 'true');
    await expect(page.getByTestId('doc-tab-1')).toHaveAttribute('data-state', 'ok');
  });
});
