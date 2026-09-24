import { test, expect, type Page } from '@playwright/test';

const stepValues = (page: Page) => page.getByTestId('step-input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

async function structureExample(page: Page) {
  await page.getByTestId('load-messy').click();
  await page.getByTestId('structure').click();
  await expect(page.getByTestId('step')).toHaveCount(5);
}

test.describe('Bug Report Studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/035-bug-report-studio.html');
  });

  test('structures a messy description into steps, results, version and a title', async ({ page }) => {
    await expect(page.getByTestId('score')).toHaveText('0');
    await structureExample(page);
    expect(await stepValues(page)).toEqual([
      'Add 3 items to the cart',
      'Go to the cart page',
      'Change the quantity of oat milk to 0',
      'Press update',
      'Click checkout',
    ]);
    await expect(page.getByTestId('expected')).toHaveValue('It should have removed the oat milk and taken me to payment.');
    await expect(page.getByTestId('actual')).toHaveValue('It spins forever.');
    await expect(page.getByTestId('version')).toHaveValue('4.2.1 (build 388)');
    await expect(page.getByTestId('title')).toHaveValue('[Checkout] Spins forever after clicking checkout');
    await expect(page.getByTestId('parse-status')).toContainText('attach the log');
    // 25 title + 25 steps + 25 expected/actual + 5 version = 80
    await expect(page.getByTestId('score')).toHaveText('80');
    await expect(page.getByTestId('grade')).toHaveText('Nearly there');
    await expect(page.getByTestId('tips').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('tip-env')).toBeVisible();
  });

  test('title helper flags vague, short and shouty titles', async ({ page }) => {
    await page.getByTestId('title').fill('Checkout broken!!!');
    const flags = page.getByTestId('title-flags');
    await expect(flags).toContainText('Too short (18 chars)');
    await expect(flags).toContainText('Vague wording: “broken”');
    await expect(flags).toContainText('Shouting');
    await expect(page.getByTestId('tip-title-vague')).toBeVisible();

    await page.getByTestId('t-area').fill('Checkout');
    await page.getByTestId('t-sym').fill('spinner never stops');
    await page.getByTestId('t-trig').fill('after setting a quantity to 0');
    await page.getByTestId('compose-title').click();
    await expect(page.getByTestId('title')).toHaveValue('[Checkout] Spinner never stops after setting a quantity to 0');
    await expect(flags.locator('li:not(.ok)')).toHaveCount(0);
    await expect(page.getByTestId('tip-title-vague')).toHaveCount(0);
    await expect(page.getByTestId('markdown')).toContainText('# [Checkout] Spinner never stops after setting a quantity to 0');
  });

  test('steps reorder by keyboard, buttons and pointer drag', async ({ page }) => {
    for (const s of ['Open the pantry', 'Tap Add item', 'Enter "Rye flour"']) {
      await page.getByTestId('add-step').click();
      await page.keyboard.type(s);
    }
    expect(await stepValues(page)).toEqual(['Open the pantry', 'Tap Add item', 'Enter "Rye flour"']);

    await page.getByTestId('step-input').nth(2).focus();
    await page.keyboard.press('Alt+ArrowUp');
    expect(await stepValues(page)).toEqual(['Open the pantry', 'Enter "Rye flour"', 'Tap Add item']);
    await expect(page.getByTestId('step-input').nth(1)).toBeFocused();

    await page.getByRole('button', { name: 'Move step 1 down' }).click();
    expect(await stepValues(page)).toEqual(['Enter "Rye flour"', 'Open the pantry', 'Tap Add item']);

    // drag step 1 by its grip below the last step
    const grip = page.getByRole('button', { name: 'Drag step 1' });
    const last = page.getByTestId('step').nth(2);
    const g = (await grip.boundingBox())!;
    const l = (await last.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, l.y + l.height - 4, { steps: 8 });
    await page.mouse.move(g.x + g.width / 2, l.y + l.height + 10, { steps: 3 });
    await page.mouse.up();
    expect(await stepValues(page)).toEqual(['Open the pantry', 'Tap Add item', 'Enter "Rye flour"']);
    await expect(page.getByTestId('markdown')).toContainText('1. Open the pantry\n2. Tap Add item\n3. Enter "Rye flour"');

    await page.getByRole('button', { name: 'Delete step 2' }).click();
    expect(await stepValues(page)).toEqual(['Open the pantry', 'Enter "Rye flour"']);
  });

  test('environment is read from this browser and rows can be excluded', async ({ page }) => {
    await page.getByTestId('capture-env').click();
    const vp = page.viewportSize()!;
    await expect(page.getByTestId('env-viewport')).toContainText(`${vp.width}×${vp.height}`);
    await expect(page.getByTestId('env-browser')).toContainText('Chrome');
    const md = page.getByTestId('markdown');
    await expect(md).toContainText(`| Viewport | ${vp.width}×${vp.height} |`);
    await expect(md).toContainText('| User agent |');
    await page.getByRole('checkbox', { name: 'Include User agent' }).uncheck();
    await expect(md).not.toContainText('| User agent |');
    await expect(md).toContainText('| Viewport |');
    await expect(page.getByTestId('tip-env')).toHaveCount(0);
  });

  test('triage matrix guidance, attachments, a perfect score and persistence', async ({ page }) => {
    await structureExample(page);
    await page.getByTestId('capture-env').click();
    await page.getByTestId('cell-critical-p4').click();
    await expect(page.getByTestId('cell-critical-p4')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('guide')).toContainText('Unusual: high impact but low urgency');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('cell-critical-p1')).toBeFocused();
    await expect(page.getByTestId('guide')).toContainText('Consistent: urgency matches impact.');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('cell-major-p1')).toHaveAttribute('aria-checked', 'true');

    await page.getByTestId('att-console').click();
    await expect(page.getByTestId('att-console')).toBeDisabled();
    await expect(page.getByTestId('att-item')).toHaveCount(1);
    const md = page.getByTestId('markdown');
    await expect(md).toContainText('**Severity:** Major · **Priority:** P1 · **Reproducibility:** Sometimes');
    await expect(md).toContainText("```text\n[14:02:11.482] GET /api/cart 200");
    await expect(page.getByTestId('score')).toHaveText('100');
    await expect(page.getByTestId('grade')).toHaveText('Ready to file');
    await expect(page.getByTestId('tips').locator('li')).toHaveCount(0);

    await page.getByTestId('download-md').click();
    await expect(page.getByTestId('md-status')).toHaveText('Downloaded checkout-spins-forever-after-clicking-checkout.md');

    await page.reload();
    await expect(page.getByTestId('step')).toHaveCount(5);
    await expect(page.getByTestId('cell-major-p1')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('score')).toHaveText('100');
  });
});
