import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/086-sampling-playground.html';
const probs = (page: Page, col: string) => page.getByTestId(`${col}-bar`).evaluateAll((els) => els.map((e) => ({ w: e.getAttribute('data-word')!, p: Number(e.getAttribute('data-p')) })));
const entropy = (ps: number[]) => ps.reduce((a, p) => (p > 0 ? a - p * Math.log2(p) : a), 0);
async function set(page: Page, col: string, key: string, v: number) { await page.getByTestId(`${col}-${key}`).fill(String(v)); }
// Independent softmax over the documented start-of-sentence scores.
const START: [string, number][] = [['the', 2.2], ['a', 1.6], ['my', 1.0], ['every', 0.3], ['rain', 0.2]];
function softmaxT(t: number) { const e = START.map(([, l]) => Math.exp(l / t)); const z = e.reduce((a, b) => a + b, 0); return Object.fromEntries(START.map(([w], i) => [w, e[i] / z])); }

test.describe('Sampling Playground', () => {
  test('the distribution is a proper probability distribution and the entropy readout is correct', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('toy-stamp')).toContainText('not any real LLM');
    await page.getByTestId('A-preset-wild').click();
    await set(page, 'A', 'temp', 0.7);
    await set(page, 'A', 'p', 1);
    const ps = await probs(page, 'A');
    const expected = softmaxT(0.7);
    for (const { w, p } of ps) expect(p).toBeCloseTo(expected[w], 9);
    expect(ps.reduce((a, b) => a + b.p, 0)).toBeCloseTo(1, 9);
    const H = entropy(ps.map((x) => x.p));
    await expect(page.getByTestId('A-entropy')).toHaveText(H.toFixed(3));
    await expect(page.getByTestId('A-perp')).toHaveText((2 ** H).toFixed(2));
    await expect(page.getByTestId('A-h0')).toHaveText(entropy(Object.values(softmaxT(1))).toFixed(3));
  });

  test('temperature sharpens and flattens; zero means greedy', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('A-preset-wild').click();
    const H: number[] = [];
    for (const t of [0.3, 1, 2]) { await set(page, 'A', 'temp', t); H.push(Number(await page.getByTestId('A-entropy').textContent())); }
    expect(H[0]).toBeLessThan(H[1]);
    expect(H[1]).toBeLessThan(H[2]);
    expect(H[2]).toBeLessThanOrEqual(Math.log2(5) + 1e-9); // never above uniform over 5 words
    await set(page, 'A', 'temp', 0);
    await expect(page.getByTestId('A-temp-out')).toHaveText('0 (greedy)');
    await expect(page.getByTestId('A-entropy')).toHaveText('0.000');
    const ps = await probs(page, 'A');
    expect(ps.filter((x) => x.p > 0)).toEqual([{ w: 'the', p: 1 }]);
  });

  test('top-k keeps exactly k words and top-p keeps the smallest nucleus', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('A-preset-wild').click();
    await set(page, 'A', 'temp', 1);
    await set(page, 'A', 'k', 2);
    let ps = await probs(page, 'A');
    expect(ps.filter((x) => x.p > 0).map((x) => x.w)).toEqual(['the', 'a']);
    const e = softmaxT(1);
    expect(ps.find((x) => x.w === 'the')!.p).toBeCloseTo(e.the / (e.the + e.a), 9);
    await expect(page.locator('[data-testid="A-bar"].cut')).toHaveCount(3);

    await set(page, 'A', 'k', 0);
    await set(page, 'A', 'p', 0.7);
    ps = await probs(page, 'A');
    const kept = ps.filter((x) => x.p > 0).map((x) => x.w);
    // smallest prefix of the sorted raw distribution whose mass reaches 0.7
    const sorted = Object.entries(e).sort((a, b) => b[1] - a[1]);
    let cum = 0; const nucleus: string[] = [];
    for (const [w, p] of sorted) { nucleus.push(w); cum += p; if (cum >= 0.7) break; }
    expect(kept).toEqual(nucleus);
    expect(ps.reduce((a, b) => a + b.p, 0)).toBeCloseTo(1, 9);
  });

  test('repetition penalty lowers words already used; forcing words builds the prefix', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('A-preset-wild').click();
    await set(page, 'A', 'temp', 1);
    for (const w of ['the', 'cat', 'sat', 'on']) await page.locator(`[data-testid="A-bar"][data-word="${w}"]`).click();
    await expect(page.getByTestId('A-token')).toHaveText(['the', 'cat', 'sat', 'on']);
    const before = (await probs(page, 'A')).find((x) => x.w === 'the')!.p;
    await set(page, 'A', 'rep', 2);
    const bar = page.locator('[data-testid="A-bar"][data-word="the"]');
    await expect(bar).toHaveClass(/pen/);
    const after = (await probs(page, 'A')).find((x) => x.w === 'the')!.p;
    expect(after).toBeLessThan(before);
    // 'the' scored 2.0 after 'on'; halved to 1.0 it now ties with 'a' and trails 'my' (1.2)
    const ps = await probs(page, 'A');
    const top = [...ps].sort((a, b) => b.p - a.p)[0];
    expect(top.w).toBe('my');
    await page.locator('[data-testid="A-bar"][data-word="my"]').click();
    await page.getByTestId('A-finish').click();
    await expect(page.getByTestId('A-prefix')).toHaveAttribute('data-done', 'true');
    await expect(page.getByTestId('A-step')).toBeDisabled();
    await page.getByTestId('A-reset').click();
    await expect(page.getByTestId('A-token')).toHaveCount(0);
  });

  test('seeded runs: identical settings give identical sentences; greedy never varies', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    await page.getByTestId('copy-a-to-b').click();
    await page.getByTestId('A-run').click();
    await page.getByTestId('B-run').click();
    const a = await page.getByTestId('A-sent').allTextContents();
    const b = await page.getByTestId('B-sent').allTextContents();
    expect(a).toHaveLength(5);
    expect(b).toEqual(a);
    await page.reload();
    await page.getByTestId('A-run').click();
    expect(await page.getByTestId('A-sent').allTextContents()).toEqual(a);

    await page.getByTestId('B-preset-greedy').click();
    await page.getByTestId('B-run').click();
    await expect(page.getByTestId('B-distinct')).toHaveText('1');
    const g = await page.getByTestId('B-sent').allTextContents();
    expect(new Set(g).size).toBe(1);
    expect(g[0].replace(/\s+/g, ' ').trim()).toBe('the cat sleeps .');
  });
});
