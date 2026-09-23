import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

test.describe('Agent Brief Builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/024-agent-brief.html?fresh');
  });

  test('an empty brief scores 0 and names what is missing', async ({ page }) => {
    await expect(page.getByTestId('score')).toHaveText('0');
    await expect(page.getByTestId('grade')).toHaveText('Vague');
    for (const id of ['no-goal', 'no-criteria', 'no-tests', 'no-files']) {
      await expect(page.getByTestId(`sug-${id}`)).toBeVisible();
    }
    // "Fix" jumps to the right field
    await page.getByTestId('sug-no-criteria').getByRole('button', { name: 'Fix' }).click();
    await expect(page.getByTestId('add-criteria')).toBeFocused();
  });

  test('vague wording is called out specifically', async ({ page }) => {
    await page.getByTestId('f-goal').fill('Make the login page nice and fast');
    const sug = page.getByTestId('sug-vague-goal');
    await expect(sug).toContainText('"nice"');
    await expect(sug).toContainText('"fast"');
    await page.getByTestId('f-goal').fill('The login form shows an inline error within 200 ms when the password is wrong');
    await expect(sug).toBeHidden();

    await page.getByTestId('add-criteria').fill('It looks nice');
    await page.getByTestId('add-criteria').press('Enter');
    await expect(page.getByTestId('criteria-item-0')).toContainText('It looks nice');
    await expect(page.getByTestId('sug-untestable')).toContainText('Hard to verify: "It looks nice"');
    await page.getByTestId('criteria-item-0').getByRole('button', { name: /Remove/ }).click();
    await expect(page.getByTestId('sug-untestable')).toBeHidden();
    await expect(page.getByTestId('sug-no-criteria')).toBeVisible();
  });

  test('building a brief by hand raises the score and fills the preview', async ({ page }) => {
    await page.getByTestId('f-title').fill('Stop duplicate sign-up emails');
    await page.getByTestId('f-goal').fill('Each new account receives exactly one welcome email, even when the sign-up request is retried.');
    const before = Number(await page.getByTestId('score').textContent());
    await page.getByTestId('add-criteria').fill('Retrying POST /signup with the same email sends 1 email, not 2');
    await page.getByTestId('add-criteria-btn').click();
    await page.getByTestId('add-criteria').fill('The existing welcome-email test still passes');
    await page.getByTestId('add-criteria-btn').click();
    await page.getByTestId('f-tests').fill('Run `npm test -- signup` and add a test that posts twice.');
    await page.getByTestId('add-files').fill('server/signup.ts');
    await page.getByTestId('add-files-btn').click();
    await page.getByTestId('d-pr').check();
    const after = Number(await page.getByTestId('score').textContent());
    expect(after).toBeGreaterThan(before + 30);

    const preview = page.getByTestId('preview');
    await expect(preview.locator('h1')).toHaveText('Brief: Stop duplicate sign-up emails');
    await expect(preview.locator('ul.check li')).toHaveCount(2);
    await expect(preview.locator('code', { hasText: 'server/signup.ts' })).toBeVisible();
    await page.getByTestId('mode-raw').click();
    await expect(page.getByTestId('raw')).toContainText('- [ ] Retrying POST /signup with the same email sends 1 email, not 2');
    await expect(page.getByTestId('raw')).toContainText('- `server/signup.ts`');
  });

  test('templates produce complete briefs; the vague one does not', async ({ page }) => {
    for (const t of ['bug', 'feature', 'refactor']) {
      await page.getByTestId(`tpl-${t}`).click();
      await expect(page.getByTestId('score')).toHaveText('100');
      await expect(page.getByTestId('grade')).toHaveText('Excellent');
      await expect(page.getByTestId('sug-none')).toBeVisible();
    }
    await page.getByTestId('tpl-vague').click();
    await expect(page.getByTestId('grade')).toHaveText('Vague');
    await expect(page.getByTestId('sug-vague-goal')).toContainText('"fix the bugs"');
  });

  test('download as Markdown and the draft survives a reload', async ({ page }) => {
    await page.getByTestId('tpl-bug').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    expect(dl.suggestedFilename()).toBe('brief-fix-double-charge-when-a-payment-is-retried.md');
    const md = readFileSync((await dl.path())!, 'utf8');
    expect(md).toMatch(/^# Brief: Fix double charge when a payment is retried/);
    expect(md).toContain('## Acceptance criteria\n- [ ] Every charge request carries an Idempotency-Key');
    expect(md).toContain('## Out of scope\n- Refunding historical double charges');

    await page.goto('/lab/024-agent-brief.html');
    await expect(page.getByTestId('f-title')).toHaveValue('Fix double charge when a payment is retried');
    await expect(page.getByTestId('score')).toHaveText('100');
  });
});
