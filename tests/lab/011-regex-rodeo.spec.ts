import { test, expect, Page } from '@playwright/test';

const URL = '/lab/011-regex-rodeo.html';

async function setup(page: Page, pattern: string, yes: string[], no: string[]) {
  await page.getByTestId('should-match').fill(yes.join('\n'));
  await page.getByTestId('should-not-match').fill(no.join('\n'));
  await page.getByTestId('pattern').fill(pattern);
}

test.describe('Regex Rodeo — regex tester as a test runner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.reload();
  });

  test('cases are reported as pass / fail like a test run', async ({ page }) => {
    await setup(page, '^\\d{5}$', ['90210', '1234'], ['abcde', '123456', '12345']);
    const summary = page.getByTestId('summary');
    await expect(summary).toHaveAttribute('data-pass', '3');
    await expect(summary).toHaveAttribute('data-fail', '2');
    const rows = page.getByTestId('case-row');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(1)).toHaveAttribute('data-status', 'fail');
    await expect(rows.nth(1)).toContainText('expected a match, got none');
    await expect(rows.nth(4)).toHaveAttribute('data-status', 'fail');
    await expect(rows.nth(4)).toContainText('expected no match');

    // fixing the pattern turns the suite green
    await page.getByTestId('pattern').fill('^\\d{4,5}$');
    await expect(summary).toHaveAttribute('data-fail', '1');
  });

  test('capture groups are highlighted and listed per case', async ({ page }) => {
    await setup(page, '(\\d{4})-(\\d{2})', ['released 2026-09 today'], []);
    const row = page.getByTestId('case-row').first();
    await expect(row).toHaveAttribute('data-status', 'pass');
    await expect(row.getByTestId('group-1')).toHaveText('2026');
    await expect(row.getByTestId('group-2')).toHaveText('09');
    await expect(row).toContainText('$1 = "2026"');
    // one match rendered as three marked chunks: group 1, the literal "-", group 2
    await expect(row.locator('mark.m')).toHaveCount(3);
  });

  test('pattern tokens are explained in plain English and follow the flags', async ({ page }) => {
    await page.getByTestId('pattern').fill('^\\d+(?:px|em)?$');
    const ex = page.getByTestId('explanation');
    await expect(ex).toContainText('Start of the text');
    await expect(ex).toContainText('Any digit');
    await expect(ex).toContainText('one or more times');
    await expect(ex).toContainText('non-capturing group');
    await expect(ex).toContainText('OR');
    await page.getByTestId('flag-m').check();
    await expect(ex).toContainText('Start of a line');

    // cheat-sheet inserts at the caret
    await page.getByTestId('pattern').fill('');
    await page.getByTestId('cheat-item').filter({ hasText: 'word boundary' }).click();
    await expect(page.getByTestId('pattern')).toHaveValue('\\b');
  });

  test('an invalid pattern shows a friendly compile error and leaves cases unrun', async ({ page }) => {
    await page.getByTestId('pattern').fill('(\\d+');
    await expect(page.getByTestId('pattern-error')).toBeVisible();
    await expect(page.getByTestId('pattern-error')).toContainText("won't compile");
    await expect(page.getByTestId('case-row').first()).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId('pattern')).toHaveAttribute('aria-invalid', 'true');
  });

  test('catastrophic backtracking is stopped by the time budget and the page stays usable', async ({ page }) => {
    await page.getByTestId('load-trap').click();
    await expect(page.getByTestId('timeout-warning')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('summary')).toContainText('aborted');

    // the UI is still alive: a safe pattern runs immediately afterwards
    await page.getByTestId('pattern').fill('^a+$');
    await expect(page.getByTestId('timeout-warning')).toBeHidden();
    await expect(page.getByTestId('summary')).toHaveAttribute('data-pass', '2');
  });

  test('a challenge round is won when every case passes, and the win persists', async ({ page }) => {
    await page.getByTestId('round-1').click();
    await expect(page.getByTestId('brief')).toContainText('Lasso the ZIP');
    await expect(page.getByTestId('pattern')).toHaveValue('');
    await page.getByTestId('pattern').fill('^\\d{5}$');
    await expect(page.getByTestId('round-state')).toContainText('some cases still fail');
    await page.getByTestId('pattern').fill('^\\d{5}(-\\d{4})?$');
    await expect(page.getByTestId('round-state')).toContainText('Round won');
    await expect(page.getByTestId('solved-count')).toHaveText('1');

    await page.reload();
    await expect(page.getByTestId('round-1')).toHaveAttribute('data-solved', 'true');
    await expect(page.getByTestId('solved-count')).toHaveText('1');
  });
});
