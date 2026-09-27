import { test, expect, Page } from '@playwright/test';

const URL = '/lab/170-soap-candle-calculator.html';
const G_PER_OZ = 28.349523125;          // exact, by definition of the avoirdupois ounce
const ML_PER_FLOZ = 29.5735295625;      // exact, US customary fluid ounce

// Published NaOH SAP values, typed in from each chart (Voyageur lists mg KOH/g, converted × 40/56.1 here).
const SOAPCALC: Record<string, number> = { olive: 0.135, coconut: 0.183, palm: 0.142, shea: 0.128, cocoa: 0.138, castor: 0.128,
  sunflower: 0.135, almond: 0.139, avocado: 0.133, lard: 0.141, tallow: 0.143 };
const FNWL: Record<string, number> = { olive: 0.135, coconut: 0.184, palm: 0.141, shea: 0.128, castor: 0.129, sunflower: 0.136,
  almond: 0.135, avocado: 0.138, lard: 0.138, tallow: 0.14 };
const SOAP_KITCHEN: Record<string, number> = { olive: 0.134, coconut: 0.190, palm: 0.141, shea: 0.128, cocoa: 0.137, castor: 0.1286,
  sunflower: 0.134, almond: 0.136, avocado: 0.133, lard: 0.138, tallow: 0.1405 };
const VOYAGEUR_KOH_MG: Record<string, number> = { olive: 189.7, coconut: 268.0, palm: 199.1, shea: 180.0, cocoa: 193.8, castor: 180.3,
  sunflower: 188.7, almond: 192.3, avocado: 187.5, lard: 194.6, tallow: 197.0 };

const txt = async (page: Page, id: string) => (await page.getByTestId(id).textContent())!.trim();
const grams = (s: string) => parseFloat(s.replace(/[^\d.]/g, ''));
const r1 = (x: number) => x.toFixed(1) + ' g';
const oz2 = (g: number) => (g / G_PER_OZ).toFixed(2) + ' oz';

// Hand oracle: lye = Σ(oil weight × SAP_NaOH) × (1 − superfat)
const naohFor = (recipe: Record<string, number>, sf: number) =>
  Object.entries(recipe).reduce((s, [k, g]) => s + g * SOAPCALC[k], 0) * (1 - sf / 100);

async function setRecipe(page: Page, recipe: Record<string, number>) {
  await page.getByTestId('clear').click();
  for (const [k, g] of Object.entries(recipe)) await page.getByTestId(`oil-${k}`).fill(String(g));
}

test.describe('170 Soap & Candle Calculator', () => {
  test('SAP table matches SoapCalc, KOH = NaOH × 56.1/40, and each value sits in the four-source range', async ({ page }) => {
    await page.goto(URL);
    for (const [k, v] of Object.entries(SOAPCALC)) {
      await expect(page.getByTestId(`sap-naoh-${k}`)).toHaveText(v.toFixed(3));
      await expect(page.getByTestId(`sap-koh-${k}`)).toHaveText((v * 56.1 / 40).toFixed(3));
      const all = [v, FNWL[k], SOAP_KITCHEN[k], VOYAGEUR_KOH_MG[k] / 1000 * 40 / 56.1].filter((x) => x !== undefined);
      const lo = Math.min(...all), hi = Math.max(...all);
      // the page's range column must agree with the published figures, to 3 dp
      const [plo, phi] = (await txt(page, `range-${k}`)).split('–').map(parseFloat);
      expect(Math.abs(plo - lo)).toBeLessThanOrEqual(0.0006);
      expect(Math.abs(phi - hi)).toBeLessThanOrEqual(0.0006);
      expect(v).toBeGreaterThanOrEqual(plo);
      expect(v).toBeLessThanOrEqual(phi);
    }
    // the derived KOH values land within 1% of SoapCalc's own published KOH column
    const soapcalcKoh: Record<string, number> = { olive: 0.190, coconut: 0.257, palm: 0.199, shea: 0.179, cocoa: 0.194, castor: 0.180 };
    for (const [k, koh] of Object.entries(soapcalcKoh)) expect(Math.abs(SOAPCALC[k] * 56.1 / 40 - koh) / koh).toBeLessThan(0.01);
    await expect(page.getByTestId('sap-sources')).toContainText('SoapCalc');
    await expect(page.getByTestId('sap-sources').locator('a')).toHaveCount(4);
  });

  test('NaOH for the sample recipe equals the hand calculation', async ({ page }) => {
    await page.goto(URL);
    // 500 olive, 300 coconut, 150 shea, 50 castor at 5%: (67.5 + 54.9 + 19.2 + 6.4) × 0.95 = 140.6 g
    const hand = (500 * 0.135 + 300 * 0.183 + 150 * 0.128 + 50 * 0.128) * 0.95;
    expect(hand).toBeCloseTo(140.6, 6);
    await expect(page.getByTestId('lye')).toHaveText('140.6 g');
    await expect(page.getByTestId('oils-out')).toHaveText('1000.0 g');
    // a second recipe typed in, 7% superfat
    const recipe = { lard: 700, coconut: 250, castor: 50 };
    await setRecipe(page, recipe);
    await page.getByTestId('superfat').fill('7');
    await expect(page.getByTestId('lye')).toHaveText(r1(naohFor(recipe, 7)));   // 133.1 g
    await expect(page.getByTestId('soap-math')).toContainText('(1 − 7%)');
  });

  test('KOH is the NaOH result × 56.1/40, and purity divides it', async ({ page }) => {
    await page.goto(URL);
    const recipe = { olive: 600, coconut: 250, sunflower: 150 };
    await setRecipe(page, recipe);
    const naoh = naohFor(recipe, 5);
    await expect(page.getByTestId('lye')).toHaveText(r1(naoh));
    await page.getByTestId('lye-koh').check();
    await expect(page.getByTestId('lye')).toHaveText(r1(naoh * 56.1 / 40));
    await expect(page.getByTestId('purity')).toBeVisible();
    await page.getByTestId('purity').fill('90');
    await expect(page.getByTestId('lye')).toHaveText(r1(naoh * 56.1 / 40 / 0.9));
    await expect(page.getByText('Potassium hydroxide (KOH)')).toBeVisible();
    await page.getByTestId('lye-naoh').check();
    await expect(page.getByTestId('purity')).toBeHidden();
    await expect(page.getByTestId('lye')).toHaveText(r1(naoh));
  });

  test('water: concentration, ratio and % of oils modes', async ({ page }) => {
    await page.goto(URL);
    const lye = naohFor({ olive: 500, coconut: 300, shea: 150, castor: 50 }, 5);
    // 33% lye concentration: water = lye × 67/33
    await expect(page.getByTestId('water')).toHaveText(r1(lye * 67 / 33));
    await expect(page.getByTestId('conc-out')).toHaveText('33.0%');
    await page.getByTestId('conc').fill('30');
    await expect(page.getByTestId('water')).toHaveText(r1(lye * 70 / 30));
    // 2 : 1 ratio
    await page.getByTestId('wmode-ratio').check();
    await expect(page.getByTestId('ratio')).toBeVisible();
    await expect(page.getByTestId('water')).toHaveText(r1(lye * 2));
    await expect(page.getByTestId('conc-out')).toHaveText((100 / 3).toFixed(1) + '%');
    await page.getByTestId('ratio').fill('2.5');
    await expect(page.getByTestId('water')).toHaveText(r1(lye * 2.5));
    await expect(page.getByTestId('ratio-out')).toHaveText('2.50 : 1');
    // 38% of oils
    await page.getByTestId('wmode-pct').check();
    await expect(page.getByTestId('water')).toHaveText('380.0 g');
    await expect(page.getByTestId('ratio-out')).toHaveText((380 / lye).toFixed(2) + ' : 1');
  });

  test('fragrance at the usage rate and the batch total add up', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('fo')).toHaveText('30.0 g');                 // 3% of 1000 g
    await page.getByTestId('fragrance').fill('5.5');
    await expect(page.getByTestId('fo')).toHaveText('55.0 g');
    const lye = naohFor({ olive: 500, coconut: 300, shea: 150, castor: 50 }, 5);
    await expect(page.getByTestId('batch')).toHaveText(r1(1000 + lye + lye * 67 / 33 + 55));
    await page.getByTestId('fragrance').fill('8');
    await expect(page.getByTestId('soap-warns')).toContainText('maximum usage rate');
  });

  test('ounces: rounding to 0.01 oz, typing in ounces, and back to grams without drift', async ({ page }) => {
    await page.goto(URL);
    const lye = naohFor({ olive: 500, coconut: 300, shea: 150, castor: 50 }, 5);
    await page.getByTestId('unit-oz').check();
    await expect(page.getByTestId('lye')).toHaveText(oz2(lye));                 // 4.96 oz
    await expect(page.getByTestId('oils-out')).toHaveText(oz2(1000));           // 35.27 oz
    await expect(page.getByTestId('oil-olive')).toHaveValue('17.64');
    await expect(page.getByTestId('lye')).toHaveText(/^\d+\.\d{2} oz$/);
    // type a recipe in ounces: 16 oz olive + 8 oz coconut
    await setRecipe(page, { olive: 16, coconut: 8 });
    const lyeOz = (16 * 0.135 + 8 * 0.183) * 0.95;
    await expect(page.getByTestId('lye')).toHaveText(lyeOz.toFixed(2) + ' oz');  // SAP is unit-free
    await page.getByTestId('unit-g').check();
    await expect(page.getByTestId('oil-olive')).toHaveValue((16 * G_PER_OZ).toFixed(1));   // 453.6
    await expect(page.getByTestId('lye')).toHaveText(r1(lyeOz * G_PER_OZ));
    await expect(page.getByTestId('lye')).toHaveText(/^\d+\.\d g$/);
  });

  test('the lye safety notice is prominent, complete and cannot be dismissed', async ({ page }) => {
    await page.goto(URL);
    const s = page.getByTestId('lye-safety');
    await expect(s).toBeVisible();
    for (const t of [/add lye to water, never water to lye/i, /goggles/i, /gloves/i, /ventilated/i, /children/i, /aluminium/i, /by weight on a digital scale/i])
      await expect(s).toContainText(t);
    await expect(page.getByTestId('double-check')).toHaveText('Double-check your recipe with an established lye calculator before making soap.');
    // nothing inside it can close it, and it isn't a collapsible <details>
    await expect(s.locator('button, a, input, summary, [role=button]')).toHaveCount(0);
    expect(await s.evaluate((el) => el.closest('details, dialog'))).toBeNull();
    // it sits above the results
    const [sb, rb] = [await s.boundingBox(), await page.getByTestId('soap-results').boundingBox()];
    expect(sb!.y).toBeLessThan(rb!.y);
    // still there after Escape, every input change, and a tab round-trip
    await page.keyboard.press('Escape');
    await page.getByTestId('lye-koh').check();
    await page.getByTestId('wmode-ratio').check();
    await page.getByTestId('unit-oz').check();
    await page.getByTestId('clear').click();
    await expect(s).toBeVisible();
    await page.getByTestId('tab-candle').click();
    await page.getByTestId('tab-soap').click();
    await expect(s).toBeVisible();
    await expect(page.getByTestId('soap-disclaimer')).toContainText('Not a guarantee of safety');
    expect(await s.evaluate((el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility === 'visible')).toBe(true);
  });

  test('out-of-range inputs warn, and invalid ones blank the result', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('superfat').fill('0');
    await expect(page.getByTestId('soap-warns')).toContainText('no margin');
    await expect(page.getByTestId('lye')).toHaveText(r1(naohFor({ olive: 500, coconut: 300, shea: 150, castor: 50 }, 0)));
    await page.getByTestId('superfat').fill('25');
    await expect(page.getByTestId('lye')).toHaveText('—');
    await expect(page.getByTestId('soap-warns')).toContainText('between 0 and 20%');
    await page.getByTestId('superfat').fill('5');
    await page.getByTestId('conc').fill('45');
    await expect(page.getByTestId('soap-warns')).toContainText('25–40%');
    await page.getByTestId('clear').click();
    await expect(page.getByTestId('oil-olive')).toBeFocused();
    await expect(page.getByTestId('lye')).toHaveText('—');
    await expect(page.getByTestId('soap-warns')).toContainText('at least one oil');
  });

  test('candle: wax and fragrance from volume, fill level and 0.86 g/mL', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('tab-candle').click();
    await expect(page.getByTestId('panel-soap')).toBeHidden();
    await expect(page.getByTestId('dens-used')).toHaveText('0.86 g/mL');
    // 250 mL at 90% × 0.86 = 193.5 g total; 8% of wax weight: wax = 193.5 / 1.08
    const total = 250 * 0.9 * 0.86, wax = total / 1.08;
    const both = (g: number) => `${g.toFixed(1)} g · ${(g / G_PER_OZ).toFixed(2)} oz`;
    await expect(page.getByTestId('cfill-out')).toHaveText(both(total));
    await expect(page.getByTestId('wax')).toHaveText(both(wax));
    await expect(page.getByTestId('cfo')).toHaveText(both(wax * 0.08));
    expect(wax + wax * 0.08).toBeCloseTo(total, 9);
    // an 8 US fl oz jar, full, 0.9 g/mL wax, 10% load, 4 jars
    await page.getByTestId('cvunit').selectOption('floz');
    await page.getByTestId('cvol').fill('8');
    await page.getByTestId('cfill').fill('100');
    await page.getByTestId('cdens').fill('0.9');
    await page.getByTestId('cload').fill('10');
    await page.getByTestId('ccount').fill('4');
    const t2 = 8 * ML_PER_FLOZ * 0.9 * 4;
    await expect(page.getByTestId('cfill-out')).toHaveText(both(t2));
    await expect(page.getByTestId('wax')).toHaveText(both(t2 / 1.1));
    await expect(page.getByTestId('dens-used')).toHaveText('0.9 g/mL');
  });

  test('candle: wick note demands test burns; high loads and bad densities warn; tabs work by keyboard', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('tab-soap').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-candle')).toBeFocused();
    await expect(page.getByTestId('tab-candle')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('wick-note')).toContainText('test burns are required');
    await expect(page.getByTestId('wick-note')).toContainText('unattended');
    await page.getByTestId('cload').fill('14');
    await expect(page.getByTestId('candle-warns')).toContainText('12%');
    await page.getByTestId('cdens').fill('1.2');
    await expect(page.getByTestId('candle-warns')).toContainText('0.86–0.9');
    await page.getByTestId('cvol').fill('0');
    await expect(page.getByTestId('wax')).toHaveText('—');
    await page.getByTestId('tab-candle').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('lye-safety')).toBeVisible();
  });
});
