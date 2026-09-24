import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/069-tokenizer-toy.html';
const tokens = (page: Page) =>
  page.getByTestId('token').evaluateAll((els) => els.map((e) => [e.getAttribute('data-text'), Number(e.getAttribute('data-id'))] as [string, number]));

test.describe('Tokenizer Toy', () => {
  test('stepping merges the most frequent pair and records its count', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('vocab-size')).toHaveText('98');
    const top = page.getByTestId('pair').first();
    await expect(top).toHaveAttribute('data-a', ' ');
    await expect(top).toHaveAttribute('data-b', 't');
    await expect(top).toHaveAttribute('data-count', '58');
    const counts = await page.getByTestId('pair').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-count'))));
    expect([...counts].sort((a, b) => b - a)).toEqual(counts); // listed most frequent first

    await page.getByTestId('step').click();
    await expect(page.getByTestId('status')).toContainText('Merge #1: “·” + “t” → “·t” (seen 58 times). New ID 98.');
    await expect(page.getByTestId('vocab-size')).toHaveText('99');
    await expect(page.getByTestId('merge').first()).toHaveAttribute('data-token', ' t');
    // counts are recomputed on the merged corpus: the old winner is gone from the table
    await expect(page.getByTestId('pair').first()).toHaveAttribute('data-count', '54');
    await expect(page.locator('[data-testid="pair"][data-a=" "][data-b="t"]')).toHaveCount(0);
    await page.getByTestId('step10').click();
    await expect(page.getByTestId('merge-count')).toHaveText('11');
  });

  test('training stops exactly at the target vocabulary size', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('target').fill('150');
    await expect(page.getByTestId('target-out')).toHaveText('150');
    await page.getByTestId('train').click();
    await expect(page.getByTestId('vocab-size')).toHaveText('150');
    await expect(page.getByTestId('merge-count')).toHaveText('52');
    await expect(page.getByTestId('vocab-token')).toHaveCount(52);
    await expect(page.getByTestId('step')).toBeDisabled();
    await expect(page.getByTestId('status')).toContainText('150 tokens');
    // lowering the target trims the vocabulary by replaying fewer merges
    await page.getByTestId('target').fill('120');
    await expect(page.getByTestId('vocab-size')).toHaveText('120');
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('vocab-size')).toHaveText('98');
  });

  test('common words become single tokens; rare words and numbers shatter', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('train').click(); // target 200
    await page.getByTestId('input').fill('The baker bakes bread at the harbour.');
    expect(await tokens(page)).toEqual([
      ['The', 137], [' baker', 116], [' bak', 112], ['es', 133], [' bread', 130], [' at', 166], [' the', 100], [' harbour', 146], ['.', 15],
    ]);
    await page.getByTestId('ex-rare').click();
    await expect(page.getByTestId('n-tokens')).toHaveText('38');
    await expect(page.getByTestId('ratio')).toHaveText('1.16');
    await page.getByTestId('ex-numbers').click();
    const nums = (await tokens(page)).map(([t]) => t);
    expect(nums.slice(4, 12)).toEqual([' ', '1', '2', '3', '4', '5', '6', '7']); // one digit per token
    // the same token always gets the same ID
    const ids = new Map<string, number>();
    for (const [t, id] of await tokens(page)) { if (ids.has(t)) expect(ids.get(t)).toBe(id); ids.set(t, id); }
    await page.getByTestId('show-ids').uncheck();
    await expect(page.getByTestId('tokens')).toHaveClass(/noids/);
  });

  test('whitespace and unknown characters are visible tokens', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('ex-space').click();
    const toks = await tokens(page);
    expect(toks).toContainEqual(['\n', 96]);
    expect(toks).toContainEqual(['\t', 97]);
    await expect(page.getByTestId('tokens')).toContainText('↵');
    await expect(page.getByTestId('tokens')).toContainText('⇥');
    await page.getByTestId('ex-unicode').click();
    const unk = page.locator('[data-testid="token"][data-id="0"]');
    await expect(unk).toHaveCount(5); // é, è, ï, é, é
    await expect(unk.first()).toHaveAttribute('data-text', 'é');
  });

  test('training on your own text, which persists', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('src-custom').click();
    await page.getByTestId('corpus').fill('ab ab ab ab');
    await expect(page.getByTestId('status')).toContainText('restarted');
    await expect(page.getByTestId('pair').first()).toHaveAttribute('data-count', '4');
    await page.getByTestId('step').click();
    await expect(page.getByTestId('merge').first()).toHaveAttribute('data-token', 'ab');
    await page.getByTestId('step').click();
    await expect(page.getByTestId('merge').first()).toHaveAttribute('data-token', ' ab');
    await page.getByTestId('train').click();
    await expect(page.getByTestId('status')).toContainText('no pair occurs more than once');
    await page.getByTestId('input').fill('ab ab abc');
    expect((await tokens(page)).map(([t]) => t)).toEqual(['ab', ' ab', ' ab', 'c']);
    await page.reload();
    await page.getByTestId('src-custom').click();
    await expect(page.getByTestId('corpus')).toHaveValue('ab ab ab ab');
  });
});
