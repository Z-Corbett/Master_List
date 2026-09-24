import { test, expect, Page } from '@playwright/test';

const URL = '/lab/096-chili-cook-off.html?seed=3';
const pot = (page: Page) => page.evaluate(() => (window as any).__chili.pot);
const result = (page: Page) => page.evaluate(() => (window as any).__chili.result);
const advance = (page: Page, m: number) => page.evaluate((m) => (window as any).__chili.advance(m), m);

async function open(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => (window as any).__chili.manual(true));
}
async function light(page: Page) {
  await page.getByTestId('to-pot').click();
  await expect(page.getByTestId('pot')).toBeVisible();
}
/** A careful cook: medium heat, stir every 10 minutes, spice dumps at the given minutes. */
async function carefulCook(page: Page, minutes: number, dumpsAt: number[]) {
  for (let t = 0; t < minutes; t += 10) {
    if (dumpsAt.includes(t)) await page.getByTestId('dump').click();
    await advance(page, 10);
    await page.getByTestId('stir').click();
  }
}

test.describe('096 Chili Cook-Off', () => {
  test('pantry rules: no beans, one or two cuts, chiles set the heat', async ({ page }) => {
    await open(page);
    await page.getByTestId('cut-beans').click();
    await expect(page.getByTestId('cut-msg')).toContainText('Beans? Not in Texas red.');
    await expect(page.getByTestId('cut-beans')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('cut-brisket').click();
    await expect(page.getByTestId('cut-brisket')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cut-venison').click();
    await expect(page.getByTestId('cut-msg')).toHaveText('Two cuts is plenty. Unpick one first.');
    await page.getByTestId('cut-chuck').click();
    await page.getByTestId('cut-brisket').click();
    await expect(page.getByTestId('cut-msg')).toHaveText('You need at least one cut of beef.');
    expect((await page.evaluate(() => (window as any).__chili.pantry)).cuts).toEqual(['brisket']);
    // heat preview follows the Scoville maths
    const heat = async () => parseFloat((await page.getByTestId('heat-preview').textContent())!);
    const h0 = await heat();
    await page.getByRole('button', { name: 'More Chile pequín' }).click();
    await expect(page.getByTestId('qty-pequin')).toHaveText('1');
    const h1 = await heat();
    expect(h1).toBeGreaterThan(h0 + 1.5);
    const expected = await page.evaluate(() => { const C = (window as any).__chili; const P = C.pantry; let shu = 0; for (const c of C.CHILES) shu += P.chiles[c.id] * (c.shu[0] + c.shu[1]) / 2; return 10 * (1 - Math.exp(-shu / 40000)); });
    expect(h1).toBeCloseTo(expected, 1);
    // no chiles, no chili
    for (const id of ['ancho', 'guajillo', 'pasilla', 'arbol', 'pequin']) {
      const less = page.getByRole('button', { name: new RegExp(`^Less ${id === 'arbol' ? 'Chile de árbol' : id === 'pequin' ? 'Chile pequín' : id}$`, 'i') });
      while (await less.isEnabled()) await less.click();
    }
    await page.getByTestId('to-pot').click();
    await expect(page.getByTestId('pantry-msg')).toContainText('No chiles?');
    await expect(page.getByTestId('pot')).toBeHidden();
  });

  test('the pot: heat drives temperature and reduction, neglect scorches, stirring saves it', async ({ page }) => {
    await open(page);
    await light(page);
    let p = await advance(page, 30);
    expect(p.temp).toBeGreaterThan(195);                 // medium settles near 200 °F
    expect(p.temp).toBeLessThan(201);
    // careful medium cook: stirred every 10 minutes, the bottom never catches any further
    await page.getByTestId('stir').click();
    const early = p.scorch;
    await carefulCook(page, 60, []);
    p = await pot(page);
    expect(p.scorch).toBeCloseTo(early, 9);
    expect(p.scorch).toBeLessThan(0.05);
    const medLiquid = p.liquid;
    expect(p.tender.chuck).toBeGreaterThan(0.5);
    // crank it and walk away
    await page.getByTestId('heat-high').click();
    await expect(page.getByTestId('heat-high')).toHaveAttribute('aria-checked', 'true');
    p = await advance(page, 60);
    expect(p.temp).toBeGreaterThan(210);
    expect(p.scorch).toBeGreaterThan(0.2);
    expect(medLiquid - p.liquid).toBeGreaterThan(0.25);  // high heat boils it down fast
    await expect(page.getByTestId('pot-msg')).toHaveText('Smell that? The bottom is catching. Stir, and turn it down.');
    await expect(page.getByTestId('g-scorch')).toHaveText(`${Math.round(p.scorch * 100)}%`);
    // stirring resets the clock on the bottom; low heat evaporates far slower
    await page.getByTestId('stir').click();
    expect((await pot(page)).sinceStir).toBe(0);
    await page.getByTestId('heat-low').click();
    const before = (await pot(page)).liquid;
    p = await advance(page, 60);
    expect(before - p.liquid).toBeLessThan(0.1);
    // keyboard: S stirs, arrow keys turn the burner
    await page.keyboard.press('s');
    expect((await pot(page)).sinceStir).toBe(0);
    await page.getByTestId('heat-low').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('heat-med')).toBeFocused();
    expect((await pot(page)).heat).toBe('med');
  });

  test('turn-in needs an hour of simmering; two spice dumps at most', async ({ page }) => {
    await open(page);
    await light(page);
    await advance(page, 30);
    await page.getByTestId('turn-in').click();
    await expect(page.getByTestId('pot-msg')).toContainText('Not yet');
    await expect(page.getByTestId('judging')).toBeHidden();
    await page.getByTestId('dump').click();
    await expect(page.getByTestId('dump')).toHaveText('Spice dump 2 of 2');
    await page.getByTestId('dump').click();
    await expect(page.getByTestId('dump')).toBeDisabled();
    await expect(page.getByTestId('dump')).toHaveText('Spices all in');
    expect((await pot(page)).dumps).toHaveLength(2);
    await advance(page, 60);
    await page.getByTestId('turn-in').click();
    await expect(page.getByTestId('judging')).toBeVisible();
    await expect(page.getByTestId('log')).toContainText('Turned in a cup to the judges.');
  });

  test('judging is seeded and the scorecard adds up', async ({ page }) => {
    const cookAndJudge = async () => {
      await open(page);
      await light(page);
      await carefulCook(page, 180, [60, 150]);
      await page.getByTestId('turn-in').click();
      return result(page);
    };
    const a = await cookAndJudge();
    const b = await cookAndJudge();
    expect(b).toEqual(a);
    for (const s of a.scores) {
      const w = s.w, c = s.cat;
      expect(s.total).toBeCloseTo(Math.round((c.flavor * w.flavor + c.heat * w.heat + c.texture * w.texture + c.aroma * w.aroma) * 100) / 10, 5);
      for (const v of Object.values(c) as number[]) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(10); expect(v * 2).toBe(Math.round(v * 2)); }
      await expect(page.getByTestId(`${s.judge}-total`)).toHaveText(s.total.toFixed(1));
      await expect(page.getByTestId(`${s.judge}-comment`)).not.toBeEmpty();
    }
    const avg = Math.round(a.scores.reduce((x: number, s: any) => x + s.total, 0) / 3 * 10) / 10;
    expect(a.total).toBe(avg);
    await expect(page.getByTestId('total')).toHaveText(avg.toFixed(1));
    await expect(page.getByTestId('placing')).toContainText(`of 24 entries`);
    expect(a.total).toBeGreaterThan(75);                    // a careful cook does well
    // a scorched, neglected pot does badly and the judges say why
    await open(page);
    await light(page);
    await page.getByTestId('heat-high').click();
    await page.getByTestId('dump').click();
    await advance(page, 120);
    await page.getByTestId('turn-in').click();
    const bad = await result(page);
    expect(bad.total).toBeLessThan(a.total - 25);
    await expect(page.getByTestId('rosalind-comment')).toContainText('bottom of the pot');
    await expect(page.getByTestId('ribbon')).toHaveText('Thanks for cooking');
  });

  test('the judges disagree about heat, and late spice dumps smell brighter', async ({ page }) => {
    const judged = async (pequin: number, dumpsAt: number[]) => {
      await open(page);
      for (let i = 0; i < pequin; i++) await page.getByRole('button', { name: 'More Chile pequín' }).click();
      await light(page);
      await carefulCook(page, 180, dumpsAt);
      await page.getByTestId('turn-in').click();
      const r = await result(page);
      return Object.fromEntries(r.scores.map((s: any) => [s.judge, s.cat])) as Record<string, any>;
    };
    const mild = await judged(0, [60, 150]);
    const fiery = await judged(4, [60, 150]);
    expect(fiery.hank.heat).toBeGreaterThan(mild.hank.heat);
    expect(fiery.dolores.heat).toBeLessThan(mild.dolores.heat);
    const early = await judged(0, [0, 10]);
    expect(mild.rosalind.aroma).toBeGreaterThan(early.rosalind.aroma);
    await expect(page.getByTestId('rosalind-comment')).toContainText('smells tired');
    // cook again returns to the pantry with choices kept
    await page.getByTestId('again').click();
    await expect(page.getByTestId('pantry')).toBeVisible();
    await expect(page.getByTestId('qty-ancho')).toHaveText('3');
  });
});
