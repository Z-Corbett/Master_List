import { test, expect, Page } from '@playwright/test';

const URL = '/lab/063-sourdough-schedule.html';

async function atNoonThursday(page: Page) {
  await page.clock.install({ time: new Date('2026-10-01T12:00:00') });
  await page.clock.pauseAt(new Date('2026-10-01T12:00:05'));
  await page.goto(URL);
}
const stepTime = async (page: Page, id: string) => new Date((await page.getByTestId(`step-${id}`).getAttribute('data-time'))!).getTime();
const MIN = 60_000;

test.describe('063 Sourdough Schedule', () => {
  test("baker's percentages: flour and water inside the levain are counted, and the grams add up", async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('weight').fill('1000');
    await page.getByTestId('ww').fill('0');
    await expect(page.getByTestId('r-ww')).toHaveCount(0);
    // total flour F = 1000 / (1 + 0.75 + 0.02) = 564.97 g; levain = 20% of F, half flour and half water
    const F = 1000 / 1.77, L = 0.2 * F;
    await expect(page.getByTestId('r-bread')).toContainText(String(Math.round(F - L / 2)));
    await expect(page.getByTestId('r-water')).toContainText(String(Math.round(0.75 * F - L / 2)));
    await expect(page.getByTestId('r-levain')).toContainText(String(Math.round(L)));
    await expect(page.getByTestId('r-salt')).toContainText((Math.round(0.02 * F * 10) / 10).toFixed(1));
    await expect(page.getByTestId('r-total')).toContainText('1,000');
    await expect(page.getByTestId('r-total')).toContainText('177.0%');
    const r = await page.evaluate(() => (window as any).__dough.recipe({ weight: 1000, loaves: 1, hydration: 75, levainPct: 20, saltPct: 2, wwPct: 0 }));
    expect(r.breadFlour + r.Lf).toBeCloseTo(r.F, 9);
    expect(r.water + r.Lw).toBeCloseTo(0.75 * r.F, 9);
    expect(r.breadFlour + r.water + r.L + r.salt).toBeCloseTo(1000, 9);

    // whole wheat splits the added flour; two loaves double everything
    await page.getByTestId('ww').fill('20');
    await page.getByTestId('loaves').fill('2');
    await expect(page.getByTestId('r-ww')).toContainText(String(Math.round(0.2 * 2 * F)));
    await expect(page.getByTestId('r-ww')).toContainText('20.0%');
    await expect(page.getByTestId('r-total')).toContainText('2,000');
    // impossible formula is refused rather than showing negative water
    await page.getByTestId('hyd').fill('60');
    await page.getByTestId('lev').fill('40');
    await expect(page.getByTestId('recipe')).not.toContainText('That much levain');
    const bad = await page.evaluate(() => (window as any).__dough.recipe({ weight: 1000, loaves: 1, hydration: 10, levainPct: 40, saltPct: 2, wwPct: 0 }));
    expect(bad.ok).toBe(false);
  });

  test('the rule-of-thumb model: 5 h at 76°F, doubling for every 14°F cooler, faster with a vigorous starter', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('model-note')).toContainText('Rule of thumb');
    await expect(page.getByTestId('bulk-time')).toHaveText('5 h 00 min');
    await expect(page.getByTestId('levain-time')).toHaveText('6 h 06 min'); // 5 × 2^(4/14) at a 72°F kitchen
    await page.getByTestId('dough').fill('64');
    await expect(page.getByTestId('dough-out')).toHaveText('64°F');
    const m = Math.round(5 * Math.pow(2, 12 / 14) * 60);
    await expect(page.getByTestId('bulk-time')).toHaveText(`${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`);
    await page.getByTestId('dough').fill('76');
    await page.getByTestId('strength-vigorous').click();
    await expect(page.getByTestId('strength-vigorous')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('bulk-time')).toHaveText('4 h 15 min');
    const h = await page.evaluate(() => { const d = (window as any).__dough; return [d.bulkHours({ doughF: 90, strength: 'vigorous', levainPct: 40, hydration: 90 }), d.bulkHours({ doughF: 40, strength: 'sluggish', levainPct: 5, hydration: 60 })]; });
    expect(h).toEqual([2.5, 14]); // clamped to sane limits
  });

  test('works backwards from the bake: every step lands where the plan says', async ({ page }) => {
    await atNoonThursday(page);
    await page.getByTestId('out').fill('2026-10-03T10:00');
    await page.getByTestId('out').dispatchEvent('change');
    const out = new Date('2026-10-03T10:00').getTime();
    const before = async (id: string) => (out - (await stepTime(page, id))) / MIN;
    expect(await before('bake')).toBe(45);
    expect(await before('preheat')).toBe(105);
    expect(await before('retard')).toBe(45 + 12 * 60);
    expect(await before('shape')).toBe(45 + 12 * 60 + 15);
    expect(await before('preshape')).toBe(45 + 12 * 60 + 45);
    expect(await before('mix')).toBe(45 + 12 * 60 + 45 + 300);
    expect((await stepTime(page, 'fold1')) - (await stepTime(page, 'mix'))).toBe(30 * MIN);
    expect((await stepTime(page, 'fold4')) - (await stepTime(page, 'mix'))).toBe(120 * MIN);
    expect((await stepTime(page, 'mix')) - (await stepTime(page, 'autolyse'))).toBe(60 * MIN);
    expect((await stepTime(page, 'levain')) - (await stepTime(page, 'feed'))).toBe(12 * 60 * MIN);
    await expect(page.getByTestId('step-bake')).toContainText('9:15 AM');
    await expect(page.getByTestId('step-mix')).toContainText('3:30 PM');
    await expect(page.getByTestId('step-levain')).toContainText('9:24 AM');
    await expect(page.getByTestId('start')).toHaveText('Thu 1, 9:24 PM');
    // a longer retard pulls every earlier step back by the same amount
    await page.getByTestId('retard').fill('15');
    await expect(page.getByTestId('retard-out')).toHaveText('15 h');
    expect(await before('mix')).toBe(45 + 15 * 60 + 45 + 300);
    // skipping the starter refresh removes that step
    await page.getByTestId('feed').uncheck();
    await expect(page.getByTestId('step-feed')).toHaveCount(0);
  });

  test('night-time steps are flagged and can be avoided; plans that start in the past are caught', async ({ page }) => {
    await atNoonThursday(page);
    await page.getByTestId('out').fill('2026-10-03T14:00');
    await page.getByTestId('out').dispatchEvent('change');
    const n0 = Number(await page.getByTestId('night-count').textContent());
    expect(n0).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('alert').locator('[data-kind="night"]')).toContainText('between 11 PM and 6 AM');
    await expect(page.getByTestId('step-retard')).toContainText('night');
    await page.getByTestId('avoid').click();
    await expect(page.getByTestId('night-count')).toHaveText('0');
    await expect(page.getByTestId('alert').locator('[data-kind="ok"]')).toBeVisible();
    const plan = await page.evaluate(() => (window as any).__dough.plan());
    for (const s of plan.steps) { const h = new Date(s.t).getHours(); expect(h >= 6 && h < 23).toBe(true); }

    // too soon
    await page.getByTestId('out').fill('2026-10-01T20:00');
    await page.getByTestId('out').dispatchEvent('change');
    await expect(page.getByTestId('alert').locator('[data-kind="past"]')).toContainText("That's too soon");
    await page.getByTestId('bake-now').click();
    await expect(page.getByTestId('alert').locator('[data-kind="past"]')).toHaveCount(0);
    const p2 = await page.evaluate(() => (window as any).__dough.plan());
    const now = new Date('2026-10-01T12:00:05').getTime();
    expect(p2.start).toBeGreaterThanOrEqual(now + 10 * MIN);
    expect(p2.start).toBeLessThan(now + 26 * MIN);
  });

  test('Celsius mode converts the readouts, and the printed schedule drops the controls', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('unit-c').click();
    await expect(page.getByTestId('unit-c')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('kitchen-out')).toHaveText('22.2°C');
    await page.getByTestId('dough').fill('24');
    await expect(page.getByTestId('dough-out')).toHaveText('24°C');
    const hrs = await page.evaluate(() => (window as any).__dough.bulkHours({ doughF: 24 * 9 / 5 + 32, strength: 'average', levainPct: 20, hydration: 75 }));
    const m = Math.round(hrs * 60);
    await expect(page.getByTestId('bulk-time')).toHaveText(`${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`);
    await expect(page.getByTestId('step-levain')).toContainText('at 22.2°C');

    await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
    await page.getByTestId('print').click();
    expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('kitchen')).toBeHidden();
    await expect(page.getByTestId('print')).toBeHidden();
    await expect(page.getByTestId('gantt')).toBeHidden();
    await expect(page.getByTestId('step-bake')).toBeVisible();
    await expect(page.getByTestId('recipe')).toBeVisible();
    await expect(page.locator('#print-head')).toContainText('Sourdough plan: bread out');
  });
});
