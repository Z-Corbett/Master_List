import { test, expect } from '@playwright/test';

test.describe('Form Forge', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/034-form-forge.html');
  });

  test('empty submit: error summary takes focus, links jump to fields, inline errors are described', async ({ page }) => {
    const preview = page.getByTestId('preview');
    await preview.getByRole('button', { name: 'Reserve my place' }).click();
    const summary = preview.getByRole('alert');
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('heading')).toHaveText('There are 6 problems');
    await expect(summary.getByRole('listitem')).toHaveCount(6);
    await expect(summary).toContainText('Tick “I agree to wear the safety kit provided” to continue');
    await expect(page.getByTestId('preview-state')).toHaveText('6 errors');

    const email = preview.getByLabel('Email address');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    // hint and error are both announced with the field
    await expect(email).toHaveAccessibleDescription(/We only use this.*Error: Enter email address/);
    await summary.getByRole('link', { name: 'Enter email address' }).click();
    await expect(email).toBeFocused();
    // the optional booking code is not flagged
    await expect(preview.getByLabel('Booking code')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('range, pattern and email rules, then a valid submission', async ({ page }) => {
    const p = page.getByTestId('preview');
    await p.getByLabel('Full name').fill('Rowan Ashby');
    await p.getByLabel('Email address').fill('rowan@');
    await p.getByLabel('Booking code').fill('frg-204');
    await p.getByLabel('Seats').fill('9');
    await p.getByLabel('Session').selectOption('Sunday morning');
    await p.getByRole('radio', { name: 'Some hobby work' }).check();
    await p.getByLabel('I agree to wear the safety kit provided').check();
    await p.getByRole('button', { name: 'Reserve my place' }).click();
    const summary = p.getByRole('alert');
    await expect(summary.getByRole('listitem')).toHaveCount(3);
    await expect(summary).toContainText('Enter an email address in the correct format, like name@example.com');
    await expect(summary).toContainText('Booking code is not in the right format');
    await expect(summary).toContainText('Seats must be 4 or less');

    await p.getByLabel('Email address').fill('rowan@example.com');
    await p.getByLabel('Booking code').fill('FRG-204');
    await p.getByLabel('Seats').fill('0');
    await p.getByRole('button', { name: 'Reserve my place' }).click();
    await expect(summary).toHaveText(/There is 1 problem\s*Seats must be 1 or more/);

    await p.getByLabel('Seats').fill('2');
    await p.getByRole('button', { name: 'Reserve my place' }).click();
    await expect(summary).toBeHidden();
    await expect(p.getByRole('status')).toBeFocused();
    await expect(page.getByTestId('preview-state')).toHaveText('submitted · valid');
  });

  test('build a new field with a pattern and it validates live in the preview', async ({ page }) => {
    await page.getByTestId('add-text').click();
    await expect(page.getByTestId('field-item')).toHaveCount(9);
    await expect(page.getByTestId('insp-label')).toBeFocused();
    await page.getByTestId('insp-label').fill('Postcode');
    await expect(page.getByTestId('insp-name')).toHaveValue('postcode');
    await page.getByTestId('insp-hint').fill('Two letters then four digits');
    await page.getByTestId('insp-required').check();
    await page.getByTestId('insp-pattern').fill('[A-Z');
    await expect(page.getByTestId('pattern-err')).toBeVisible();
    await page.getByTestId('insp-pattern').fill('[A-Z]{2}[0-9]{4}');
    await expect(page.getByTestId('pattern-err')).toBeHidden();
    await expect(page.getByTestId('stat-required')).toHaveText('7');

    const p = page.getByTestId('preview');
    const field = p.getByLabel('Postcode');
    await expect(field).toHaveAttribute('pattern', '[A-Z]{2}[0-9]{4}');
    await expect(field).toHaveAccessibleDescription(/Two letters then four digits/);
    await field.fill('AB12');
    await p.getByRole('button', { name: 'Reserve my place' }).click();
    await expect(p.getByRole('alert')).toContainText('Postcode is not in the right format');
    await field.fill('AB1234');
    await p.getByRole('button', { name: 'Reserve my place' }).click();
    await expect(p.getByRole('alert')).not.toContainText('Postcode');

    // reorder + delete persist across a reload
    await page.getByRole('button', { name: 'Move Postcode up' }).click();
    await expect(page.getByTestId('field-item').nth(7)).toContainText('Postcode');
    await page.getByRole('button', { name: 'Delete Booking code' }).click();
    await expect(page.getByTestId('field-item')).toHaveCount(8);
    await page.reload();
    await expect(page.getByTestId('field-item')).toHaveCount(8);
    await expect(page.getByTestId('field-item').nth(6)).toContainText('Postcode');
    await expect(page.getByTestId('preview').getByLabel('Booking code')).toHaveCount(0);
  });

  test('exported HTML is a working standalone form', async ({ page }) => {
    const out = page.getByTestId('export-out');
    await expect(out).toContainText('<label class="ff-label" for="ff-email">Email address</label>');
    await expect(out).toContainText('aria-describedby="ff-email-hint ff-email-error"');
    await expect(out).toContainText('<legend>Experience level</legend>');
    const html = await out.textContent();

    // load the export on its own (no builder) and run the same checks a user would
    await page.setContent(html!);
    await expect(page).toHaveTitle('Book a forging workshop');
    await page.getByRole('button', { name: 'Reserve my place' }).click();
    await expect(page.getByRole('alert').getByRole('listitem')).toHaveCount(6);
    await expect(page.getByRole('alert')).toBeFocused();
    await page.getByLabel('Seats').fill('abc');
    await page.getByRole('button', { name: 'Reserve my place' }).click();
    await expect(page.getByRole('alert')).toContainText('Seats must be a number');
  });

  test('exported Playwright spec matches the form rules', async ({ page }) => {
    await page.getByTestId('tab-spec').click();
    await expect(page.getByTestId('tab-spec')).toHaveAttribute('aria-selected', 'true');
    const out = page.getByTestId('export-out');
    await expect(out).toContainText("import { test, expect } from '@playwright/test';");
    await expect(out).toContainText("toHaveCount(6)");
    await expect(out).toContainText("await expect(summary).toContainText('Enter full name');");
    await expect(out).toContainText("test('Seats: rejects values above 4'");
    await expect(out).toContainText("await page.getByLabel('Seats').fill('5');");
    await expect(out).toContainText("test('Booking code: enforces the pattern [A-Z]{3}-[0-9]{3}'");
    await expect(out).toContainText("await page.getByRole('radio', { name: 'Never held a hammer' }).check();");

    // a rule change in the inspector flows straight into the spec
    await page.getByTestId('field-item').filter({ hasText: 'Seats' }).getByRole('button').first().click();
    await page.getByTestId('insp-max').fill('10');
    await expect(out).toContainText("test('Seats: rejects values above 10'");
    await page.getByTestId('insp-required').uncheck();
    await expect(out).toContainText('toHaveCount(5)');
    await page.getByTestId('download').click();
    await expect(page.getByTestId('export-status')).toHaveText('Downloaded book-a-forging-workshop.spec.ts');
  });
});
