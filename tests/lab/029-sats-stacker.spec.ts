import { test, expect, Page } from '@playwright/test';

const URL = '/lab/029-sats-stacker.html';
const SATS = 100_000_000;
const num = (s: string | null) => Number((s || '').replace(/[^0-9.\-]/g, ''));

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__sats;
    return { prices: s.prices as number[], buys: s.buys as number[], dca: s.dcaValue as number[], lump: s.lumpValue as number[], state: { ...s.state } };
  });
}

test.describe('029 Sats Stacker', () => {
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); });

  test('clearly labelled simulation; the same seed replays the same fictional market', async ({ page }) => {
    await page.goto(`${URL}?seed=77`);
    await expect(page.getByTestId('sim-badge')).toContainText('Simulation only');
    await expect(page.getByTestId('sim-badge')).toContainText('Nothing here is financial advice');
    const a = await snapshot(page);
    expect(a.prices[0]).toBe(30000);
    expect(a.prices).toHaveLength(4 * 365);
    await page.reload();
    const b = await snapshot(page);
    expect(b.prices).toEqual(a.prices);
    await page.getByTestId('seed').fill('78');
    await page.getByTestId('seed').press('Enter');
    const c = await snapshot(page);
    expect(c.prices).not.toEqual(a.prices);
  });

  test('sats stacked match an independent whole-satoshi oracle for both strategies', async ({ page }) => {
    await page.goto(`${URL}?seed=21`);
    const { prices, buys, state } = await snapshot(page);
    let dcaSats = 0;
    for (const d of buys) dcaSats += Math.floor(state.amount / prices[d] * SATS);
    const total = state.amount * buys.length;
    const lumpSats = Math.floor(total / prices[0] * SATS);
    await expect(page.getByTestId('dca-sats').locator('span')).toHaveAttribute('data-value', String(dcaSats));
    await expect(page.getByTestId('lump-sats').locator('span')).toHaveAttribute('data-value', String(lumpSats));
    await expect(page.getByTestId('sats-live')).toHaveAttribute('data-value', String(dcaSats));
    expect(num(await page.getByTestId('dca-invested').textContent())).toBe(total);
    expect(num(await page.getByTestId('lump-invested').textContent())).toBe(total);
    // avg cost = invested / BTC held
    expect(num(await page.getByTestId('dca-avg').textContent())).toBe(Math.round(total / (dcaSats / SATS)));
  });

  test('frequency and duration set the buy schedule and money invested', async ({ page }) => {
    await page.goto(`${URL}?seed=5`);
    await page.getByTestId('dur-1y').click();
    await page.getByTestId('amount').fill('250');
    await page.getByTestId('amount').press('Enter');
    await expect(page.getByTestId('dca-invested')).toHaveText('$13,250'); // 53 weekly buys in 365 days
    expect((await snapshot(page)).buys).toHaveLength(53);
    await page.getByTestId('frequency').selectOption('30');
    await expect(page.getByTestId('dca-invested')).toHaveText('$3,250');  // 13 buys: days 0, 30 … 360
    await page.getByTestId('frequency').selectOption('1');
    await expect(page.getByTestId('dca-invested')).toHaveText('$91,250'); // daily
    await expect(page.getByTestId('lump-invested')).toHaveText('$91,250');
    await page.getByTestId('dur-8y').click();
    expect((await snapshot(page)).prices).toHaveLength(8 * 365);
  });

  test('drawdowns and the winner agree with values recomputed from the series', async ({ page }) => {
    await page.goto(`${URL}?seed=314`);
    for (const trend of ['-0.25', '0.35']) {
      await page.getByTestId('trend').selectOption(trend);
      const { dca, lump } = await snapshot(page);
      const mdd = (v: number[]) => { let peak = -Infinity, dd = 0; for (const x of v) { peak = Math.max(peak, x); dd = Math.max(dd, (peak - x) / peak); } return dd; };
      const got = Number(await page.getByTestId('dca-dd').locator('span').getAttribute('data-value'));
      expect(got).toBeCloseTo(mdd(dca), 5);
      const gotL = Number(await page.getByTestId('lump-dd').locator('span').getAttribute('data-value'));
      expect(gotL).toBeCloseTo(mdd(lump), 5);
      const winner = dca[dca.length - 1] > lump[lump.length - 1] ? 'stacking (DCA)' : 'the lump sum';
      await expect(page.getByTestId('winner')).toHaveText(winner);
    }
  });

  test('the chart animates on the fake clock and can be scrubbed by keyboard', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.clock.install({ time: new Date('2026-09-23T12:00:00') });
    await page.clock.pauseAt(new Date('2026-09-23T12:00:01'));
    await page.goto(`${URL}?seed=9`);
    await page.clock.runFor(500);
    const mid = Number(await page.getByTestId('chart').getAttribute('data-progress'));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    await page.clock.runFor(3000);
    await expect(page.getByTestId('chart')).toHaveAttribute('data-progress', '1.000');
    await expect(page.getByTestId('progress-day')).toHaveText('Day 1460 of 1460');

    const { prices } = await snapshot(page);
    await page.getByTestId('chart').focus();
    await page.keyboard.press('End');
    await expect(page.getByTestId('readout-day')).toHaveText('1460');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('readout-day')).toHaveText('1459');
    await page.keyboard.press('Home');
    await expect(page.getByTestId('readout-day')).toHaveText('1');
    await expect(page.getByTestId('readout-price')).toHaveText('$30,000.00');
    expect(prices[0]).toBe(30000);
  });
});
