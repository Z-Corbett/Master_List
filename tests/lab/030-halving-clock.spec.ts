import { test, expect, Page } from '@playwright/test';

const URL = '/lab/030-halving-clock.html';

async function lookup(page: Page, h: string) {
  await page.getByTestId('height-input').fill(h);
  await page.getByTestId('go').click();
}

test.describe('030 Halving Clock', () => {
  test('maximum supply matches an independent BigInt oracle: 20,999,999.9769 BTC', async ({ page }) => {
    await page.goto(URL);
    // Oracle: 50 BTC in sats, right-shifted each 210,000-block epoch until it reaches zero.
    let total = 0n, epochs = 0;
    for (let s = 5_000_000_000n; s > 0n; s >>= 1n) { total += s * 210_000n; epochs++; }
    expect(total).toBe(2_099_999_997_690_000n);
    await expect(page.getByTestId('max-supply')).toHaveText('20,999,999.9769');
    await expect(page.getByTestId('epoch-count')).toHaveText(String(epochs));
    await expect(page.getByTestId('last-block')).toHaveText('6,929,999');
    expect(await page.evaluate(() => (window as any).__halving.max)).toBe(String(total));
  });

  test('block lookup gives subsidy, epoch and cumulative supply at the boundaries', async ({ page }) => {
    await page.goto(URL);
    const cases: Array<[string, string, string, string]> = [
      // height, subsidy, epoch, supply after block (sats)
      ['0', '50 BTC', '0', String(5_000_000_000n)],
      ['209999', '50 BTC', '0', String(210_000n * 5_000_000_000n)],
      ['210000', '25 BTC', '1', String(210_000n * 5_000_000_000n + 2_500_000_000n)],
      ['840000', '3.125 BTC', '4', String(1_968_750_000_000_000n + 312_500_000n)],
      ['1,050,000', '1.5625 BTC', '5', String(2_034_375_000_000_000n + 156_250_000n)],
      ['6929999', '0.00000001 BTC', '32', '2099999997690000'],
      ['6930000', '0 BTC', '33', '2099999997690000']
    ];
    for (const [h, sub, ep, sup] of cases) {
      await lookup(page, h);
      await expect(page.getByTestId('r-subsidy')).toHaveText(sub);
      await expect(page.getByTestId('r-epoch')).toHaveText(ep);
      await expect(page.getByTestId('r-supply')).toHaveAttribute('data-sats', sup);
    }
    await expect(page.getByTestId('r-next')).toHaveText('none');
    await expect(page.getByTestId('r-remaining')).toHaveText('0');
    await lookup(page, '839999');
    await expect(page.getByTestId('r-supply')).toHaveText('19,687,500 BTC');
  });

  test('epoch table shows truncation, 34 rows, and marks future dates as estimates', async ({ page }) => {
    await page.goto(URL);
    const rows = page.getByTestId('epoch-row');
    await expect(rows).toHaveCount(34);
    const ep10 = page.locator('[data-testid="epoch-row"][data-epoch="10"] td');
    await expect(ep10.nth(2)).toHaveText('0.04882812');
    await expect(ep10.nth(2)).toHaveClass(/trunc/); // 9,765,625 sats halved and rounded down
    await expect(page.locator('[data-testid="epoch-row"][data-epoch="9"] td').nth(2)).not.toHaveClass(/trunc/);
    await expect(page.locator('[data-testid="epoch-row"][data-epoch="4"] td').last()).toHaveText('20 Apr 2024');
    await expect(page.locator('[data-testid="epoch-row"][data-epoch="1"] td').last()).toHaveText('28 Nov 2012');
    await expect(page.locator('[data-testid="epoch-row"][data-epoch="5"] td').last()).toContainText('(est.)');

    await lookup(page, '700000');
    await expect(page.getByTestId('r-date')).toHaveText('20 Apr 2024');
    await expect(page.getByTestId('r-date')).toHaveAttribute('data-estimate', 'false');
    await lookup(page, '840000');
    await expect(page.getByTestId('r-date')).toHaveText('~Apr 2028');
    await expect(page.getByTestId('r-date')).toHaveAttribute('data-estimate', 'true');
    await expect(page.locator('tr.cur')).toHaveAttribute('data-epoch', '4');
  });

  test('"now" is estimated from the clock at ten minutes per block', async ({ page }) => {
    const now = new Date('2026-09-23T12:00:00Z');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(new Date(now.getTime() + 1000));
    await page.goto(URL);
    const anchor = Date.UTC(2024, 3, 20, 0, 9, 27);
    const expected = 840000 + Math.floor((now.getTime() + 1000 - anchor) / 600000);
    expect(Number(await page.evaluate(() => (window as any).__halving.nowHeight))).toBe(expected);
    await expect(page.getByTestId('height-input')).toHaveValue(expected.toLocaleString('en-US'));
    await expect(page.getByTestId('dial')).toHaveAttribute('data-epoch', '4');
    await expect(page.getByTestId('dial-caption')).toContainText('(estimated now)');
    await page.getByTestId('quick-next-halving').click();
    await expect(page.getByTestId('height-input')).toHaveValue('1,050,000');
    await expect(page.getByTestId('dial')).toHaveAttribute('data-progress', '0.0000');
  });

  test('bad input is rejected; charts switch scale and can be clicked to jump', async ({ page }) => {
    await page.goto(URL);
    await lookup(page, '12abc');
    await expect(page.getByTestId('height-error')).toContainText('whole block height');
    await lookup(page, '420000');
    await expect(page.getByTestId('height-error')).toHaveText('');
    await expect(page.getByTestId('r-subsidy')).toHaveText('12.5 BTC');

    await page.getByTestId('scale-log').click();
    await expect(page.getByTestId('subsidy-chart')).toHaveAttribute('data-scale', 'log');
    await expect(page.getByTestId('subsidy-chart').getByTestId('chart-marker')).toHaveCount(1);

    // Click near the far right of the supply chart: well past the last subsidy block
    const box = (await page.getByTestId('supply-chart').boundingBox())!;
    await page.getByTestId('supply-chart').click({ position: { x: box.width * 0.97, y: box.height / 2 } });
    await expect(page.getByTestId('r-subsidy')).toHaveText('0 BTC');
    await expect(page.getByTestId('r-supply')).toHaveText('20,999,999.9769 BTC');
  });
});
