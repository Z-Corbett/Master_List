import { test, expect, Page } from '@playwright/test';

const URL = '/lab/143-crawfish-boil.html';
const S = (page: Page) => page.evaluate(() => (window as any).__boil.state);

// Independent planning oracle, written from the rules the page states in its text.
const SACK = 35;                                            // "about 35 lb" (sacks run ~30–40 lb)
function buy(guests: number, per: number) {
  const live = guests * per;
  if (live <= 20) return { live, by: 'lb', lb: Math.ceil(live / 5) * 5, total: Math.ceil(live / 5) * 5 };
  const sacks = Math.ceil(live / SACK);
  return { live, by: 'sack', sacks, total: sacks * SACK };
}
const LB_KG = 0.45359237, GAL_L = 3.785411784, TBSP_ML = 14.78676478, STICK_G = 113.3980925;  // NIST / US customary

async function guests(page: Page, n: number) { await page.getByTestId('guests').fill(String(n)); }
async function open(page: Page) {
  await page.clock.install({ time: new Date('2026-04-11T17:00:00Z') });
  await page.goto(URL);
  await page.clock.pauseAt(new Date('2026-04-11T17:00:02Z'));
}

test.describe('143 Crawfish Boil Planner', () => {
  test('10 regular eaters: 40 lb live, rounded up to 2 approximate sacks, 3 batches in an 80 qt pot', async ({ page }) => {
    await page.goto(URL);
    const o = buy(10, 4);
    const p = (await S(page)).plan;
    expect(p.liveLb).toBe(40);
    expect(p.purchase).toEqual({ by: 'sack', sacks: 2 });
    expect(p.buyLb).toBe(o.total);
    expect(p.batches).toBe(Math.ceil(70 / 30));
    await expect(page.getByTestId('live-lb')).toHaveText('40 lb');
    await expect(page.getByTestId('buy')).toHaveText('2 sacks');
    await expect(page.getByTestId('buy-note')).toContainText('Sacks are approximate, usually 30–40 lb');
    await expect(page.getByTestId('batches')).toHaveText('3 × 80 qt');
    await expect(page.getByTestId('seasoning')).toHaveText('7 lb');           // 1 lb per 10 lb cooked at medium
    await expect(page.getByText('it\'s a rule of thumb, not a law')).toBeVisible();
  });

  test('scaling by guests and appetite, with by-the-pound and sack rounding', async ({ page }) => {
    await page.goto(URL);
    const cases: [number, 3 | 4 | 5][] = [[1, 3], [3, 3], [5, 4], [6, 4], [9, 4], [7, 5], [18, 5], [40, 3], [200, 5]];
    for (const [g, per] of cases) {
      await page.getByTestId(`appetite-${per}`).check();
      await guests(page, g);
      const o = buy(g, per);
      const p = (await S(page)).plan;
      expect(p.liveLb, `${g}×${per}`).toBe(o.live);
      expect(p.buyLb, `${g}×${per}`).toBe(o.total);
      expect(p.buyLb).toBeGreaterThanOrEqual(p.liveLb);                       // never round down
      await expect(page.getByTestId('buy')).toHaveText(o.by === 'lb' ? `${o.lb} lb` : `${o.sacks} sack${o.sacks! > 1 ? 's' : ''}`);
    }
    // edges: exactly 20 lb stays by the pound, 36 lb tips into a second sack
    expect((await page.evaluate(() => (window as any).__boil.plan({ guests: 5, per: 4 }))).purchase).toEqual({ by: 'lb', lb: 20 });
    expect((await page.evaluate(() => (window as any).__boil.plan({ guests: 9, per: 4 }))).purchase).toEqual({ by: 'sack', sacks: 2 });
    expect((await page.evaluate(() => (window as any).__boil.plan({ guests: 7, per: 5 }))).purchase).toEqual({ by: 'sack', sacks: 1 });
  });

  test('pot size sets the batches; sides scale per guest', async ({ page }) => {
    await page.goto(URL);
    await guests(page, 20);                                                    // 80 lb → 3 sacks → 105 lb
    for (const [pot, cap] of [[60, 20], [80, 30], [100, 40]]) {
      await page.getByTestId('pot').selectOption(String(pot));
      const p = (await S(page)).plan;
      expect(p.batches).toBe(Math.ceil(105 / cap));
      expect(p.waterGal).toBe(pot / 8);                                        // half the pot, qt → gal
    }
    const p = (await S(page)).plan;
    expect(p.corn).toBe(20);
    expect(p.potatoLb).toBe(5);
    expect(p.sausagePacks).toBe(5);
    await expect(page.locator('[data-testid="shop"] li[data-item="corn"]')).toContainText('20 ears');
    await page.getByTestId('side-sausage').uncheck();
    await expect(page.locator('[data-testid="shop"] li[data-item="sausage"]')).toHaveCount(0);
  });

  test('spice level scales the seasoning, the chili in the butter and the soak', async ({ page }) => {
    await page.goto(URL);                                                      // 70 lb cooked: 7 × "per 10 lb"
    const expected = { mild: [5.5, 3.5, 15], medium: [7, 7, 20], hot: [9, 14, 25], fire: [10.5, 21, 30] } as const;
    for (const [lvl, [seas, chili, soak]] of Object.entries(expected)) {
      await page.getByTestId(`spice-${lvl}`).check();
      const p = (await S(page)).plan;
      expect(p.seasoningLb, lvl).toBe(seas);                                   // 7 × multiplier, up to the next ½ lb
      expect(p.sauce.chiliTsp, lvl).toBe(chili);
      expect(p.soakMin, lvl).toBe(soak);
      await expect(page.locator('#timeline li[data-step="soak"] .t')).toHaveText(`${soak} min`);
    }
    const sc = (await S(page)).plan.sauce;
    expect(sc).toMatchObject({ butterSticks: 14, garlicHeads: 7, lemongrass: 7 });
    await expect(page.locator('#sauce li[data-item="butter"]')).toContainText('14 sticks (7 cups, 3.5 lb)');
    await expect(page.locator('#sauce li[data-item="lemongrass"]')).toContainText('7 stalks');
  });

  test('metric shopping list uses exact conversions', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('units-metric').click();
    await expect(page.getByTestId('units-metric')).toHaveAttribute('aria-pressed', 'true');
    const item = (id: string) => page.locator(`[data-testid="shop"] li[data-item="${id}"] span:last-child`);
    const fmt = (x: number, d: number) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('en-US', { maximumFractionDigits: d });
    await expect(item('live')).toHaveText(`2 sacks (≈ ${fmt(70 * LB_KG, 2)} kg)`);          // 31.75 kg
    expect(fmt(70 * LB_KG, 2)).toBe('31.75');
    await expect(item('seasoning')).toHaveText('3.18 kg');                                   // 7 lb
    await expect(item('water')).toHaveText(`${fmt(10 * GAL_L, 2)} L`);                        // 37.85 L
    await expect(item('butter')).toHaveText(`${fmt(14 * STICK_G, 0)} g (${fmt(7 * 236.5882365, 0)} mL)`);
    await expect(item('butter')).toHaveText('1,588 g (1,656 mL)');
    await expect(page.locator('#sauce li[data-item="cajun"] span:last-child')).toHaveText(`${fmt(14 * TBSP_ML, 0)} mL`);  // 14 tbsp
    await page.getByTestId('units-us').click();
    await expect(item('water')).toHaveText('10 gal');
    await expect(item('seasoning')).toHaveText('7 lb');
  });

  test('timer runs the steps in order under page.clock, chaining deadlines with no drift', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('step-name')).toHaveText('Ready: 5 steps, 61 min');
    await page.getByTestId('timer-start').click();
    await expect(page.getByTestId('countdown')).toHaveText('25:00');
    await expect(page.getByTestId('timer-live')).toHaveText('Step 1: Bring to a rolling boil, 25 minutes.');
    const order = ['boil', 'sides', 'crawfish', 'kill', 'soak'], mins = [25, 10, 4, 2, 20];
    let at = 0;
    for (let i = 0; i < order.length; i++) {
      const t = (await S(page)).timer;
      expect(t.stepId).toBe(order[i]);
      expect(t.remainingMs).toBe(mins[i] * 60000 - (i ? 1000 : 0));          // after the first, we're 1 s into each step
      // fastForward jumps the clock and fires the due tick once; the page must chain deadlines, not count ticks
      await page.clock.fastForward(mins[i] * 60000 - (i ? 1000 : 0) + 1000);  // land 1 s past the step's end
      at += mins[i] * 60000;
    }
    const t = (await S(page)).timer;
    expect(t.done).toBe(true);
    expect(t.log.map((e: any) => e.id)).toEqual([...order, 'done']);
    let cum = 0;
    t.log.forEach((e: any, i: number) => { expect(e.at).toBe(cum); cum += (mins[i] ?? 0) * 60000; });
    expect(cum).toBe(at);
    await expect(page.getByTestId('timer-live')).toHaveText('Soak done. Drain, toss in the garlic butter and serve.');
    await expect(page.locator('#timeline li.done')).toHaveCount(5);
    await expect(page.getByTestId('countdown')).toHaveText('00:00');
  });

  test('pause holds the countdown; Next step skips; no sides means no sides step', async ({ page }) => {
    await open(page);
    await page.getByTestId('side-corn').uncheck();
    await page.getByTestId('side-potatoes').uncheck();
    await page.getByTestId('side-sausage').uncheck();
    await page.getByTestId('spice-hot').check();
    expect((await S(page)).timer.steps.map((s: any) => s.id)).toEqual(['boil', 'crawfish', 'kill', 'soak']);
    await page.getByTestId('timer-start').click();
    await page.clock.runFor(90_000);
    await expect(page.getByTestId('countdown')).toHaveText('23:30');
    await page.getByTestId('timer-start').click();                               // pause
    await expect(page.getByTestId('timer-start')).toHaveText('Resume');
    await page.clock.fastForward(600_000);
    expect((await S(page)).timer.remainingMs).toBe(23.5 * 60000);
    await page.getByTestId('timer-start').click();                               // resume
    await page.clock.runFor(30_000);
    expect((await S(page)).timer.remainingMs).toBe(23 * 60000);
    await page.getByTestId('timer-skip').click();
    let t = (await S(page)).timer;
    expect(t.stepId).toBe('crawfish');
    expect(t.remainingMs).toBe(4 * 60000);
    await expect(page.locator('#timeline li[aria-current="step"]')).toHaveAttribute('data-step', 'crawfish');
    await page.clock.fastForward(6 * 60000 + 1000);                               // 4 min boil + 2 min kill, in one jump
    t = (await S(page)).timer;
    expect(t.stepId).toBe('soak');
    expect(t.remainingMs).toBe(25 * 60000 - 1000);                               // hot: 25 min soak
    await page.getByTestId('timer-reset').click();
    expect((await S(page)).timer.index).toBe(-1);
    await expect(page.getByTestId('timer-start')).toHaveText('Start the boil');
  });

  test('food-safety note: live crawfish only, discard dead ones before cooking', async ({ page }) => {
    await page.goto(URL);
    const note = page.getByTestId('safety');
    await expect(note).toBeVisible();
    await expect(note).toContainText('only cook crawfish that are alive');
    await expect(note).toContainText('discard any dead ones');
    await expect(note).toContainText('before cooking');
    await expect(note).toHaveAttribute('role', 'note');
  });

  test('keyboard: appetite radios and the guest field update the plan and announce it', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('appetite-4').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('appetite-5')).toBeChecked();
    await expect(page.getByTestId('plan-summary')).toHaveText('50 lb for 10');
    await page.getByTestId('guests').focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('guests')).toHaveValue('11');
    await expect(page.getByTestId('plan-summary')).toHaveText('55 lb for 11');
    await expect(page.getByTestId('plan-summary')).toHaveAttribute('aria-live', 'polite');
    await guests(page, 0);                                                         // ignored: at least one guest
    expect((await S(page)).guests).toBe(11);
  });
});
