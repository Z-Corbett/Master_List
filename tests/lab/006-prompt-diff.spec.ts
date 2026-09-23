import { test, expect } from '@playwright/test';

const URL = '/lab/006-prompt-diff.html';

test.describe('006 Prompt Diff', () => {
  test('preloaded example shows a diff, estimates and contrasting lint grades', async ({ page }) => {
    await page.goto(URL);
    const a = page.getByTestId('prompt-a');
    const b = page.getByTestId('prompt-b');
    await expect(a).not.toHaveValue('');
    await expect(b).not.toHaveValue('');

    // token estimate oracle: ceil(chars / 4)
    const lenA = (await a.inputValue()).length;
    const lenB = (await b.inputValue()).length;
    await expect(page.getByTestId('tokens-a')).toHaveText(String(Math.ceil(lenA / 4)));
    await expect(page.getByTestId('tokens-b')).toHaveText(String(Math.ceil(lenB / 4)));

    const diff = page.getByTestId('diff-output');
    await expect(diff.locator('ins').first()).toBeVisible();
    await expect(diff.locator('del').first()).toBeVisible();

    // The "before" prompt fails every check, the "after" prompt passes them all
    await expect(page.getByTestId('grade-a')).toHaveText('F');
    await expect(page.getByTestId('lint-a').locator('li[data-status="warn"]')).toHaveCount(5);
    await expect(page.getByTestId('grade-b')).toHaveText('A');
    await expect(page.getByTestId('lint-b').locator('li[data-status="pass"]')).toHaveCount(5);
  });

  test('word-level diff highlights exactly the inserted and removed words', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('clear').click();
    await page.getByTestId('prompt-a').fill('Return a short list of fruits.');
    await page.getByTestId('prompt-b').fill('Return a JSON list of fruits.');
    const diff = page.getByTestId('diff-output');
    await expect(diff.locator('ins')).toHaveText(['JSON']);
    await expect(diff.locator('del')).toHaveText(['short']);
    await expect(page.getByTestId('words-added')).toHaveText('1');
    await expect(page.getByTestId('words-removed')).toHaveText('1');
    await expect(page.getByTestId('tokens-delta')).toHaveText('0'); // 30 vs 29 chars: both estimate to 8 tokens

    await page.getByTestId('prompt-b').fill('Return a short list of fruits.');
    await expect(diff).toContainText('identical');
    await expect(page.getByTestId('similarity')).toHaveText('100%');
  });

  test('lint rules react to ambiguous words, format, examples and conflicts', async ({ page }) => {
    await page.goto(URL);
    const a = page.getByTestId('prompt-a');
    await a.fill('Maybe write some notes about the meeting. Be brief and be detailed.');
    const amb = page.getByTestId('rule-a-ambiguous');
    await expect(amb).toHaveAttribute('data-status', 'warn');
    await expect(amb).toContainText('maybe');
    await expect(amb).toContainText('some');
    await expect(page.getByTestId('rule-a-format')).toHaveAttribute('data-status', 'warn');
    await expect(page.getByTestId('rule-a-examples')).toHaveAttribute('data-status', 'warn');
    await expect(page.getByTestId('rule-a-conflicts')).toHaveAttribute('data-status', 'warn');

    await a.fill('Write three notes about the meeting. Respond in JSON with a "notes" array.\nExample: {"notes": ["Budget approved"]}');
    for (const rule of ['ambiguous', 'format', 'examples', 'conflicts', 'long']) {
      await expect(page.getByTestId(`rule-a-${rule}`)).toHaveAttribute('data-status', 'pass');
    }
    await expect(page.getByTestId('grade-a')).toHaveText('A');
  });

  test('state round-trips through the URL hash, including the split view', async ({ page, context }) => {
    await page.goto(URL);
    await page.getByTestId('prompt-a').fill('Summarise the ticket. ✨ unicode ok');
    await page.getByTestId('prompt-b').fill('Summarise the ticket in two bullet points.');
    await page.getByTestId('view-split').click();
    await page.getByTestId('share').click();
    await expect(page.getByTestId('toast')).toContainText(/link/i);
    await expect(page).toHaveURL(/#a=.+&b=.+&v=split/);

    const shared = page.url();
    const other = await context.newPage();
    await other.goto(shared);
    await expect(other.getByTestId('prompt-a')).toHaveValue('Summarise the ticket. ✨ unicode ok');
    await expect(other.getByTestId('prompt-b')).toHaveValue('Summarise the ticket in two bullet points.');
    await expect(other.getByTestId('view-split')).toHaveAttribute('aria-pressed', 'true');
    await expect(other.getByTestId('split-b').locator('ins')).toContainText('in two bullet points');
  });

  test('swap exchanges the versions and flips added/removed counts', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('clear').click();
    await page.getByTestId('prompt-a').fill('Classify the email.');
    await page.getByTestId('prompt-b').fill('Classify the email as spam or not spam.');
    await expect(page.getByTestId('words-added')).toHaveText('5'); // as spam or not spam
    await expect(page.getByTestId('words-removed')).toHaveText('0');

    await page.getByTestId('swap').click();
    await expect(page.getByTestId('prompt-a')).toHaveValue('Classify the email as spam or not spam.');
    await expect(page.getByTestId('words-added')).toHaveText('0');
    await expect(page.getByTestId('words-removed')).toHaveText('5');
  });
});
