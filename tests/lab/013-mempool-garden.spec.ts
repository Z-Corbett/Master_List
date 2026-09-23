import { test, expect } from '@playwright/test';

const URL = '/lab/013-mempool-garden.html';

type Tx = { id: number; vsize: number; feeRate: number; fee: number };

// Independent oracle: greedy fee-rate packing, written separately from the page.
function greedy(pool: Tx[], limit: number): number[] {
  const sorted = [...pool].sort((a, b) => b.feeRate - a.feeRate || a.id - b.id);
  const out: number[] = [];
  let used = 0;
  for (const tx of sorted) {
    if (used + tx.vsize <= limit) { out.push(tx.id); used += tx.vsize; }
    if (limit - used < 140) break;
  }
  return out;
}

test.describe('Mempool Garden', () => {
  test('same ?seed= produces the same simulated mempool, a different seed does not', async ({ page }) => {
    const snapshot = async (seed: number) => {
      await page.goto(`${URL}?seed=${seed}`);
      await expect(page.getByTestId('sim-badge')).toContainText(/simulation/i);
      return page.evaluate(() => (window as any).__mempool.pool.filter((t: Tx) => t.id <= 50));
    };
    const a = await snapshot(42);
    const b = await snapshot(42);
    const c = await snapshot(43);
    expect(a).toHaveLength(50);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
    for (const tx of a) {
      expect(tx.feeRate).toBeGreaterThanOrEqual(1);
      expect(tx.fee).toBe(Math.round(tx.vsize * tx.feeRate));
    }
  });

  test('"Mine block now" greedily packs the highest fee-rate transactions under the limit', async ({ page }) => {
    await page.goto(`${URL}?seed=7`);
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-pressed', 'false');

    const { pool, limit } = await page.evaluate(() => ({ pool: (window as any).__mempool.pool, limit: (window as any).__mempool.limit }));
    const expected = greedy(pool, limit);

    await page.getByTestId('mine-now').click();
    const blocks = await page.evaluate(() => (window as any).__mempool.blocks);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.txIds).toEqual(expected);
    expect(block.vsize).toBeLessThanOrEqual(limit);

    // every tx left behind pays no more than the block's cheapest inclusion, or would not have fit
    const after: Tx[] = await page.evaluate(() => (window as any).__mempool.pool);
    const included = new Set<number>(block.txIds);
    expect(after.some(t => included.has(t.id))).toBe(false);
    for (const t of after) {
      if (t.feeRate > block.minRate) expect(block.vsize + t.vsize).toBeGreaterThan(limit);
    }

    const card = page.getByTestId('block').first();
    await expect(card).toContainText('#1');
    await expect(card).toContainText(`${block.count} tx`);
    await expect(page.getByTestId('announcer')).toContainText('Block 1 mined');
  });

  test('blocks are mined automatically on the simulated schedule (fake clock)', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 0, 3, 9, 0) });
    await page.clock.pauseAt(new Date(2026, 0, 3, 9, 0, 1));
    await page.goto(`${URL}?seed=11`);
    await page.getByTestId('speed').selectOption('5'); // 10 sim-minutes = 5 real seconds
    await page.clock.runFor(1000);
    const before = await page.evaluate(() => (window as any).__mempool.blocks.length);
    expect(before).toBe(0);
    // Block gaps are 6-14 sim-minutes, so jumping 20 real seconds at this speed must yield at least one block.
    await page.clock.fastForward(20_000);
    await page.clock.runFor(100);
    const blocks = await page.evaluate(() => (window as any).__mempool.blocks);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0].reason).toBe('auto');
    await expect(page.getByTestId('block')).toHaveCount(blocks.length);
    await expect(page.getByTestId('countdown')).toHaveText(/^\d\d:\d\d$/);
  });

  test('pausing freezes simulated time and arrivals', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 0, 3, 9, 0) });
    await page.clock.pauseAt(new Date(2026, 0, 3, 9, 0, 1));
    await page.goto(`${URL}?seed=5`);
    await page.clock.runFor(500);
    await page.getByTestId('play-toggle').click();
    const frozen = await page.evaluate(() => ({ t: (window as any).__mempool.simTime, n: (window as any).__mempool.pool.length }));
    await page.clock.fastForward(10_000);
    await page.clock.runFor(100);
    const later = await page.evaluate(() => ({ t: (window as any).__mempool.simTime, n: (window as any).__mempool.pool.length }));
    expect(later).toEqual(frozen);
    await page.getByTestId('play-toggle').click();
    await page.clock.fastForward(4000);
    await page.clock.runFor(100);
    expect(await page.evaluate(() => (window as any).__mempool.simTime)).toBeGreaterThan(frozen.t);
  });

  test('a fee spike raises the next-block minimum fee and fills the top histogram buckets', async ({ page }) => {
    await page.goto(`${URL}?seed=21`);
    await page.getByTestId('play-toggle').click();
    const minBefore = Number(await page.getByTestId('est-min').getAttribute('data-value'));
    const topBefore = Number(await page.getByTestId('hist-bar').last().getAttribute('data-in'))
      + Number(await page.getByTestId('hist-bar').last().getAttribute('data-out'));

    await page.getByTestId('fee-spike').click();
    await expect(page.getByTestId('announcer')).toContainText('Fee spike');
    await expect(page.getByTestId('hist-bar')).toHaveCount(11);

    const minAfter = Number(await page.getByTestId('est-min').getAttribute('data-value'));
    expect(minAfter).toBeGreaterThan(minBefore);
    const tplMin = await page.evaluate(() => {
      const m = (window as any).__mempool;
      const ids = new Set(m.template());
      return Math.min(...m.pool.filter((t: Tx) => ids.has(t.id)).map((t: Tx) => t.feeRate));
    });
    expect(minAfter).toBe(tplMin);
    const top = page.getByTestId('hist-bar').last();
    const topAfter = Number(await top.getAttribute('data-in')) + Number(await top.getAttribute('data-out'));
    expect(topAfter).toBeGreaterThan(topBefore);
  });
});
