import { test, expect, Page } from '@playwright/test';

const URL = '/lab/046-lightning-lab.html?seed=1';
const ln = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const L = window.__ln; return ${fn}; })()`) as Promise<T>;

test.describe('046 Lightning Lab', () => {
  test('pathfinding returns the cheapest capacity-feasible route (brute-force oracle)', async ({ page }) => {
    await page.goto(URL);
    const chans = await ln<any[]>(page, 'L.channels()');
    const nodes = await ln<string[]>(page, 'L.nodes');
    const fee = (p: { base: number; ppm: number }, amt: number) => p.base + Math.ceil((amt * p.ppm) / 1e6);
    // independent oracle: enumerate every simple path, price it from the receiver backwards
    function cheapest(from: string, to: string, amt: number): number | null {
      let best: number | null = null;
      const walk = (u: string, seen: Set<string>, path: any[]) => {
        if (u === to) {
          let need = amt;
          for (let k = path.length - 1; k >= 0; k--) {
            const { c, from: f } = path[k];
            if (need > c.cap) return;
            if (k > 0) need += fee(c.fee[f], need);
          }
          if (best === null || need < best) best = need;
          return;
        }
        for (const c of chans) {
          if (c.a !== u && c.b !== u) continue;
          const v = c.a === u ? c.b : c.a;
          if (seen.has(v)) continue;
          seen.add(v); path.push({ c, from: u }); walk(v, seen, path); path.pop(); seen.delete(v);
        }
      };
      walk(from, new Set([from]), []);
      return best;
    }
    const pairs: Array<[string, string, number]> = [];
    for (const a of nodes) for (const b of nodes) if (a !== b) for (const amt of [10_000, 250_000, 650_000]) pairs.push([a, b, amt]);
    const routes = await page.evaluate((ps) => ps.map(([a, b, amt]) => (window as any).__ln.findRoute(a, b, amt)), pairs);
    let checked = 0;
    pairs.forEach(([a, b, amt], i) => {
      const expected = cheapest(a, b, amt);
      const r = routes[i];
      if (expected === null) { expect(r, `${a}→${b} ${amt}`).toBeNull(); return; }
      expect(r, `${a}→${b} ${amt}`).not.toBeNull();
      expect(r.total, `${a}→${b} ${amt}`).toBe(expected);
      // hop amounts and per-hop fees are consistent with each forwarding node's policy
      expect(r.hops[r.hops.length - 1].amt).toBe(amt);
      for (let k = 1; k < r.hops.length; k++) {
        const h = r.hops[k], c = chans[h.chan];
        expect(r.hops[k - 1].amt - h.amt).toBe(fee(c.fee[h.from], h.amt));
        expect(h.amt).toBeLessThanOrEqual(c.cap);
      }
      checked++;
    });
    expect(pairs).toHaveLength(270);
    expect(checked).toBeGreaterThan(150); // the rest are correctly reported as unroutable
  });

  test('a payment routes, retries around a short hop, and shifts balances exactly', async ({ page }) => {
    await page.goto(URL);
    const before = await ln<any[]>(page, 'L.channels()');
    const tot = (id: string) => ln<number>(page, `L.nodeTotal('${id}')`);
    const bs0 = await tot('BS'), mu0 = await tot('MU');
    await page.getByTestId('from').selectOption('BS');
    await page.getByTestId('to').selectOption('MU');
    await page.getByTestId('amount').fill('50000');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('result-head')).toHaveText('Paid 50,000 sats');
    const attempts = page.getByTestId('attempts').locator('li');
    await expect(attempts).toHaveCount(2);
    await expect(attempts.nth(0)).toContainText('failed at Hyde Park → East Sixth');
    await expect(attempts.nth(0)).toContainText('temporary channel failure');
    await expect(attempts.nth(1)).toContainText('settled via BS → SC → LB → HP → MU');
    await expect(page.getByTestId('count-ok')).toHaveText('1');

    const stats = await ln<any>(page, 'L.stats');
    const after = await ln<any[]>(page, 'L.channels()');
    // every channel keeps its capacity; sats only move between its two sides
    after.forEach((c) => expect(c.bal[c.a] + c.bal[c.b]).toBe(c.cap));
    expect(await tot('BS')).toBe(bs0 - 50_000 - stats.fees);
    expect(await tot('MU')).toBe(mu0 + 50_000);
    const earned = Object.values(stats.earned as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(earned).toBe(stats.fees);
    await expect(page.getByTestId('fees-total')).toHaveText(String(stats.fees));
    // the channel card for the first hop reflects the new split
    const bsSc = after.find((c) => c.a === 'BS' && c.b === 'SC');
    const bsSc0 = before.find((c) => c.a === 'BS' && c.b === 'SC');
    expect(bsSc.bal.BS).toBe(bsSc0.bal.BS - (50_000 + stats.fees));
    await expect(page.getByTestId('bal-BS-SC-a')).toHaveText(bsSc.bal.BS.toLocaleString('en-US'));
    await expect(page.getByTestId('hop-3')).toContainText('Hyde Park → Mueller');
  });

  test('payments fail on liquidity with a reason, or on capacity with no route, and change nothing', async ({ page }) => {
    await page.goto(URL);
    const snap = await ln<any[]>(page, 'L.channels()');
    await page.getByTestId('from').selectOption('BS');
    await page.getByTestId('to').selectOption('MU');
    await page.getByTestId('amount').fill('400000');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('result-head')).toHaveText('Payment failed');
    await expect(page.getByTestId('attempts')).toContainText('only had 177,000 on its side');
    await expect(page.getByTestId('attempts')).toContainText('No more routes to try');
    await expect(page.getByTestId('fail-mark')).toBeVisible();
    await expect(page.getByTestId('hops').locator('li.fail')).toHaveCount(1);

    await page.getByTestId('amount').fill('2000000');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('result-summary')).toHaveText('No route: no path has enough capacity for 2,000,000 sats.');
    await expect(page.getByTestId('count-fail')).toHaveText('2');
    expect(await ln<any[]>(page, 'L.channels()')).toEqual(snap);

    // same-node payment is rejected by the form
    await page.getByTestId('to').selectOption('BS');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('result-summary')).toHaveText('Pick two different nodes.');
  });

  test('rebalance refills a depleted channel with a circular payment', async ({ page }) => {
    await page.goto(URL);
    const ch = async () => (await ln<any[]>(page, 'L.channels()')).find((c) => c.a === 'HP' && c.b === 'E6');
    const c0 = await ch();
    expect(c0.bal.HP).toBe(50_000);
    const hp0 = await ln<number>(page, "L.nodeTotal('HP')");
    await page.getByTestId('rb-node').selectOption('HP');
    await page.getByTestId('rb-peer').selectOption('E6');
    await page.getByTestId('rb-amount').fill('100000');
    await page.getByTestId('rebalance').click();
    await expect(page.getByTestId('result-head')).toHaveText('Rebalanced 100,000 sats');
    const c1 = await ch();
    expect(c1.bal.HP).toBe(150_000);
    const stats = await ln<any>(page, 'L.stats');
    expect(stats.fees).toBeGreaterThan(0);
    // the node only loses what it paid in routing fees
    expect(await ln<number>(page, "L.nodeTotal('HP')")).toBe(hp0 - stats.fees);
    await expect(page.getByTestId('hops').locator('li').last()).toContainText('East Sixth → Hyde Park');
    await expect(page.getByTestId('hops').locator('li').first()).toContainText('Hyde Park →');
    await expect(page.getByTestId('bal-HP-E6-a')).toHaveText('150,000');

    await page.getByTestId('reset').click();
    await expect(page.getByTestId('bal-HP-E6-a')).toHaveText('50,000');
    await expect(page.getByTestId('count-ok')).toHaveText('0');
  });

  test('the network is seeded and the disclosure says it is a simplified simulation', async ({ page }) => {
    await page.goto(URL);
    const a = await ln<any[]>(page, 'L.channels()');
    await page.goto('/lab/046-lightning-lab.html?seed=2');
    const b = await ln<any[]>(page, 'L.channels()');
    expect(b.map((c) => c.cap)).toEqual(a.map((c) => c.cap));
    expect(b.map((c) => c.bal)).not.toEqual(a.map((c) => c.bal));
    await page.goto(URL);
    expect(await ln<any[]>(page, 'L.channels()')).toEqual(a);
    await expect(page.getByTestId('disclosure')).toContainText('Simplified model');
    await expect(page.getByTestId('disclosure')).toContainText('not the Lightning protocol');
    await expect(page.getByText('Simulation · not real Bitcoin')).toBeVisible();
  });
});
