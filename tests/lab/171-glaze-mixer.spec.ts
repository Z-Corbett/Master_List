import { test, expect, Page, Locator } from '@playwright/test';

const URL = '/lab/171-glaze-mixer.html';

// IUPAC abridged standard atomic weights (2021), typed in independently of the page.
const A = { H: 1.008, B: 10.81, C: 12.011, O: 15.999, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, K: 39.098, Ca: 40.078, Ti: 47.867, Fe: 55.845, Zn: 65.38 };
const MW: Record<string, number> = {
  SiO2: A.Si + 2 * A.O, Al2O3: 2 * A.Al + 3 * A.O, B2O3: 2 * A.B + 3 * A.O, Na2O: 2 * A.Na + A.O, K2O: 2 * A.K + A.O,
  CaO: A.Ca + A.O, MgO: A.Mg + A.O, ZnO: A.Zn + A.O, Fe2O3: 2 * A.Fe + 3 * A.O, TiO2: A.Ti + 2 * A.O, P2O5: 2 * A.P + 5 * A.O,
};
const FLUX = ['Na2O', 'K2O', 'CaO', 'MgO', 'ZnO'];
// Published analyses (weight %), as stated on the page's sources.
const EPK = { CaO: 0.18, K2O: 0.33, MgO: 0.10, Na2O: 0.06, TiO2: 0.37, Al2O3: 37.36, P2O5: 0.24, SiO2: 45.73, Fe2O3: 0.79 };
const CUSTER = { CaO: 0.30, K2O: 10.00, Na2O: 3.00, Al2O3: 17.00, SiO2: 68.50, Fe2O3: 0.10 };
const WHITING = { CaO: (100 * MW.CaO) / (A.Ca + A.C + 3 * A.O) };   // CaCO3 → CaO + CO2
const SILICA = { SiO2: 100 };

type An = Record<string, number>;
function umf(recipe: [An, number][]) {
  const mol: Record<string, number> = {};
  for (const [an, pct] of recipe) for (const [ox, w] of Object.entries(an)) mol[ox] = (mol[ox] || 0) + (pct * w / 100) / MW[ox];
  const flux = FLUX.reduce((s, k) => s + (mol[k] || 0), 0);
  const out: Record<string, number> = {};
  for (const k in mol) out[k] = mol[k] / flux;
  return out;
}
const num = async (l: Locator) => parseFloat((await l.textContent())!);
const last = (page: Page) => page.evaluate(() => (window as any).__glaze.last);

async function setBase(page: Page, rows: [string, number][]) {
  while (await page.getByTestId('base-remove').count()) await page.getByTestId('base-remove').first().click();
  for (const [id, p] of rows) {
    await page.getByTestId('add-base').click();
    await page.getByTestId('base-sel').last().selectOption(id);
    await page.getByTestId('base-pct').last().fill(String(p));
  }
}

test.describe('171 Glaze Mixer', () => {
  test('molecular weights come from atomic weights and match textbook values', async ({ page }) => {
    await page.goto(URL);
    for (const [k, v] of Object.entries(MW)) await expect(page.getByTestId(`mw-${k}`)).toHaveText(v.toFixed(3));
    // commonly printed values in glaze texts
    const book = { SiO2: 60.08, Al2O3: 101.96, CaO: 56.08, Na2O: 61.98, K2O: 94.20, MgO: 40.30, B2O3: 69.62, ZnO: 81.38, Fe2O3: 159.69, TiO2: 79.87 };
    for (const [k, v] of Object.entries(book)) expect(Math.abs(MW[k] - v)).toBeLessThan(0.015);
    // whiting's CaO share is the CaO / CaCO3 mass ratio, about 56.0%
    expect(WHITING.CaO).toBeGreaterThan(56.0);
    expect(WHITING.CaO).toBeLessThan(56.1);
  });

  test('UMF of whiting + EPK + silica equals the hand calculation', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset').selectOption('simple');
    const want = umf([[WHITING, 25], [EPK, 30], [SILICA, 45]]);
    const L = await last(page);
    for (const [ox, v] of Object.entries(want)) {
      expect(Math.abs(L.umf[ox] - v)).toBeLessThan(1e-9);
      await expect(page.getByTestId(`umf-${ox}`)).toHaveText(v.toFixed(3));
    }
    // CaO dominates: whiting's CaO plus EPK's traces, divided by all fluxes
    expect(want.CaO).toBeGreaterThan(0.97);
    await expect(page.getByTestId('si-al')).toHaveText((want.SiO2 / want.Al2O3).toFixed(2) + ' : 1');
  });

  test('fluxes sum to exactly 1.0 for every sample and for a boron recipe', async ({ page }) => {
    await page.goto(URL);
    for (const p of ['leach', 'simple', 'celadon']) {
      await page.getByTestId('preset').selectOption(p);
      await expect(page.getByTestId('flux-sum')).toHaveText('1.000');
      expect(Math.abs((await last(page)).fluxSum - 1)).toBeLessThan(1e-12);
    }
    await setBase(page, [['f3134', 30], ['gerstley', 10], ['neph', 20], ['epk', 15], ['silica', 20], ['talc', 3], ['zinc', 2]]);
    await expect(page.getByTestId('flux-sum')).toHaveText('1.000');
    const L = await last(page);
    const displayed = await Promise.all(FLUX.map((k) => num(page.getByTestId(`umf-${k}`))));
    expect(Math.abs(displayed.reduce((a, b) => a + b, 0) - 1)).toBeLessThanOrEqual(0.003);   // 3 dp rounding
    expect(L.umf.B2O3).toBeGreaterThan(0);
    await expect(page.getByTestId('umf-B2O3')).toBeVisible();
  });

  test('Leach 4-3-2-1: UMF and Si:Al against the oracle', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('preset')).toHaveValue('leach');
    const want = umf([[CUSTER, 40], [SILICA, 30], [WHITING, 20], [EPK, 10]]);
    for (const ox of ['CaO', 'K2O', 'Na2O', 'Al2O3', 'SiO2']) await expect(page.getByTestId(`umf-${ox}`)).toHaveText(want[ox].toFixed(3));
    const L = await last(page);
    expect(Math.abs(L.siAl - want.SiO2 / want.Al2O3)).toBeLessThan(1e-9);
    // sanity: a cone 10 glossy clear sits around 0.3–0.5 Al2O3 and 3–5 SiO2
    expect(want.Al2O3).toBeGreaterThan(0.3); expect(want.Al2O3).toBeLessThan(0.5);
    expect(want.SiO2).toBeGreaterThan(3); expect(want.SiO2).toBeLessThan(5);
  });

  test('batch scaling', async ({ page }) => {
    await page.goto(URL);
    for (const [id, g] of [['custer', '400.0'], ['silica', '300.0'], ['whiting', '200.0'], ['epk', '100.0']]) await expect(page.getByTestId(`g-${id}`)).toHaveText(g);
    await page.getByTestId('batch').fill('3500');
    for (const [id, g] of [['custer', 1400], ['silica', 1050], ['whiting', 700], ['epk', 350]]) await expect(page.getByTestId(`g-${id}`)).toHaveText(g.toFixed(1));
    await expect(page.getByTestId('dry-total')).toHaveText('3500.0');
    await page.getByTestId('batch').fill('250');
    await expect(page.getByTestId('g-whiting')).toHaveText('50.0');
    // the UMF doesn't depend on batch size
    await expect(page.getByTestId('flux-sum')).toHaveText('1.000');
  });

  test('colorants are added on top of 100% and stay out of the UMF', async ({ page }) => {
    await page.goto(URL);
    const plain = (await last(page)).umf;
    await page.getByTestId('preset').selectOption('celadon');
    await expect(page.getByTestId('g-rio')).toHaveText('10.0');
    await expect(page.getByTestId('g-custer')).toHaveText('400.0');
    await expect(page.getByTestId('dry-total')).toHaveText('1010.0');
    await expect(page.getByTestId('base-sum')).toHaveText('Base total: 100%');
    const withIron = (await last(page)).umf;
    for (const k of Object.keys(plain)) expect(withIron[k]).toBeCloseTo(plain[k], 12);
    // add 0.5% cobalt carbonate too
    await page.getByTestId('add-add').click();
    await page.getByTestId('add-sel').last().selectOption('cobalt');
    await page.getByTestId('add-pct').last().fill('0.5');
    await expect(page.getByTestId('g-cobalt')).toHaveText('5.0');
    await expect(page.getByTestId('dry-total')).toHaveText('1015.0');
    await expect(page.getByTestId('warns')).toContainText('Cobalt compounds are toxic');
    // water guidance scales with the dry total and says it's approximate
    await expect(page.getByTestId('water-note')).toContainText(`about ${Math.round(1015 * 0.8)}–${Math.round(1015)} g`);
    await expect(page.getByTestId('water-note')).toContainText(/approximate/i);
  });

  test('recipes that do not add to 100% are normalised, with a warning', async ({ page }) => {
    await page.goto(URL);
    await setBase(page, [['whiting', 20], ['epk', 25], ['silica', 35]]);          // 80%
    await expect(page.getByTestId('warns')).toContainText('add up to 80%');
    await expect(page.getByTestId('warns')).toContainText('normalised');
    await expect(page.getByTestId('g-whiting')).toHaveText((1000 * 20 / 80).toFixed(1));   // 250.0
    await expect(page.getByTestId('g-silica')).toHaveText((1000 * 35 / 80).toFixed(1));    // 437.5
    await expect(page.getByTestId('dry-total')).toHaveText('1000.0');
    const want = umf([[WHITING, 25], [EPK, 31.25], [SILICA, 43.75]]);
    await expect(page.getByTestId('umf-SiO2')).toHaveText(want.SiO2.toFixed(3));
    await page.getByTestId('base-pct').first().fill('40');                         // 100% again
    await expect(page.getByTestId('warns')).not.toContainText('normalised');
  });

  test('material analyses match their published sources', async ({ page }) => {
    await page.goto(URL);
    const M = await page.evaluate(() => (window as any).__glaze.MATERIALS);
    expect(M.epk.ox).toEqual(EPK);
    expect(M.custer.ox).toEqual(CUSTER);
    expect(M.neph.ox).toEqual({ CaO: 0.70, K2O: 4.60, Na2O: 9.80, Al2O3: 23.30, SiO2: 60.70, MgO: 0.10, Fe2O3: 0.10 });
    expect(M.f3134.ox).toEqual({ CaO: 19.51, B2O3: 22.79, SiO2: 45.56, Na2O: 10.14, Al2O3: 2.00 });
    // Gerstley borate vs New Mexico Clay's typical analysis: every oxide agrees within 0.1%
    const nmc = { B2O3: 26.8, CaO: 19.4, SiO2: 14.8, Na2O: 3.95, MgO: 3.54, Al2O3: 0.98, Fe2O3: 0.425, K2O: 0.399, P2O5: 0.053, TiO2: 0.05 };
    for (const [k, v] of Object.entries(nmc)) expect(Math.abs(M.gerstley.ox[k] - v)).toBeLessThanOrEqual(0.1);
    // theoretical talc and wollastonite agree with Digitalfire's printed values
    expect(Math.abs(M.talc.ox.MgO - 31.87)).toBeLessThan(0.02);
    expect(Math.abs(M.talc.ox.SiO2 - 63.38)).toBeLessThan(0.02);
    expect(Math.abs(M.woll.ox.CaO - 48.28)).toBeLessThan(0.02);
    expect(Math.abs(M.woll.ox.SiO2 - 51.72)).toBeLessThan(0.02);
    // no lead or barium anywhere in the pickers
    const names = (await page.locator('select[data-testid$="-sel"] option').allTextContents()).join(' ');
    expect(names).not.toMatch(/lead|barium|litharge|frit 3304/i);
    await expect(page.getByTestId('mat-custer')).toContainText('68.50');
  });

  test('safety notice: respirator, hazardous materials, leach testing and test tiles', async ({ page }) => {
    await page.goto(URL);
    const s = page.getByTestId('glaze-safety');
    await expect(s).toBeVisible();
    for (const t of [/respirator/i, /Barium, lead and some colorants/, /leach test/i, /test tiles/i, /food-safe/i]) await expect(s).toContainText(t);
    await expect(s.locator('button, summary')).toHaveCount(0);
    await page.getByTestId('add-add').click();
    await page.getByTestId('add-sel').last().selectOption('copper');
    await page.getByTestId('add-pct').last().fill('2');
    await expect(page.getByTestId('warns')).toContainText('leach');
  });

  test('editing rows: remove moves focus, duplicates warn, a flux-free recipe has no UMF', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('base-sel')).toHaveCount(4);
    await page.getByTestId('base-remove').nth(1).click();                           // remove silica
    await expect(page.getByTestId('base-sel')).toHaveCount(3);
    await expect(page.getByTestId('base-pct').nth(1)).toBeFocused();
    await expect(page.getByTestId('warns')).toContainText('add up to 70%');
    await page.getByTestId('base-sel').nth(1).selectOption('custer');
    await expect(page.getByTestId('warns')).toContainText('listed twice');
    await setBase(page, [['silica', 60], ['epk', 40]]);
    await expect(page.getByTestId('flux-sum')).not.toHaveText('—');                  // EPK carries trace fluxes
    await setBase(page, [['silica', 100]]);
    await expect(page.getByTestId('flux-sum')).toHaveText('—');
    await expect(page.getByTestId('warns')).toContainText('no flux oxides');
    await page.getByTestId('base-remove').click();
    await expect(page.getByTestId('add-base')).toBeFocused();
    await expect(page.getByTestId('warns')).toContainText('at least one base material');
  });
});
