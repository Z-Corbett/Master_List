import { test, expect, Page } from '@playwright/test';

const URL = '/lab/057-snow-cone-stand.html?seed=7';
const stand = (page: Page) => page.evaluate(() => {
  const s = (window as any).__stand.state;
  return { day: s.day, phase: s.phase, cash: s.cash, rep: s.rep, cups: s.cups, syrup: s.syrup, history: s.history };
});
const dollars = (t: string | null) => Number((t || '').replace(/[^0-9.\-−]/g, '').replace('−', '-'));

test.describe('057 Snow Cone Stand', () => {
  test('the forecast is seeded: same seed, same week of weather; a new seed changes it', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('seed')).toHaveText('#7');
    await expect(page.getByTestId('date')).toContainText('Jul 6');
    const high = await page.getByTestId('forecast-high').textContent();
    const detail = await page.getByTestId('forecast-detail').textContent();
    expect(high).toMatch(/^High \d{2,3}°F$/);
    expect(detail).toMatch(/likely \d+–\d+°F · \d+% chance of storms/);
    const season = await page.evaluate(() => (window as any).__stand.state.weather);
    expect(season).toHaveLength(14);
    // the forecast band brackets the forecast centre, and the actual high stays within a plausible Texas range
    for (const d of season) {
      expect(d.actual).toBeGreaterThan(75);
      expect(d.actual).toBeLessThan(115);
      expect(d.rainP).toBeGreaterThanOrEqual(5);
      expect(d.rainP).toBeLessThanOrEqual(75);
    }
    await page.reload();
    await expect(page.getByTestId('forecast-high')).toHaveText(high!);
    expect(await page.evaluate(() => (window as any).__stand.state.weather)).toEqual(season);
    await page.goto('/lab/057-snow-cone-stand.html?seed=8');
    expect(await page.evaluate(() => (window as any).__stand.state.weather)).not.toEqual(season);
  });

  test('the supply run: steppers price the order, syrup puts a flavour on the menu, the cash box caps spending', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('open')).toBeEnabled();
    // offering a flavour without syrup is refused
    await page.getByTestId('offer-pickle').click();
    await expect(page.getByTestId('offer-pickle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('hint')).toContainText('Buy a bottle first');

    await page.getByTestId('ice-plus').click();
    await page.getByTestId('ice-plus').click();
    await expect(page.getByTestId('ice-qty')).toHaveText('2');
    await expect(page.getByTestId('order-total')).toHaveText('$6.00');
    await page.getByTestId('cups-plus').click();
    await expect(page.getByTestId('cups-have')).toHaveText('50');
    await page.getByTestId('syrup-blue-plus').click();
    await expect(page.getByTestId('syrup-blue')).toHaveText('25');
    await expect(page.getByTestId('offer-blue')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('order-total')).toHaveText('$16.00');
    await expect(page.getByTestId('cash-after')).toHaveText('$24.00');
    // taking it off the menu and back on
    await page.getByTestId('offer-blue').click();
    await expect(page.getByTestId('offer-blue')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('offer-blue').click();
    await expect(page.getByTestId('offer-blue')).toHaveText('On menu');

    // $40 cannot buy 10 more bags of ice on top of that
    for (let i = 0; i < 10; i++) await page.getByTestId('ice-plus').click();
    await expect(page.getByTestId('order-total')).toHaveText('$46.00');
    await expect(page.getByTestId('cash-after')).toHaveText('−$6.00');
    await expect(page.getByTestId('open')).toBeDisabled();
    await page.getByTestId('ice-minus').click();
    await page.getByTestId('ice-minus').click();
    await expect(page.getByTestId('open')).toBeEnabled();

    await page.getByTestId('price').fill('4.25');
    await expect(page.getByTestId('price-out')).toHaveText('$4.25');
  });

  test('a day at the stand balances: revenue = cones × price, profit = revenue − supplies, cash and books update', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    for (let i = 0; i < 4; i++) await page.getByTestId('ice-plus').click();
    await page.getByTestId('cups-plus').click();
    await page.getByTestId('syrup-tiger-plus').click();
    await page.getByTestId('syrup-cherry-plus').click();
    await page.getByTestId('price').fill('3.5');
    await expect(page.getByTestId('order-total')).toHaveText('$28.00');
    await page.getByTestId('open').click();

    const ledger = page.getByTestId('ledger');
    await expect(ledger).toBeVisible();
    await expect(page.getByTestId('morning')).toBeHidden();
    const s = await stand(page);
    const h = s.history[0];
    expect(s.phase).toBe('closed');
    expect(h.sold).toBeGreaterThan(0);
    // cones are limited by 40 lb of ice (0.4 lb each), 50 cups and 50 servings of syrup
    expect(h.sold).toBeLessThanOrEqual(50);
    const revenue = dollars(await page.getByTestId('revenue').textContent());
    const profit = dollars(await page.getByTestId('profit').textContent());
    expect(revenue).toBeCloseTo(h.sold * 3.5, 2);
    expect(profit).toBeCloseTo(revenue - 28, 2);
    expect(s.cash).toBeCloseTo(40 - 28 + revenue, 2);
    await expect(page.getByTestId('cash')).toHaveText(`$${s.cash.toFixed(2)}`);
    expect(s.cups).toBe(50 - h.sold);
    expect(s.syrup.tiger + s.syrup.cherry).toBe(50 - h.sold);
    // ice that was not sold melted
    expect(h.melt).toBeCloseTo(40 - h.sold * 0.4, 5);
    await expect(page.getByTestId('melt')).toContainText('of ice');
    await expect(page.getByTestId('ledger-note')).toContainText(`${h.sold} bought a cone`);
    await expect(page.getByTestId('history').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('chart')).toHaveAttribute('aria-label', /1 days, running total/);

    await page.getByTestId('next').click();
    await expect(page.getByTestId('day')).toHaveText('2 / 14');
    await expect(page.getByTestId('date')).toContainText('Jul 7');
    // cups and syrup carry over; ice does not
    await expect(page.getByTestId('cups-have')).toHaveText(String(50 - h.sold));
    await expect(page.getByTestId('ice-qty')).toHaveText('0');
  });

  test('the animated day can be skipped, and the tally ticks while customers arrive', async ({ page }) => {
    await page.goto(URL);
    await page.evaluate(() => (window as any).__stand.order({ ice: 5, cups: 1, syrup: { blue: 1, tiger: 1 }, flavours: ['blue', 'tiger'], price: 3 }));
    await page.getByTestId('open').click();
    await expect(page.getByTestId('skip')).toBeVisible();
    await expect(page.getByTestId('tally')).toContainText(/\d+:\d\d (AM|PM) · sold \d+ · walked \d+/);
    await expect(page.getByTestId('open')).toBeDisabled();
    await page.getByTestId('skip').click();
    await expect(page.getByTestId('ledger')).toBeVisible();
    await expect(page.getByTestId('skip')).toBeHidden();
  });

  test('price, stock and reputation drive demand; the same choices replay identically', async ({ page }) => {
    await page.goto(URL);
    const sim = (o: any) => page.evaluate((o) => { const s = (window as any).__stand; s.order(o); return s.simulate(); }, o);
    const base = { ice: 8, cups: 2, syrup: { tiger: 2, blue: 2 }, flavours: ['tiger', 'blue'] };
    const cheap = await sim({ ...base, price: 2 });
    const pricey = await sim({ ...base, price: 6 });
    expect(pricey.walked).toBeGreaterThan(cheap.walked);
    expect(pricey.sold).toBeLessThan(cheap.sold);
    expect(pricey.potential).toBe(cheap.potential); // price changes who buys, not who shows up
    // a thin menu draws a smaller crowd than a broader one
    const one = await sim({ ...base, flavours: ['tiger'], price: 3 });
    const two = await sim({ ...base, price: 3 });
    expect(one.potential).toBeLessThan(two.potential);
    // determinism
    expect(await sim({ ...base, price: 3 })).toEqual(two);

    // running out of ice turns people away and costs reputation
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => (window as any).__stand.order({ ice: 1, cups: 2, syrup: { tiger: 2, blue: 2 }, flavours: ['tiger', 'blue'], price: 3 }));
    await page.getByTestId('open').click();
    await expect(page.getByTestId('ledger-note')).toContainText('out of ice');
    const s = await stand(page);
    expect(s.history[0].sold).toBeLessThanOrEqual(25);
    expect(s.rep).toBeLessThan(two.repAfter - 5);
    await expect(page.getByTestId('rep')).toHaveText(String(s.rep));
  });

  test('a full fourteen-day season ends with a total and a grade', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await page.evaluate(() => {
      const s = (window as any).__stand;
      for (let d = 0; d < 14; d++) {
        const st = s.state;
        s.order({ ice: Math.min(8, Math.floor(st.cash / 6)), cups: st.cups < 60 ? 1 : 0, syrup: { tiger: st.syrup.tiger < 30 ? 1 : 0, blue: st.syrup.blue < 30 ? 1 : 0 }, flavours: ['tiger', 'blue'], price: 3.5 });
        s.open();
        if (d < 13) s.next();
      }
    });
    await expect(page.getByTestId('next')).toHaveText('Close the season');
    await page.getByTestId('next').click();
    await expect(page.getByTestId('final')).toBeVisible();
    const s = await stand(page);
    expect(s.phase).toBe('done');
    expect(s.history).toHaveLength(14);
    const sum = s.history.reduce((a: number, h: any) => a + h.profit, 0);
    expect(dollars(await page.getByTestId('final-profit').textContent())).toBeCloseTo(sum, 1);
    await expect(page.getByTestId('grade')).not.toBeEmpty();
    await expect(page.getByTestId('history').locator('tbody tr')).toHaveCount(14);
  });
});
