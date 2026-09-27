import { test, expect, Page } from '@playwright/test';

const URL = '/lab/122-benford-lab.html';
const last = (page: Page) => page.evaluate(() => (window as any).__benford.last);

// Independent oracles, computed here rather than read from the page.
const E1 = [0, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => Math.log10(1 + 1 / d))];
const E2 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => { let s = 0; for (let k = 1; k <= 9; k++) s += Math.log10(1 + 1 / (10 * k + d)); return s; });
function firstDigitCounts(values: bigint[]) { const c = new Array(10).fill(0); for (const v of values) c[+v.toString()[0]]++; return c; }
function secondDigitCounts(values: bigint[]) { const c = new Array(10).fill(0); for (const v of values) { const s = v.toString(); if (s.length > 1) c[+s[1]]++; } return c; }
function chi(counts: number[], exp: number[], from: number) {
  const N = counts.slice(from).reduce((a, b) => a + b, 0);
  let x = 0; for (let d = from; d <= 9; d++) x += (counts[d] - N * exp[d]) ** 2 / (N * exp[d]);
  return x;
}
function mad(counts: number[], exp: number[], from: number) {
  const N = counts.slice(from).reduce((a, b) => a + b, 0);
  let m = 0; for (let d = from; d <= 9; d++) m += Math.abs(counts[d] / N - exp[d]);
  return m / (10 - from);
}
const pow2 = () => { const o: bigint[] = []; let x = 1n; for (let i = 1; i <= 1000; i++) { x *= 2n; o.push(x); } return o; };
const fib = () => { const o: bigint[] = []; let a = 1n, b = 1n; for (let i = 1; i <= 1000; i++) { o.push(a); [a, b] = [b, a + b]; } return o; };
const tableCounts = (page: Page, from: number) =>
  page.getByTestId(from === 1 ? 'table1' : 'table2').locator('tbody tr').evaluateAll((rows) => rows.map((r) => +(r.children[1].textContent || '0')));

test.describe('122 Benford Lab', () => {
  test('expected proportions: log10(1 + 1/d), d = 1 gives 30.103%; second digits sum over k', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('row1-1').locator('td').nth(3)).toHaveText('30.103%');
    await expect(page.getByTestId('row1-9').locator('td').nth(3)).toHaveText('4.576%');
    for (let d = 1; d <= 9; d++) await expect(page.getByTestId(`row1-${d}`).locator('td').nth(3)).toHaveText(`${(100 * E1[d]).toFixed(3)}%`);
    await expect(page.getByTestId('row0-0').locator('td').nth(3)).toHaveText('11.968%');
    await expect(page.getByTestId('row0-9').locator('td').nth(3)).toHaveText('8.500%');
    for (let d = 0; d <= 9; d++) await expect(page.getByTestId(`row0-${d}`).locator('td').nth(3)).toHaveText(`${(100 * E2[d]).toFixed(3)}%`);
    // both sets of probabilities sum to 1
    const sums = await page.evaluate(() => { const b = (window as any).__benford; return [b.E1.reduce((a: number, x: number) => a + x, 0), b.E2.reduce((a: number, x: number) => a + x, 0)]; });
    expect(sums[0]).toBeCloseTo(1, 12);
    expect(sums[1]).toBeCloseTo(1, 12);
  });

  test('powers of 2: exact first-digit counts for 2^1..2^1000 match a BigInt count made in the test', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('set-pow2')).toHaveAttribute('aria-pressed', 'true');   // the default
    const want = firstDigitCounts(pow2());
    expect(want.slice(1)).toEqual([301, 176, 125, 97, 79, 69, 56, 52, 45]);
    expect(await tableCounts(page, 1)).toEqual(want.slice(1));
    expect(await tableCounts(page, 0)).toEqual(secondDigitCounts(pow2()));
    await expect(page.getByTestId('n')).toHaveText('1,000');
    await expect(page.getByTestId('row1-1').locator('td').nth(2)).toHaveText('30.100%');
    await expect(page.getByTestId('chi1')).toHaveText(chi(want, E1, 1).toFixed(2));
    await expect(page.getByTestId('mad1')).toHaveText(mad(want, E1, 1).toFixed(4));
    await expect(page.getByTestId('verdict1')).toHaveText('Close conformity');
  });

  test('chi-square and MAD: the page agrees with the formula, and p-values match the chi-square tables', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('set-fib').click();
    await expect(page.getByTestId('ds-name')).toHaveText('Fibonacci numbers');
    const f = fib(), c1 = firstDigitCounts(f), c2 = secondDigitCounts(f);
    const L = await last(page);
    expect(L.counts1).toEqual(c1.map((x, i) => (i === 0 ? 0 : x)));
    expect(L.first.chi).toBeCloseTo(chi(c1, E1, 1), 9);
    expect(L.first.mad).toBeCloseTo(mad(c1, E1, 1), 12);
    expect(L.second.chi).toBeCloseTo(chi(c2, E2, 0), 9);
    expect(L.second.mad).toBeCloseTo(mad(c2, E2, 0), 12);
    expect(L.first.df).toBe(8);
    expect(L.second.df).toBe(9);
    // p-values: the published 5% critical values, and df 2 where the survival function is exactly e^(−x/2)
    const p = await page.evaluate(() => { const b = (window as any).__benford; return [b.chiP(15.507, 8), b.chiP(16.919, 9), b.chiP(20.090, 8), b.chiP(3, 2), b.chiP(0.5, 8)]; });
    expect(p[0]).toBeCloseTo(0.05, 4);
    expect(p[1]).toBeCloseTo(0.05, 4);
    expect(p[2]).toBeCloseTo(0.01, 4);
    expect(p[3]).toBeCloseTo(Math.exp(-1.5), 10);
    expect(p[4]).toBeGreaterThan(0.99);
    await expect(page.getByTestId('p1')).toContainText('not rejected at 5%');
  });

  test("Nigrini's conformity ranges, first and second digits", async ({ page }) => {
    await page.goto(URL);
    const v = (m: number, k: string) => page.evaluate(([m, k]) => (window as any).__benford.verdict(m, k).label, [m, k] as const);
    expect(await v(0.0059, 'first')).toBe('Close conformity');
    expect(await v(0.006, 'first')).toBe('Close conformity');
    expect(await v(0.0061, 'first')).toBe('Acceptable conformity');
    expect(await v(0.012, 'first')).toBe('Acceptable conformity');
    expect(await v(0.0121, 'first')).toBe('Marginally acceptable conformity');
    expect(await v(0.015, 'first')).toBe('Marginally acceptable conformity');
    expect(await v(0.0151, 'first')).toBe('Nonconformity');
    expect(await v(0.008, 'second')).toBe('Close conformity');
    expect(await v(0.0085, 'second')).toBe('Acceptable conformity');
    expect(await v(0.011, 'second')).toBe('Marginally acceptable conformity');
    expect(await v(0.0125, 'second')).toBe('Nonconformity');
    await expect(page.getByTestId('summary')).toHaveAttribute('aria-live', 'polite');
  });

  test('pasted numbers: thousands separators, decimals, exponents and signs; zeros and junk are skipped', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('paste').fill('1,234.50  872\n0.0417; 15e3 -96 0 abc 5,7');
    await page.getByTestId('analyze').click();
    await expect(page.getByTestId('ds-name')).toHaveText('Your pasted numbers');
    await expect(page.getByTestId('set-pow2')).toHaveAttribute('aria-pressed', 'false');
    // significant digits: 123450, 872, 417, 15, 96, 5, 7  → first digits 1 8 4 1 9 5 7
    expect(await tableCounts(page, 1)).toEqual([2, 0, 0, 1, 1, 0, 1, 1, 1]);
    // second digits only where there are two: 2 7 1 5 6
    expect(await tableCounts(page, 0)).toEqual([0, 1, 1, 0, 0, 1, 1, 1, 0, 0]);
    await expect(page.getByTestId('n')).toHaveText('7 (skipped 1 zero, 1 not a number)');
    await expect(page.getByTestId('n2')).toContainText('(5 numbers with 2+ digits');
    // empty input: no crash, no verdict
    await page.getByTestId('paste').fill('');
    await page.getByTestId('analyze').click();
    await expect(page.getByTestId('n')).toHaveText('0');
    await expect(page.getByTestId('verdict1')).toHaveText('Not enough data');
  });

  test('datasets that should fail do: capped uniform, assigned IDs, heights and primes', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('set-uniform').click();
    await expect(page.getByTestId('ds-name')).toHaveText('Uniform 1–999 (capped) (synthetic)');
    await expect(page.getByTestId('verdict1')).toHaveText('Nonconformity');
    let L = await last(page);
    expect(L.first.N).toBe(2000);
    expect(L.first.p).toBeLessThan(1e-6);
    await page.getByTestId('set-ids').click();
    L = await last(page);
    expect(L.counts1[4]).toBe(1000);                                        // 40001..41000 all start with 4
    await expect(page.getByTestId('verdict1')).toHaveText('Nonconformity');
    await page.getByTestId('set-heights').click();
    L = await last(page);
    expect(L.counts1[1] / L.first.N).toBeGreaterThan(0.99);
    await page.getByTestId('set-primes').click();
    L = await last(page);
    expect(L.first.N).toBe(9592);                                           // π(100 000) = 9592
    await expect(page.getByTestId('verdict1')).toHaveText('Nonconformity');
    // factorials, a real sequence, conform
    await page.getByTestId('set-fact').click();
    L = await last(page);
    expect(L.first.N).toBe(1000);
    expect(L.first.mad).toBeLessThan(0.012);
  });

  test('synthetic sets are labelled and seeded: same seed, same data; another seed, another draw', async ({ page }) => {
    await page.goto(`${URL}?seed=7`);
    await expect(page.getByTestId('seed')).toHaveText('7');
    for (const id of ['loguni', 'uniform', 'ids', 'heights']) await expect(page.getByTestId(`set-${id}`).locator('.tag')).toHaveText('synthetic');
    for (const id of ['pow2', 'fib', 'fact', 'primes']) await expect(page.getByTestId(`set-${id}`).locator('.tag')).toHaveText('computed');
    await page.getByTestId('set-loguni').click();
    await expect(page.getByTestId('ds-note')).toHaveText(/^SYNTHETIC\./);
    await expect(page.getByTestId('verdict1')).toHaveText(/Close conformity|Acceptable conformity/);
    const a = (await last(page)).counts1;
    await page.reload();
    await page.getByTestId('set-loguni').click();
    expect((await last(page)).counts1).toEqual(a);
    await page.goto(`${URL}?seed=8`);
    await page.getByTestId('set-loguni').click();
    expect((await last(page)).counts1).not.toEqual(a);
  });

  test('charts: one bar per digit with the expected curve, described in text', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('chart1').locator('g.bar')).toHaveCount(9);
    await expect(page.getByTestId('chart2').locator('g.bar')).toHaveCount(10);
    await expect(page.getByTestId('chart1').locator('circle')).toHaveCount(9);
    await expect(page.getByTestId('chart1')).toHaveAttribute('aria-label', /First digit distribution of 1000 numbers against Benford/);
    await expect(page.getByTestId('chart1').locator('g.bar[data-d="1"] title')).toHaveText('First digit 1: observed 30.10% (301), expected 30.10%');
    // bar height is proportional to the observed share: digit 1 is tallest, 9 shortest
    const h = await page.getByTestId('chart1').locator('path.b').evaluateAll((ps) => ps.map((p) => (p as SVGGraphicsElement).getBBox().height));
    expect(h).toHaveLength(9);
    expect(Math.max(...h)).toBe(h[0]);
    expect(Math.min(...h)).toBe(h[8]);
    expect(h[0] / h[8]).toBeCloseTo(301 / 45, 1);
  });

  test('keyboard: dataset buttons are reachable and toggle with Enter and Space', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('set-pow2').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('set-fib')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('set-fib')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('set-pow2')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Tab');
    await page.keyboard.press(' ');
    await expect(page.getByTestId('ds-name')).toHaveText('Factorials');
    await expect(page.locator('.set[aria-pressed="true"]')).toHaveCount(1);
  });
});
