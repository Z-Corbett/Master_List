import { test, expect, Page } from '@playwright/test';

const URL = '/lab/094-difficulty-retarget.html';
const EXPECTED = 2016 * 600;
const epochs = (page: Page) => page.evaluate(() => (window as any).__retarget.epochsSummary());

test.describe('094 Difficulty Retarget', () => {
  test('one retarget by hand: expected ÷ actual, clamped to 4× either way', async ({ page }) => {
    await page.goto(URL);
    const days = page.getByTestId('calc-days'), change = page.getByTestId('calc-change'), detail = page.getByTestId('calc-detail');
    await expect(change).toHaveText('+16.67%');                        // 12 days: 14/12
    await days.fill('14');
    await expect(change).toHaveText('No change');
    await days.fill('10');
    await expect(change).toHaveText('+40.00%');
    await days.fill('28');
    await expect(change).toHaveText('−50.00%');
    await expect(detail).toContainText('Difficulty 1 × (14 ÷ 28) = 0.5');
    await days.fill('2');
    await expect(change).toHaveText('+300.00%CLAMPED');
    await expect(detail).toContainText('counts as 3.5 days');
    await days.fill('70');
    await expect(change).toHaveText('−75.00%CLAMPED');
    await page.getByTestId('calc-diff').fill('8');
    await expect(detail).toContainText('Difficulty 8 × (14 ÷ 56) = 2.');
    await days.fill('0');
    await expect(page.getByTestId('calc-out')).toContainText('Enter a positive number');
  });

  test('with luck off, steady hashrate settles at 600 × 2016/2015 s; the fix settles at 600 s', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('scen-steady').click();
    await expect(page.getByTestId('scen-steady')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('luck').uncheck();
    let e = await epochs(page);
    expect(e[0].meanInterval).toBeCloseTo(600, 9);
    expect(e[0].measuredIntervals).toBe(2015);
    expect(e[0].factor).toBeCloseTo(2016 / 2015, 12);                  // 2015 intervals of 600 s look slightly fast
    for (const ep of e.slice(1)) expect(ep.meanInterval).toBeCloseTo(600 * 2016 / 2015, 6);
    await expect(page.getByTestId('stat-last')).toHaveText('600.3 s');
    const rows = page.getByTestId('epoch-row');
    await expect(rows).toHaveCount(12);
    await expect(rows.nth(0)).toContainText('2015 int.');
    // the hypothetical fix measures 2016 intervals and holds exactly 600 s
    await page.getByTestId('fix').check();
    e = await epochs(page);
    expect(e[0].measuredIntervals).toBe(2016);
    for (const ep of e) expect(ep.meanInterval).toBeCloseTo(600, 6);
    for (const ep of e.slice(0, -1)) expect(ep.factor).toBeCloseTo(1, 12);
    await expect(page.getByTestId('stat-last')).toHaveText('600.0 s');
    await expect(rows.nth(0)).toContainText('2016 int.');
  });

  test('every simulated retarget obeys the rule, recomputed from block timestamps', async ({ page }) => {
    await page.goto(URL);
    for (const scen of ['steady', 'growth', 'drop', 'rapid', 'crash']) {
      await page.getByTestId(`scen-${scen}`).click();
      const check = await page.evaluate(() => {
        const r = (window as any).__retarget, res = r.result, bad: string[] = [];
        for (let i = 0; i < res.epochs.length - 1; i++) {
          const ep = res.epochs[i], next = res.epochs[i + 1];
          const actual = res.time[ep.end] - res.time[ep.start];                 // first to last block: 2015 intervals
          const clamped = Math.min(Math.max(actual, r.EXPECTED / 4), r.EXPECTED * 4);
          const want = ep.difficulty * r.EXPECTED / clamped;
          if (Math.abs(next.difficulty - want) > 1e-9 * want) bad.push(`epoch ${ep.n}`);
          if (next.start !== ep.end + 1 || ep.end - ep.start + 1 !== 2016) bad.push(`heights ${ep.n}`);
        }
        return { bad, n: res.epochs.length };
      });
      expect(check.bad, scen).toEqual([]);
      expect(check.n).toBe(12);
    }
    expect(EXPECTED).toBe(1209600);
  });

  test('scenarios: a 50% drop slows blocks then difficulty falls; a 90% crash hits the clamp', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('scen-drop')).toHaveAttribute('aria-checked', 'true');
    let e = await epochs(page);
    expect(e[1].meanInterval).toBeGreaterThan(800);        // mined partly at half hashrate
    expect(e[1].factor).toBeLessThan(0.8);
    expect(e[e.length - 1].difficulty).toBeGreaterThan(0.4);
    expect(e[e.length - 1].difficulty).toBeLessThan(0.6);   // recovered to about half
    await expect(page.getByTestId('scen-desc')).toContainText('day 21');
    // seeded: same seed, same epochs; another seed differs
    const again = await page.evaluate(() => (window as any).__retarget.simulate({ scen: 'drop', epochs: 12, seed: 21, luck: true, fix: false }).epochs.map((x: any) => x.difficulty));
    expect(again).toEqual(e.map((x: any) => x.difficulty));
    await page.getByTestId('seed').fill('22');
    await page.getByTestId('seed').press('Enter');
    await page.getByTestId('seed').blur();
    await expect.poll(async () => (await epochs(page))[1].difficulty).not.toBe(e[1].difficulty);
    // crash
    await page.getByTestId('scen-crash').click();
    e = await epochs(page);
    expect(e[1].clamped).toBe(true);
    expect(e[1].factor).toBe(0.25);
    expect(e[1].actualSpan).toBeGreaterThan(EXPECTED * 4);
    await expect(page.getByTestId('epoch-row').nth(1)).toContainText('CLAMPED');
    await expect(page.getByTestId('status')).toContainText('1 clamped retarget');
    // rapid growth: every retarget raises difficulty and epochs end early
    await page.getByTestId('scen-rapid').click();
    e = await epochs(page);
    for (const ep of e.slice(0, -1)) { expect(ep.factor).toBeGreaterThan(1); expect(ep.actualSpan).toBeLessThan(EXPECTED); }
    // keyboard: arrows move through the scenarios
    await page.getByTestId('scen-rapid').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('scen-crash')).toBeFocused();
    await expect(page.getByTestId('scen-crash')).toHaveAttribute('aria-checked', 'true');
  });

  test('charts: hover or arrow keys show one tooltip for every series', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await page.getByTestId('epochs').fill('20');
    await page.getByTestId('epochs').press('Enter');
    await page.getByTestId('epochs').blur();
    await expect(page.getByTestId('epoch-row')).toHaveCount(20);
    const chart = page.getByTestId('chart-interval');
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const tip = page.getByTestId('tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/Day \d+\.\d · block [\d,]+/);
    await expect(tip).toContainText('mean interval');
    await expect(tip).toContainText('hashrate');
    await expect(tip).toContainText('difficulty');
    await page.mouse.move(box.x + box.width * 0.5, box.y - 80);
    await expect(tip).toBeHidden();
    await chart.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Day 0.');
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await expect(page.getByTestId('chart-diff')).toHaveAttribute('aria-label', /final difficulty 0\.\d+ times the start/);
  });
});
