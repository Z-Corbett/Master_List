import { test, expect, Page } from '@playwright/test';

const URL = '/lab/107-race-splits.html';
const MILE = 1609.344;
const riegel = (t1: number, d1: number, d2: number, k = 1.06) => t1 * (d2 / d1) ** k;
const toSec = (s: string) => s.trim().split(':').map(Number).reduce((a, v) => a * 60 + v, 0);
const fmt = (sec: number) => {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

async function splits(page: Page) {
  const rows = page.getByTestId('split-row');
  const n = await rows.count();
  const out: { split: number; cum: number }[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({ split: toSec((await page.getByTestId(`split-${i}`).textContent())!), cum: toSec((await page.getByTestId(`cum-${i}`).textContent())!) });
  }
  return out;
}
async function goal(page: Page, g: string) {
  await page.getByTestId('goal').fill(g);
  await expect(page.getByTestId('sum-goal')).toHaveText(g);
}

test.describe('107 Race Splits', () => {
  test('Riegel prediction: 5K in 25:00 scaled to a half marathon', async ({ page }) => {
    await page.goto(URL);
    const want = riegel(1500, 5000, 21097.5);                           // ≈ 1:55:14
    await expect(page.getByTestId('predicted')).toHaveText(fmt(want));
    await expect(page.getByTestId('equation')).toContainText('^1.06');
    await expect(page.getByTestId('goal')).toHaveValue(fmt(want));      // goal follows the prediction
    // exponent 1.06 → 1.00 turns it into plain pace scaling: 5:00/km × 21.0975 km
    await page.getByTestId('k').fill('1');
    await expect(page.getByTestId('predicted')).toHaveText(fmt(1500 * 21097.5 / 5000));
    await page.getByTestId('k').fill('1.08');
    await expect(page.getByTestId('predicted')).toHaveText(fmt(riegel(1500, 5000, 21097.5, 1.08)));
  });

  test('other distances: 10K 50:00 to marathon, and a mile to 5K', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('d1').selectOption('10k');
    await page.getByTestId('t1').fill('50:00');
    await page.getByTestId('d2').selectOption('marathon');
    await expect(page.getByTestId('predicted')).toHaveText(fmt(riegel(3000, 10000, 42195)));
    await page.getByTestId('d1').selectOption('mile');
    await page.getByTestId('t1').fill('6:30');
    await page.getByTestId('d2').selectOption('5k');
    await expect(page.getByTestId('predicted')).toHaveText(fmt(riegel(390, MILE, 5000)));
    await page.getByTestId('t1').fill('1:02:03');                       // h:mm:ss parses too
    const L = await page.evaluate(() => (window as any).__splits.last);
    expect(L.t1).toBe(3723);
    expect(L.predicted).toBeCloseTo(riegel(3723, MILE, 5000), 6);
  });

  test('even splits in miles: a half marathon has 13 full miles plus 0.11, summing to the goal', async ({ page }) => {
    await page.goto(URL);
    await goal(page, '1:50:00');
    const s = await splits(page);
    expect(s).toHaveLength(14);
    const sum = s.reduce((a, r) => a + r.split, 0);
    expect(Math.abs(sum - 6600)).toBeLessThanOrEqual(1);
    expect(s[13].cum).toBe(6600);
    const perMile = 6600 / (21097.5 / MILE);                             // 8:23.6 per mile
    for (const r of s.slice(0, 13)) expect(Math.abs(r.split - perMile)).toBeLessThanOrEqual(1);
    expect(Math.abs(s[12].cum - perMile * 13)).toBeLessThanOrEqual(0.5);
    await expect(page.getByTestId('sum-pace')).toHaveText(`${fmt(perMile)}/mi`);
    await expect(page.getByTestId('split-table')).toContainText('14 (0.11)');
    // hook: exact segment times sum to the goal to floating-point precision
    const exact = await page.evaluate(() => (window as any).__splits.last.plan.segs.reduce((a: number, g: any) => a + g.exact, 0));
    expect(Math.abs(exact - 6600)).toBeLessThan(1e-6);
  });

  test('km toggle: 21 full kilometres plus 0.10, pace per km', async ({ page }) => {
    await page.goto(URL);
    await goal(page, '1:45:29');
    await page.getByTestId('unit-km').click();
    await expect(page.getByTestId('unit-km')).toHaveAttribute('aria-pressed', 'true');
    const s = await splits(page);
    expect(s).toHaveLength(22);
    expect(Math.abs(s.reduce((a, r) => a + r.split, 0) - 6329)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('sum-pace')).toHaveText(`${fmt(6329 / 21.0975)}/km`);  // 5:00/km
    await expect(page.getByTestId('sum-pace')).toHaveText('5:00/km');
    await expect(page.getByTestId('split-table')).toContainText('22 (0.10)');
  });

  test('negative split: steadily faster, second half quicker by the chosen share, still the goal', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('d2').selectOption('marathon');
    await goal(page, '4:00:00');
    await page.getByTestId('strat-negative').click();
    await page.getByTestId('strength').fill('4');
    const s = await splits(page);
    expect(s).toHaveLength(27);                                          // 26 miles + 0.22
    expect(Math.abs(s.reduce((a, r) => a + r.split, 0) - 14400)).toBeLessThanOrEqual(1);
    const L = await page.evaluate(() => (window as any).__splits.last.plan);
    // p(x) = avg·(1 + a(1 − 2x/D)) → halves are goal/2·(1 ± a/2)
    expect(L.firstHalf).toBeCloseTo(7200 * 1.02, 6);
    expect(L.secondHalf).toBeCloseTo(7200 * 0.98, 6);
    const paces = L.segs.map((g: any) => g.pace);
    for (let i = 1; i < paces.length; i++) expect(paces[i]).toBeLessThan(paces[i - 1]);
    // each full-mile split vs the test's own integral of the pace line
    const D = 42195, avg = 14400 / D, a = 0.04, T = (x: number) => avg * (x + a * (x - x * x / D));
    for (let i = 0; i < 26; i++) expect(Math.abs(s[i].split - (T((i + 1) * MILE) - T(i * MILE)))).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('sum-halves')).toHaveText(`${fmt(7344)} + ${fmt(7056)}`);
  });

  test('positive split is the mirror image; even disables the strength field', async ({ page }) => {
    await page.goto(URL);
    await goal(page, '1:50:00');
    await page.getByTestId('strat-positive').click();
    await expect(page.getByTestId('strat-positive')).toHaveAttribute('aria-pressed', 'true');
    const L = await page.evaluate(() => (window as any).__splits.last.plan);
    expect(L.firstHalf).toBeCloseTo(3300 * 0.99, 6);                     // default 2 %
    expect(L.secondHalf).toBeCloseTo(3300 * 1.01, 6);
    const s = await splits(page);
    expect(s[12].split).toBeGreaterThan(s[0].split);
    expect(Math.abs(s.reduce((a, r) => a + r.split, 0) - 6600)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('chart')).toHaveAttribute('aria-label', /^positive split plan, 14 splits/);
    await expect(page.getByTestId('strength')).toBeEnabled();
    await page.getByTestId('strat-even').click();
    await expect(page.getByTestId('strength')).toBeDisabled();
  });

  test('splits add up to the goal within a second for many goals, units and strategies', async ({ page }) => {
    await page.goto(URL);
    const results = await page.evaluate(() => {
      const S = (window as any).__splits, out: number[] = [];
      const dists = [5000, 10000, 15000, 21097.5, 42195], units = [1609.344, 1000], strats = ['even', 'negative', 'positive'];
      for (const D of dists) for (const u of units) for (const st of strats) for (let g = 900; g < 20000; g += 977) {
        const P = S.plan(g, D, u, st, 3);
        const sum = P.segs.reduce((a: number, s: any) => a + s.sec, 0);
        out.push(Math.abs(sum - g), Math.abs(P.segs[P.segs.length - 1].cum - g));
      }
      return out;
    });
    expect(results.length).toBeGreaterThan(500);
    for (const r of results) expect(r).toBeLessThanOrEqual(1);
  });

  test('bad input is explained: malformed times, a silly exponent, a blank goal', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('t1').fill('25:75');
    await expect(page.getByTestId('t1-err')).toContainText('h:mm:ss or mm:ss');
    await expect(page.getByTestId('predicted')).toHaveText('--');
    await page.getByTestId('t1').fill('25:00');
    await expect(page.getByTestId('t1-err')).toHaveText('');
    await page.getByTestId('k').fill('0.9');
    await expect(page.getByTestId('t1-err')).toContainText('exponent');
    await page.getByTestId('k').fill('1.06');
    await page.getByTestId('goal').fill('fast');
    await expect(page.getByTestId('goal-err')).toContainText('goal time');
    await page.getByTestId('use-prediction').click();
    await expect(page.getByTestId('goal')).toHaveValue(fmt(riegel(1500, 5000, 21097.5)));
    await expect(page.getByTestId('goal-err')).toHaveText('');
  });

  test('custom distances keep their physical length when the unit changes', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('d2').selectOption('custom');
    await expect(page.getByTestId('d2-custom-wrap')).toBeVisible();
    await page.getByTestId('d2-custom').fill('8');                        // 8 miles
    await expect(page.getByTestId('predicted')).toHaveText(fmt(riegel(1500, 5000, 8 * MILE)));
    await expect(page.getByTestId('split-row')).toHaveCount(8);
    await page.getByTestId('unit-km').click();
    await expect(page.getByTestId('d2-custom')).toHaveValue('12.87');
    await expect(page.getByTestId('split-row')).toHaveCount(13);           // 12 km + 0.87
    const L = await page.evaluate(() => (window as any).__splits.last);
    expect(Math.abs(L.d2 - 8 * MILE)).toBeLessThan(5);                     // rounded to 0.01 km
  });

  test('altitude tip uses the Thin Air rule of thumb and links to that page', async ({ page }) => {
    await page.goto(URL);
    await goal(page, '1:50:00');
    await expect(page.getByTestId('alt-tip')).toBeHidden();
    await page.getByTestId('alt').check();
    await expect(page.getByTestId('alt-tip')).toBeVisible();
    const pct = 0.1 * 5.28 ** 2;                                           // Denver: ≈ 2.8 %
    await expect(page.getByTestId('alt-text')).toContainText(`At 5,280 ft, expect roughly ${pct.toFixed(1)} % slower`);
    await expect(page.getByTestId('alt-text')).toContainText(fmt(6600 * (1 + pct / 100)));
    await expect(page.getByTestId('thin-air-link')).toHaveAttribute('href', '../lab/009-thin-air.html');
    await page.getByTestId('alt-apply').click();
    await expect(page.getByTestId('sum-goal')).toHaveText(fmt(Math.round(6600 * (1 + pct / 100))));
    const s = await splits(page);
    expect(Math.abs(s.reduce((a, r) => a + r.split, 0) - Math.round(6600 * (1 + pct / 100)))).toBeLessThanOrEqual(1);
  });
});
