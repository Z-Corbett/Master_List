import { test, expect, Page } from '@playwright/test';

const URL = '/lab/105-heat-index.html';

// Independent oracle, written from the NWS Weather Prediction Center's heat index equation page.
function nws(T: number, RH: number) {
  const simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094);
  if (simple < 80) return { hi: simple, simple, method: 'simple', adj: 0 };
  let hi = -42.379 + 2.04901523 * T + 10.14333127 * RH - 0.22475541 * T * RH - 6.83783e-3 * T ** 2
    - 5.481717e-2 * RH ** 2 + 1.22874e-3 * T ** 2 * RH + 8.5282e-4 * T * RH ** 2 - 1.99e-6 * T ** 2 * RH ** 2;
  let adj = 0;
  if (RH < 13 && T >= 80 && T <= 112) adj = -((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  else if (RH > 85 && T >= 80 && T <= 87) adj = ((RH - 85) / 10) * ((87 - T) / 5);
  hi += adj;
  return { hi, simple, method: 'rothfusz', adj };
}
const bandOf = (hi: number) => (hi >= 125 ? 4 : hi >= 103 ? 3 : hi >= 90 ? 2 : hi >= 80 ? 1 : 0);
const toC = (f: number) => ((f - 32) * 5) / 9;

async function set(page: Page, t: number, rh: number) {
  await page.getByTestId('t').fill(String(t));
  await page.getByTestId('t').press('Enter');
  await page.getByTestId('rh').fill(String(rh));
  await page.getByTestId('rh').press('Enter');
}

test.describe('105 Heat Index', () => {
  test('page algorithm matches an independent NWS oracle across the whole plane', async ({ page }) => {
    await page.goto(URL);
    const pts: [number, number][] = [];
    for (let t = 50; t <= 120; t += 1.5) for (let rh = 0; rh <= 100; rh += 2.5) pts.push([t, rh]);
    const got = await page.evaluate((p) => p.map(([t, rh]) => (window as any).__heat.compute(t, rh)), pts);
    pts.forEach(([t, rh], i) => {
      const want = nws(t, rh);
      expect(Math.abs(got[i].hi - want.hi), `${t} °F ${rh} %`).toBeLessThan(1e-9);
      expect(got[i].method).toBe(want.method);
      expect(got[i].band).toBe(bandOf(want.hi));
    });
  });

  test('90 °F at 70 % gives about 106 °F, and the steps show the regression', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-textbook').click();
    await expect(page.getByTestId('preset-textbook')).toHaveAttribute('aria-pressed', 'true');
    const L = await page.evaluate(() => (window as any).__heat.last);
    expect(L.hi).toBeGreaterThan(105);
    expect(L.hi).toBeLessThan(106.5);
    await expect(page.getByTestId('hi')).toHaveText('106 °F');
    await expect(page.getByTestId('band')).toHaveText('Danger');
    await expect(page.getByTestId('simple')).toHaveText(`${nws(90, 70).simple.toFixed(1)} °F`);
    await expect(page.getByTestId('full')).toHaveText('105.9 °F');
    await expect(page.getByTestId('adj')).toHaveText('none applies');
    await expect(page.getByTestId('method')).toContainText('Rothfusz');
  });

  test('matches the published NWS chart row for 40 % humidity', async ({ page }) => {
    await page.goto(URL);
    // NWS heat index chart, 40 % RH row, 80–110 °F (rounded values as printed)
    const chart: Record<number, number> = { 80: 80, 82: 81, 84: 83, 86: 85, 88: 88, 90: 91, 92: 94, 94: 97, 96: 101, 98: 105, 100: 109, 102: 114, 104: 119, 106: 124, 108: 130, 110: 136 };
    for (const [t, v] of Object.entries(chart)) {
      const hi = await page.evaluate(([T]) => (window as any).__heat.compute(T, 40).hi, [Number(t)]);
      expect(Math.round(hi), `${t} °F`).toBe(v);
    }
  });

  test('below 80 °F the simple estimate is the answer and the regression is skipped', async ({ page }) => {
    await page.goto(URL);
    await set(page, 70, 50);
    await expect(page.getByTestId('simple')).toHaveText(`${nws(70, 50).simple.toFixed(1)} °F`); // ½(70 + 61 + 2.4 + 4.7) ≈ 69.05
    await expect(page.getByTestId('hi')).toHaveText('69 °F');
    await expect(page.getByTestId('full')).toContainText('not needed');
    await expect(page.getByTestId('step-full')).toHaveClass(/off/);
    await expect(page.getByTestId('band')).toHaveText('No heat-index advisory band');
    // 80 °F at 40 %: simple = 79.58, still just under the threshold
    await set(page, 80, 40);
    const L = await page.evaluate(() => (window as any).__heat.last);
    expect(L.method).toBe('simple');
    expect(L.simple).toBeCloseTo(79.58, 6);
  });

  test('low-humidity adjustment: RH < 13 % between 80 and 112 °F', async ({ page }) => {
    await page.goto(URL);
    await set(page, 100, 5);
    const want = -((13 - 5) / 4) * Math.sqrt((17 - 5) / 17); // −1.680
    await expect(page.getByTestId('adj')).toHaveText(`low-humidity: −${Math.abs(want).toFixed(2)} °F`);
    const L = await page.evaluate(() => (window as any).__heat.last);
    expect(L.adj.value).toBeCloseTo(want, 9);
    expect(L.hi).toBeCloseTo(nws(100, 5).hi, 9);
    // RH exactly 13 and T outside 80–112 do not get it
    for (const [t, rh] of [[100, 13], [114, 5]]) {
      const a = await page.evaluate(([T, R]) => (window as any).__heat.adjustment(T, R), [t, rh]);
      expect(a.kind, `${t}/${rh}`).toBe('none');
    }
  });

  test('high-humidity adjustment: RH > 85 % between 80 and 87 °F', async ({ page }) => {
    await page.goto(URL);
    await set(page, 82, 95);
    await expect(page.getByTestId('adj')).toHaveText('high-humidity: +1.00 °F'); // (10/10)·(5/5)
    const L = await page.evaluate(() => (window as any).__heat.last);
    expect(L.hi - L.full).toBeCloseTo(1, 9);
    await expect(page.getByTestId('step-adj')).not.toHaveClass(/off/);
    for (const [t, rh] of [[82, 85], [88, 95]]) {
      const a = await page.evaluate(([T, R]) => (window as any).__heat.adjustment(T, R), [t, rh]);
      expect(a.kind, `${t}/${rh}`).toBe('none');
    }
  });

  test('heat map: every cell is coloured by its NWS band, and a tap loads it', async ({ page }) => {
    await page.goto(URL);
    const cells = page.locator('#map rect.cell');
    await expect(cells).toHaveCount(17 * 21);                  // 80–112 °F by 2, 0–100 % by 5
    const data = await cells.evaluateAll((els) => els.map((e) => [+e.getAttribute('data-t')!, +e.getAttribute('data-rh')!, +e.getAttribute('data-band')!]));
    const seen = new Set<number>();
    for (const [t, rh, b] of data) { expect(b, `${t}/${rh}`).toBe(bandOf(nws(t, rh).hi)); seen.add(b); }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    await page.locator('#map rect.cell[data-t="96"][data-rh="65"]').click();
    await expect(page.getByTestId('t')).toHaveValue('96');
    await expect(page.getByTestId('rh')).toHaveValue('65');
    await expect(page.getByTestId('hi')).toHaveText(`${Math.round(nws(96, 65).hi)} °F`);
    await expect(page.getByTestId('marker')).toHaveAttribute('data-inside', 'true');
  });

  test('Austin summer afternoon preset lands in the danger band', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-muggy').click();
    await page.getByTestId('preset-austin').click();
    await expect(page.getByTestId('preset-austin')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('preset-muggy')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('t')).toHaveValue('98');
    await expect(page.getByTestId('rh')).toHaveValue('40');
    await expect(page.getByTestId('hi')).toHaveText(`${Math.round(nws(98, 40).hi)} °F`);
    await expect(page.getByTestId('band')).toHaveText('Danger');
    await expect(page.getByTestId('result')).toHaveAttribute('data-band', '3');
    await expect(page.getByTestId('map')).toHaveAttribute('aria-label', /danger/);
  });

  test('°C mode converts input and output but computes in °F', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('unit-c').click();
    await expect(page.getByTestId('unit-c')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('t')).toHaveValue('36.7');                   // 98 °F
    await expect(page.getByTestId('hi')).toHaveText(`${toC(nws(98, 40).hi).toFixed(0)} °C`);
    await set(page, 35, 60);                                                     // 35 °C = 95 °F
    const L = await page.evaluate(() => (window as any).__heat.last);
    expect(L.T).toBeCloseTo(95, 9);
    await expect(page.getByTestId('hi')).toHaveText(`${toC(nws(95, 60).hi).toFixed(0)} °C`);
    await expect(page.getByTestId('row-100')).toHaveText(String(Math.round(toC(nws(100, 60).hi))));
    await page.getByTestId('unit-f').click();
    await expect(page.getByTestId('t')).toHaveValue('95');
  });

  test('keyboard: arrow keys on the sliders step the inputs; the result is a live region', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('result')).toHaveAttribute('aria-live', 'polite');
    await page.getByTestId('t-range').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('t')).toHaveValue('99');
    await page.getByTestId('rh-range').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('rh')).toHaveValue('38');
    await expect(page.getByTestId('hi')).toHaveText(`${Math.round(nws(99, 38).hi)} °F`);
    await expect(page.getByTestId('row-100')).toHaveText(String(Math.round(nws(100, 38).hi)));
    await expect(page.getByLabel('Relative humidity (%)')).toBeVisible();
  });
});
