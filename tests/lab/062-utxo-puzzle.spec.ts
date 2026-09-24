import { test, expect, Page } from '@playwright/test';

const URL = '/lab/062-utxo-puzzle.html?seed=21';
type Coin = { id: string; v: number };
const level = (page: Page) => page.evaluate(() => (window as any).__utxo.level);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Independent re-implementation of the page's size / fee / change / waste rules. */
function oracle(values: number[], target: number, rate: number) {
  const vs = (i: number, o: number) => 10.5 + 68 * i + 31 * o;
  const n = values.length, total = values.reduce((a, b) => a + b, 0);
  const feeNo = Math.ceil(vs(n, 1) * rate), excess = total - target - feeNo;
  if (excess < 0) return { ok: false, total };
  const feeC = Math.ceil(vs(n, 2) * rate), change = total - target - feeC;
  const coc = rate * 31 + 10 * 68, inW = n * (rate - 10) * 68;
  if (change >= 294 && excess > coc) return { ok: true, total, change, fee: feeC, vsize: vs(n, 2), waste: Math.round(inW + coc) };
  return { ok: true, total, change: 0, fee: total - target, vsize: vs(n, 1), waste: Math.round(inW + excess), dust: change };
}
async function pick(page: Page, ids: string[]) {
  await page.getByTestId('clear').click();
  for (const id of ids) await page.getByTestId(`coin-${id}`).click();
}

test.describe('062 UTXO Puzzle', () => {
  test('the transaction balances: inputs − payment − change = fee, with the approximate vbyte model', async ({ page }) => {
    await page.goto(URL);
    const L = await level(page);
    await expect(page.getByTestId('target')).toHaveText(fmt(L.target));
    await expect(page.getByTestId('rate')).toHaveText(String(L.rate));
    // pick the two largest coins
    const two = [...L.coins].sort((a: Coin, b: Coin) => b.v - a.v).slice(0, 2);
    await pick(page, two.map((c: Coin) => c.id));
    await expect(page.getByTestId(`coin-${two[0].id}`)).toHaveAttribute('aria-pressed', 'true');
    const o = oracle(two.map((c: Coin) => c.v), L.target, L.rate);
    expect(o.ok).toBe(true);
    await expect(page.getByTestId('equation')).toHaveText(`${fmt(o.total)} − ${fmt(L.target)} − ${fmt(o.change!)} = ${fmt(o.fee!)} sats fee`);
    await expect(page.getByTestId('vsize')).toHaveText(`${o.vsize} vB`);
    await expect(page.getByTestId('fee')).toHaveText(fmt(o.fee!));
    await expect(page.getByTestId('waste')).toHaveText(fmt(o.waste!));
    expect(o.total - L.target - o.change! - o.fee!).toBe(0);
    await expect(page.getByTestId('broadcast')).toBeEnabled();

    // not enough: only the smallest coin
    const smallest = [...L.coins].sort((a: Coin, b: Coin) => a.v - b.v)[0];
    await pick(page, [smallest.id]);
    await expect(page.getByTestId('equation')).toContainText('Not enough');
    await expect(page.getByTestId('broadcast')).toBeDisabled();
  });

  test('leftover below the dust limit (or not worth a change output) goes to the fee', async ({ page }) => {
    await page.goto(URL);
    // search every level for a selection whose leftover is dust-sized, then build it through the UI
    const found = await page.evaluate(() => {
      const u = (window as any).__utxo;
      for (let k = 0; k < 6; k++) {
        u.load(k); const L = u.level, n = L.coins.length;
        for (let m = 1; m < (1 << n); m++) {
          const ids = L.coins.filter((_: any, i: number) => m & (1 << i)).map((c: any) => c.id);
          const r = u.evaluate(ids);
          if (r.ok && r.outputs === 1 && r.dustDropped > 0 && r.dustDropped < 294) return { k, ids };
        }
      }
      return null;
    });
    expect(found, 'seed 21 has a selection with a dust-sized leftover').not.toBeNull();
    await page.getByTestId(`level-${found!.k + 1}`).click();
    await expect(page.getByTestId(`level-${found!.k + 1}`)).toHaveAttribute('aria-current', 'true');
    await pick(page, found!.ids);
    const L = await level(page);
    const o = oracle(L.coins.filter((c: Coin) => found!.ids.includes(c.id)).map((c: Coin) => c.v), L.target, L.rate);
    expect(o.change).toBe(0);
    await expect(page.getByTestId('dust-note')).toContainText(`Change would have been ${fmt(o.dust!)} sats, below the 294-sat dust limit`);
    await expect(page.getByTestId('equation')).toHaveText(`${fmt(o.total)} − ${fmt(L.target)} − 0 = ${fmt(o.fee!)} sats fee`);
  });

  test('the algorithms: largest-first, branch-and-bound and the exhaustive optimum agree with independent checks', async ({ page }) => {
    await page.goto(URL);
    for (const k of [0, 1, 4]) {
      await page.getByTestId(`level-${k + 1}`).click();
      const L = await level(page);
      const r = await page.evaluate(() => { const u = (window as any).__utxo; return { lf: u.largestFirst(), bnb: u.bnb(), opt: u.optimum() }; });
      const val = (ids: string[]) => L.coins.filter((c: Coin) => ids.includes(c.id)).map((c: Coin) => c.v);
      // largest-first: the k largest coins for the smallest k that funds the payment
      const sorted = [...L.coins].sort((a: Coin, b: Coin) => b.v - a.v);
      let n = 1; while (!oracle(sorted.slice(0, n).map((c: Coin) => c.v), L.target, L.rate).ok) n++;
      expect([...r.lf].sort()).toEqual(sorted.slice(0, n).map((c: Coin) => c.id).sort());
      // the optimum is no worse than anything else, checked by brute force here too
      const optW = oracle(val(r.opt), L.target, L.rate).waste!;
      let best = Infinity;
      for (let m = 1; m < (1 << L.coins.length); m++) { const o = oracle(L.coins.filter((_: Coin, i: number) => m & (1 << i)).map((c: Coin) => c.v), L.target, L.rate); if (o.ok) best = Math.min(best, o.waste!); }
      expect(optW).toBe(best);
      expect(optW).toBeLessThanOrEqual(oracle(val(r.lf), L.target, L.rate).waste!);
      // branch and bound: when it finds something it is changeless
      if (r.bnb) { const o = oracle(val(r.bnb), L.target, L.rate); expect(o.ok).toBe(true); expect(o.change).toBe(0); expect(o.waste!).toBeGreaterThanOrEqual(optW); }
    }
    // levels 2 and 5 have a planted two-coin changeless match, so branch and bound must succeed there
    for (const k of [1, 4]) { await page.getByTestId(`level-${k + 1}`).click(); expect(await page.evaluate(() => (window as any).__utxo.bnb())).not.toBeNull(); }
  });

  test('broadcasting scores against the best possible selection and unlocks the next level', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('level-4').click();
    const opt = await page.evaluate(() => (window as any).__utxo.optimum());
    await pick(page, opt);
    await page.getByTestId('broadcast').click();
    await expect(page.getByTestId('result')).toBeVisible();
    await expect(page.getByTestId('stars')).toHaveAttribute('aria-label', '3 of 3 stars');
    await expect(page.getByTestId('verdict')).toHaveText('Optimal: no selection of these coins wastes less.');
    await expect(page.getByTestId('compare').locator('tbody tr')).toHaveCount(5);
    await expect(page.getByTestId('level-4')).toHaveAttribute('aria-label', 'Level 4, 3 stars');

    // spending every coin at 28 sat/vB is wasteful
    await page.getByTestId('retry').click();
    await expect(page.getByTestId('result')).toBeHidden();
    const L = await level(page);
    await pick(page, L.coins.map((c: Coin) => c.id));
    await page.getByTestId('broadcast').click();
    await expect(page.getByTestId('stars')).toHaveAttribute('aria-label', '1 of 3 stars');
    await expect(page.getByTestId('verdict')).toContainText('sats more waste than the best possible selection');

    await page.getByTestId('next').click();
    await expect(page.getByTestId('level-5')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('rate')).toHaveText('60');
    await expect(page.getByTestId('sel-sum')).toHaveText('Selected: 0 coins · 0 sats');
  });

  test('levels are seeded, and coins work from the keyboard', async ({ page }) => {
    await page.goto(URL);
    const a = await level(page);
    await page.reload();
    expect(await level(page)).toEqual(a);
    await page.goto('/lab/062-utxo-puzzle.html?seed=22');
    expect((await level(page)).coins).not.toEqual(a.coins);
    await expect(page.getByTestId('seed')).toHaveText('#22');
    const first = page.locator('.coin').first();
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-pressed', 'false');
  });
});
