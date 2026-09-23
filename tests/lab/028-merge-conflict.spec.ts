import { test, expect, Page } from '@playwright/test';

const URL = '/lab/028-merge-conflict.html';

async function unlockThrough(page: Page, solved: number) {
  // Pretend levels 1..solved are already solved (score 1 each) so later levels can be opened directly.
  await page.addInitScript(n => {
    const best: Record<number, number> = {};
    for (let i = 0; i < n; i++) best[i] = 1;
    localStorage.setItem('mergeconflict.v1', JSON.stringify({ best }));
  }, solved);
}

const summary = (page: Page) => page.getByTestId('test-summary').last();

async function edit(page: Page, hunk: number, text: string) {
  await page.getByTestId(`edit-${hunk}`).click();
  await page.getByTestId(`edit-text-${hunk}`).fill(text);
  await page.getByTestId(`edit-apply-${hunk}`).click();
}

test.describe('028 Merge Conflict', () => {
  test('git refuses to commit unresolved files; the wrong side fails the hidden tests', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('file-name')).toHaveText('greeting.js');
    await expect(page.getByTestId('code')).toContainText('<<<<<<< HEAD (ours)');
    await expect(page.getByTestId('code')).toContainText('>>>>>>> feature/texas-copy (theirs)');
    await expect(page.getByTestId('level-2')).toBeDisabled();

    await page.getByTestId('commit').click();
    await expect(page.getByTestId('terminal')).toContainText('Committing is not possible because you have unmerged files');
    await expect(page.getByTestId('test-summary')).toHaveCount(0);

    await page.getByTestId('ours-0').click();
    await expect(page.getByTestId('hunk').first()).toHaveAttribute('data-resolved', 'ours');
    await expect(page.getByTestId('unresolved')).toHaveAttribute('data-count', '0');
    await page.getByTestId('commit').click();
    await expect(summary(page)).toHaveText('2/3 passing');
    await expect(page.locator('[data-testid="test-result"][data-pass="false"]')).toHaveText(['greet() uses the approved copy']);
    await expect(page.getByTestId('level-complete')).toBeHidden();

    await page.getByTestId('undo-0').click();
    await page.getByTestId('theirs-0').click();
    await page.getByTestId('commit').click();
    await expect(summary(page)).toHaveText('3/3 passing');
    await expect(page.getByTestId('level-complete')).toContainText('Merged!');
    await expect(page.getByTestId('level-2')).toBeEnabled();

    await page.reload(); // progress persists
    await expect(page.getByTestId('file-name')).toHaveText('cart.js');
  });

  test('timer and score use the clock: time bonus minus failed-commit penalty', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-23T12:00:00') });
    await page.clock.pauseAt(new Date('2026-09-23T12:00:01'));
    await page.goto(URL);
    await expect(page.getByTestId('timer')).toHaveText('00:00');
    await page.clock.fastForward(65_000);
    await expect(page.getByTestId('timer')).toHaveText('01:05');
    await page.getByTestId('ours-0').click();
    await page.getByTestId('commit').click(); // one failed attempt: -50
    await page.getByTestId('undo-0').click();
    await page.getByTestId('theirs-0').click();
    await page.getByTestId('commit').click();
    // 100 per hunk + 100, plus (180 - 65) time bonus, minus 50
    await expect(page.getByTestId('level-score')).toHaveText('+265');
    await expect(page.getByTestId('score')).toHaveText('265');
    await page.clock.fastForward(30_000);
    await expect(page.getByTestId('timer')).toHaveText('01:05'); // stopped once merged
  });

  test('order matters: "both" in the wrong order crashes, theirs-first passes', async ({ page }) => {
    await unlockThrough(page, 3);
    await page.goto(URL + '?level=4');
    await expect(page.getByTestId('file-name')).toHaveText('pipeline.js');
    await page.getByTestId('both-0').click();
    await page.getByTestId('commit').click();
    await expect(summary(page)).toHaveText('2/5 passing');
    await expect(page.getByTestId('terminal')).toContainText('TypeError');
    await page.getByTestId('undo-0').click();
    await page.getByTestId('both-rev-0').click();
    expect(await page.evaluate(() => (window as any).__merge.source())).toContain('parseBody,\n  authenticate,\n  rateLimit,\n  handle,');
    await page.getByTestId('commit').click();
    await expect(summary(page)).toHaveText('5/5 passing');
  });

  test('duplicate declarations fail to load; hand edits can combine both sides', async ({ page }) => {
    await unlockThrough(page, 5);
    await page.goto(URL + '?level=6');
    await page.getByTestId('both-0').click();
    await page.getByTestId('theirs-1').click();
    await page.getByTestId('commit').click();
    await expect(summary(page)).toHaveText('0/5 passing');
    await expect(page.getByTestId('terminal')).toContainText('SyntaxError');
    await expect(page.getByTestId('terminal')).toContainText('skipped: module failed to load');

    await page.getByTestId('level-5').click();
    await expect(page.getByTestId('file-name')).toHaveText('fees.js');
    await page.getByTestId('theirs-0').click();
    await page.getByTestId('commit').click();
    await expect(summary(page)).toHaveText('3/5 passing');
    await page.getByTestId('undo-0').click();
    await edit(page, 0, 'function fee(amountCents, rate = 0.03) {\n  return Math.round(amountCents * rate);\n}');
    await expect(page.getByTestId('hunk').first()).toHaveAttribute('data-resolved', 'edited');
    await page.getByTestId('commit').click();
    await expect(summary(page)).toHaveText('5/5 passing');
  });

  test('a full playthrough of all eight levels', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(URL);
    const solutions: Array<Array<string | [string, string]>> = [
      ['theirs'],
      ['ours', 'theirs'],
      ['both', 'theirs'],
      ['both-rev'],
      [['edit', 'function fee(amountCents, rate = 0.03) {\n  return Math.round(amountCents * rate);\n}']],
      ['ours', 'theirs'],
      [['edit', "function formatSats(n) {\n  return n.toLocaleString('en-US') + ' sats';\n}"], 'ours'],
      ['theirs', 'ours', 'ours', 'both']
    ];
    for (let lvl = 0; lvl < solutions.length; lvl++) {
      await expect(page.getByTestId('level-num')).toHaveText(`${lvl + 1}/8`);
      for (let h = 0; h < solutions[lvl].length; h++) {
        const s = solutions[lvl][h];
        if (Array.isArray(s)) await edit(page, h, s[1]);
        else await page.getByTestId(`${s}-${h}`).click();
      }
      await page.getByTestId('commit').click();
      await expect(summary(page)).toHaveText(/^(\d+)\/\1 passing$/);
      await expect(page.getByTestId('level-complete')).toBeVisible();
      if (lvl < solutions.length - 1) await page.getByTestId('next-level').click();
    }
    await expect(page.getByTestId('level-complete')).toContainText('last level');
    expect(Number(await page.getByTestId('score').textContent())).toBeGreaterThan(8 * 250);
  });
});
