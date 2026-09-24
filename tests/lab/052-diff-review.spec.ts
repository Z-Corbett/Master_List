import { test, expect, type Page } from '@playwright/test';

async function flag(page: Page, line: number, cat: string) {
  await page.getByTestId(`line-${line}`).click();
  await page.getByTestId(`cat-${cat}`).check();
  await page.getByTestId('add-comment').click();
}

test.describe('Diff Review Dojo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/052-diff-review.html');
  });

  test('a clean hit on the off-by-one loop scores 10 and reveals the fix', async ({ page }) => {
    await expect(page.getByTestId('diff-title')).toHaveText('src/notifications/recent.ts');
    await expect(page.getByTestId('submit-review')).toBeDisabled();
    await flag(page, 5, 'boundary');
    await expect(page.getByTestId('comment')).toContainText('Off-by-one / boundary');
    await expect(page.getByTestId('review-state')).toHaveText('Flagged line 15 as “Off-by-one / boundary”.');
    await page.getByTestId('submit-review').click();

    await expect(page.getByTestId('verdict')).toHaveAttribute('data-result', 'perfect');
    await expect(page.getByTestId('score')).toHaveText('10');
    await expect(page.getByTestId('streak')).toHaveText('1');
    await expect(page.getByTestId('line-5')).toHaveClass(/\bbug\b/);
    await expect(page.getByTestId('explain')).toContainText('newest notification');
    await expect(page.getByTestId('fix')).toContainText('i < items.length; i++');
    await expect(page.getByTestId('next')).toBeFocused();
    await page.getByTestId('next').click();
    await expect(page.getByTestId('diff-title')).toHaveText('server/drafts.js');
    await expect(page.getByTestId('progress').locator('li').first()).toHaveClass('perfect');
  });

  test('partial credit, misses and approving a buggy diff reset the streak', async ({ page }) => {
    await flag(page, 5, 'boundary');
    await page.getByTestId('submit-review').click();
    await page.getByTestId('next').click();

    // drafts.js: right line, wrong category -> 5 points, streak broken
    await flag(page, 4, 'race');
    await page.getByTestId('submit-review').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-result', 'half');
    await expect(page.getByTestId('verdict')).toContainText('async / missing await');
    await expect(page.getByTestId('score')).toHaveText('15');
    await expect(page.getByTestId('streak')).toHaveText('0');
    await page.getByTestId('next').click();

    // search.ts: flag an unchanged line -> miss, told where the bug was
    await flag(page, 1, 'injection');
    await page.getByTestId('submit-review').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-result', 'miss');
    await expect(page.getByTestId('verdict')).toHaveText('Missed — the bug is on line 9.');
    await page.getByTestId('next').click();

    // useSearch.js: LGTM on a buggy diff
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('verdict')).toHaveText('Approved — but this diff ships a bug.');
    await expect(page.getByTestId('score')).toHaveText('15');
    await expect(page.getByTestId('best')).toHaveText('1');
    await expect(page.getByTestId('progress').locator('li').nth(1)).toHaveClass('half');
    await expect(page.getByTestId('progress').locator('li').nth(3)).toHaveClass('miss');
  });

  test('composer requires a category; comments can be edited and deleted from the keyboard', async ({ page }) => {
    await page.getByRole('button', { name: 'Comment on added line 15' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('composer')).toBeVisible();
    await page.getByTestId('add-comment').click();
    await expect(page.getByTestId('composer-msg')).toHaveText('Pick a category first.');
    await page.getByTestId('cat-comparator').check();
    await page.getByTestId('note').fill('loop bound skips the last item');
    await page.getByTestId('add-comment').click();
    await expect(page.getByTestId('comment')).toContainText('loop bound skips the last item');
    await expect(page.getByTestId('line-5')).toHaveClass(/\bmine\b/);

    // reopen: the saved category is preselected, then delete the comment
    await page.getByTestId('line-5').click();
    await expect(page.getByTestId('cat-comparator')).toBeChecked();
    await page.getByTestId('delete-comment').click();
    await expect(page.getByTestId('comment')).toHaveCount(0);
    await expect(page.getByTestId('submit-review')).toBeDisabled();
  });

  test('split view pairs removed and added lines, with syntax colouring per language', async ({ page }) => {
    await expect(page.getByTestId('diff').locator('.k', { hasText: 'export' }).first()).toBeVisible();
    await page.getByTestId('view-split').click();
    await expect(page.getByTestId('view-split')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('diff').locator('table.split')).toHaveCount(1);
    // the removed slice(-n) line sits beside the first added line in one row
    const pair = page.getByTestId('diff').locator('tr.pair').first();
    await expect(pair.getByTestId('line-3')).toContainText('items.slice(-n)');
    await expect(pair.getByTestId('line-4')).toContainText('const out');
    await expect(page.getByTestId('diff').locator('td.empty')).not.toHaveCount(0);

    // skip ahead to the SQL diff (8th) and check SQL tokens
    for (let i = 0; i < 7; i++) { await page.getByTestId('approve').click(); await page.getByTestId('next').click(); }
    await expect(page.getByTestId('diff-title')).toHaveText('sql/reports/march_revenue.sql');
    await expect(page.getByTestId('diff').locator('.k', { hasText: /^BETWEEN$/ })).toHaveCount(1);
    await expect(page.getByTestId('diff').locator('.c').first()).toContainText('-- Daily revenue');
    await flag(page, 7, 'boundary');
    await page.getByTestId('submit-review').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-result', 'perfect');
    await expect(page.getByTestId('line-7')).toHaveClass(/\bbugc\b/);
  });

  test('a perfect run earns 120 and a black belt; best streak persists', async ({ page }) => {
    test.setTimeout(60_000);
    for (let i = 0; i < 12; i++) {
      const d = await page.evaluate(() => (window as any).__dojo.diff);
      await flag(page, d.bug[0], d.cat);
      await page.getByTestId('submit-review').click();
      await expect(page.getByTestId('verdict')).toHaveAttribute('data-result', 'perfect');
      await page.getByTestId('next').click();
    }
    await expect(page.getByTestId('final')).toBeVisible();
    await expect(page.getByTestId('final')).toHaveAttribute('data-score', '120');
    await expect(page.getByTestId('final')).toContainText('Black belt reviewer.');
    await expect(page.getByTestId('best')).toHaveText('12');
    await page.reload();
    await expect(page.getByTestId('best')).toHaveText('12');
    await expect(page.getByTestId('score')).toHaveText('0');
  });

  test('?seed= shuffles the order deterministically', async ({ page }) => {
    await page.goto('/lab/052-diff-review.html?seed=7');
    const a = await page.evaluate(() => (window as any).__dojo.order);
    await page.goto('/lab/052-diff-review.html?seed=7');
    expect(await page.evaluate(() => (window as any).__dojo.order)).toEqual(a);
    expect(a).not.toEqual([...Array(12).keys()]);
    expect([...a].sort((x: number, y: number) => x - y)).toEqual([...Array(12).keys()]);
  });
});
