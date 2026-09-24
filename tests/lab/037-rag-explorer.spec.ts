import { test, expect, type Page } from '@playwright/test';

const expectedChunks = (n: number, size: number, overlap: number) => (n <= size ? 1 : Math.ceil((n - size) / (size - overlap)) + 1);
const scores = (page: Page) => page.getByTestId('result').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.score)));

test.describe('RAG Pipeline Explorer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/037-rag-explorer.html');
  });

  test('chunk size and overlap produce the expected number of chunks', async ({ page }) => {
    const n = Number(await page.getByTestId('word-count').textContent());
    expect(n).toBeGreaterThan(300);
    await expect(page.getByTestId('chunk-count')).toHaveText(String(expectedChunks(n, 60, 10)));
    await expect(page.getByTestId('dup-words')).toHaveText(String((expectedChunks(n, 60, 10) - 1) * 10));

    await page.getByTestId('overlap').fill('0');
    await page.getByTestId('chunk-size').fill('40');
    await expect(page.getByTestId('chunk-count')).toHaveText(String(expectedChunks(n, 40, 0)));
    await expect(page.getByTestId('dup-words')).toHaveText('0');
    await expect(page.getByTestId('stride')).toHaveText('40');

    // overlap is capped below the chunk size
    await page.getByTestId('chunk-size').fill('15');
    await expect(page.getByTestId('overlap')).toHaveAttribute('max', '10');
    await page.getByTestId('overlap').fill('10');
    await expect(page.getByTestId('stride')).toHaveText('5');
    await expect(page.getByTestId('chunk-count')).toHaveText(String(expectedChunks(n, 15, 10)));
    await expect(page.getByTestId('map').locator('.pt')).toHaveCount(expectedChunks(n, 15, 10));
  });

  test('a question retrieves top-k chunks ranked by cosine similarity into the context', async ({ page }) => {
    await page.getByTestId('example-0').click();
    await expect(page.getByTestId('result')).toHaveCount(3);
    const s = await scores(page);
    expect([...s].sort((a, b) => b - a)).toEqual(s);
    expect(s[s.length - 1]).toBeGreaterThanOrEqual(0.05);
    const ctx = page.getByTestId('context');
    await expect(ctx).toContainText('QUESTION: What should the keeper do when a gale warning is issued?');
    await expect(ctx).toContainText('switches the fog signal to automatic');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'found');
    await expect(page.getByTestId('query-star')).toBeVisible();
    await expect(page.getByTestId('map').locator('.pt[data-top="true"]')).toHaveCount(3);

    // raising k is capped by the similarity floor; dropping the floor lets weaker chunks in
    await page.getByTestId('top-k').fill('5');
    await expect(page.getByTestId('result')).toHaveCount(3);
    await page.getByTestId('floor').fill('0');
    await expect(page.getByTestId('result')).toHaveCount(5);
    await expect(page.getByTestId('near-misses').locator('li')).toHaveCount(3);
    await page.getByTestId('floor').fill('0.5');
    await expect(page.getByTestId('results')).toContainText('No chunk reached the similarity floor');
    await expect(page.getByTestId('context')).toContainText('(no chunk passed the similarity floor)');
    await page.getByTestId('floor').fill('0.05');

    // a custom question has no answer key
    await page.getByTestId('query').fill('When does the tower open in winter?');
    await page.getByTestId('ask').click();
    await expect(page.getByTestId('verdict')).toContainText('No answer key');
    await expect(page.getByTestId('context')).toContainText('first Sunday of each month');
  });

  test('word matching misses synonyms: "dogs" is found, "pets" is missed', async ({ page }) => {
    await page.getByTestId('example-2').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'found');
    await expect(page.getByTestId('context')).toContainText("Dogs are welcome in the keeper's garden");

    await page.getByTestId('example-3').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'missed');
    await expect(page.getByTestId('verdict')).toContainText('shares no words with the question');
    await expect(page.getByTestId('context')).not.toContainText('Dogs are welcome');
  });

  test('a boundary split is fixed by overlap', async ({ page }) => {
    await page.getByTestId('overlap').fill('0');
    await page.getByTestId('chunk-size').fill('200');
    await page.getByTestId('example-1').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'split');
    await expect(page.getByTestId('verdict')).toContainText('cut into separate chunks');
    await expect(page.getByTestId('doc').locator('.w.cut')).toHaveCount(1);

    await page.getByTestId('overlap').fill('20');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'found');
    await expect(page.getByTestId('doc').locator('.w.cut')).toHaveCount(0);

    // an answer longer than a chunk can never arrive whole
    await page.getByTestId('overlap').fill('0');
    await page.getByTestId('chunk-size').fill('15');
    await page.getByTestId('example-4').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'split');
  });

  test('the context budget drops retrieved chunks that do not fit', async ({ page }) => {
    await page.getByTestId('example-4').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'found');
    await expect(page.getByTestId('result').and(page.locator('.in'))).toHaveCount(3);

    await page.getByTestId('budget').fill('200');
    await expect(page.getByTestId('budget-out')).toHaveText('200');
    await expect(page.getByTestId('result').and(page.locator('.dropped'))).toHaveCount(2);
    const used = Number((await page.getByTestId('ctx-tokens').textContent())!.match(/≈(\d+)/)![1]);
    expect(used).toBeLessThanOrEqual(200);

    await page.getByTestId('budget').fill('100');
    await expect(page.getByTestId('context')).toContainText('(no chunks fit the budget)');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'budget');
    await expect(page.getByTestId('verdict')).toContainText('Retrieved, then dropped');
  });
});
