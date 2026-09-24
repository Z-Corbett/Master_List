import { test, expect, Page } from '@playwright/test';

const URL = '/lab/097-sundial.html';
const last = (page: Page) => page.evaluate(() => (window as any).__sundial.last);
const rad = (d: number) => (d * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;

async function at(page: Page, iso: string) {
  await page.clock.install({ time: new Date(iso) });
  await page.goto(URL);
  await page.clock.pauseAt(new Date(new Date(iso).getTime() + 1000));
}

test.describe('097 Sundial', () => {
  test('hour lines follow tan θ = sin φ · tan h, and the gnomon is set at the latitude', async ({ page }) => {
    await at(page, '2026-06-21T18:00:00Z');
    const check = async (lat: number) => {
      await expect(page.getByTestId('gnomon')).toHaveText(`${Math.abs(lat).toFixed(2)}°`);
      const rows = page.locator('[data-testid^="row-"]');
      const n = await rows.count();
      expect(n).toBeGreaterThanOrEqual(13);
      for (const hr of [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]) {
        const h = (hr - 12) * 15;
        const want = deg(Math.atan(Math.sin(rad(lat)) * Math.tan(rad(h))));
        const got = parseFloat((await page.getByTestId(`theta-${hr}`).textContent())!);
        expect(Math.abs(got - want)).toBeLessThan(0.006);
      }
      await expect(page.getByTestId('theta-6')).toHaveText(lat > 0 ? '-90.00°' : '90.00°');
    };
    await check(30.2672);                                           // Austin
    await page.getByTestId('preset-greenwich').click();
    await expect(page.getByTestId('lat')).toHaveValue('51.4769');
    await check(51.4769);
    // at 51.5° N the midsummer sun is up before 5 and after 7, so those lines appear too
    await expect(page.getByTestId('row-4')).toHaveCount(1);
    await expect(page.getByTestId('row-20')).toHaveCount(1);
    // any latitude typed in by hand
    await page.getByTestId('lat').fill('40');
    await check(40);
    await expect(page.getByTestId('preset-austin')).toHaveAttribute('aria-pressed', 'false');
  });

  test('NOAA solar position: Austin at the June solstice, near solar noon', async ({ page }) => {
    await at(page, '2026-06-21T18:33:00Z');                          // 1:33 PM CDT
    const L = await last(page);
    expect(L.sun.decl).toBeGreaterThan(23.42);
    expect(L.sun.decl).toBeLessThan(23.45);
    expect(L.sun.elev).toBeGreaterThan(82.9);                        // 90 − (30.27 − 23.44) ≈ 83.2
    expect(L.sun.elev).toBeLessThan(83.4);
    expect(L.sun.eot).toBeGreaterThan(-2.3);                          // about −1.8 min on 21 June
    expect(L.sun.eot).toBeLessThan(-1.4);
    await expect(page.getByTestId('solar-noon')).toHaveText(/^1:3[23] PM$/);
    await expect(page.getByTestId('dial-reading')).toHaveText(/^1[12]:\d\d [AP]M$/);
    await expect(page.getByTestId('clock-time')).toHaveText('1:33 PM (daylight)');
    await expect(page.getByTestId('lon-corr')).toHaveText('−30m 58s');   // 4 min × (−97.7431 − (−90))
    // the shadow lies on the noon line within a degree
    expect(Math.abs(L.shadowTheta)).toBeLessThan(1);
    await expect(page.getByTestId('shadow')).toHaveCount(1);
    await expect(page.getByTestId('dial')).toHaveAttribute('aria-label', /gnomon at 30\.27°/);
  });

  test('clock time = dial − equation of time − longitude correction (+ daylight)', async ({ page }) => {
    await at(page, '2026-11-03T21:00:00Z');                          // 3:00 PM CST, EoT near its November peak
    let L = await last(page);
    expect(L.sun.eot).toBeGreaterThan(16.2);
    expect(L.sun.eot).toBeLessThan(16.6);
    expect(L.dst).toBe(0);
    await expect(page.getByTestId('clock-time')).toHaveText('3:00 PM');
    // dial − EoT − lonCorr gives the clock back, to the second
    const clock = L.dialMin - L.sun.eot - L.lonCorr + L.dst;
    expect(Math.abs(clock - L.clockMin)).toBeLessThan(0.02);
    await expect(page.getByTestId('eot')).toHaveText(/^\+16m \d\ds$/);
    // year extremes on the analemma
    expect(L.ext.max).toBeGreaterThan(16.3);
    expect(L.ext.min).toBeLessThan(-14);
    const maxDay = new Date(L.ext.maxMs).getUTCMonth() * 100 + new Date(L.ext.maxMs).getUTCDate();
    expect(maxDay).toBeGreaterThanOrEqual(1001);                     // early November
    expect(maxDay).toBeLessThanOrEqual(1006);
    await expect(page.getByTestId('analemma')).toHaveAttribute('aria-label', /Feb/);
    // daylight saving: in summer US rules add an hour; switching rules off removes it
    await page.getByTestId('date').fill('2026-07-04');
    await page.getByTestId('time').fill('12:00');
    L = await last(page);
    expect(L.dst).toBe(60);
    await expect(page.getByTestId('clock-time')).toHaveText('12:00 PM (daylight)');
    await page.getByTestId('dst').selectOption('none');
    L = await last(page);
    expect(L.dst).toBe(0);
    await expect(page.getByTestId('conversion')).not.toContainText('daylight');
  });

  test('picked dates and the Now button; night has no shadow', async ({ page }) => {
    await at(page, '2026-06-21T08:00:00Z');                          // 3 AM in Austin
    await expect(page.getByTestId('dial-reading')).toHaveText('Night: the sun is down');
    await expect(page.getByTestId('shadow')).toHaveCount(0);
    expect((await last(page)).sun.elev).toBeLessThan(0);
    await expect(page.getByTestId('dial')).toHaveAttribute('aria-label', /no shadow/);
    // pick the spring equinox at 9 AM: the sun is up, morning shadow lies west of the noon line
    await page.getByTestId('date').fill('2026-03-20');
    await page.getByTestId('time').fill('09:00');
    let L = await last(page);
    expect(Math.abs(L.sun.decl)).toBeLessThan(0.5);
    expect(L.sun.elev).toBeGreaterThan(0);
    expect(L.shadowTheta).toBeLessThan(0);
    await expect(page.getByTestId('dial')).toHaveAttribute('aria-label', /west of the noon line/);
    // back to now (still the pinned fake clock: night)
    await page.getByTestId('now').click();
    L = await last(page);
    expect(L.sun.elev).toBeLessThan(0);
    await expect(page.getByTestId('date')).toHaveValue('2026-06-21');
  });

  test('southern hemisphere turns the dial round; the equator is refused', async ({ page }) => {
    await at(page, '2026-12-21T01:55:00Z');                          // Sydney solar noon, about 12:55 PM daylight time
    await page.getByTestId('preset-sydney').click();
    await expect(page.getByTestId('orientation')).toContainText('true south');
    const L = await last(page);
    expect(L.dst).toBe(60);                                          // Australian summer time
    expect(L.sun.elev).toBeGreaterThan(79.3);                        // 90 − (33.87 − 23.44) ≈ 79.6
    // morning lines now fall on the other side: θ for 9 AM is positive
    expect(parseFloat((await page.getByTestId('theta-9').textContent())!)).toBeGreaterThan(0);
    await expect(page.getByTestId('gnomon')).toHaveText('33.87°');
    await page.getByTestId('lat').fill('4');
    await expect(page.getByTestId('warn')).toContainText('Too close to the equator');
    await page.getByTestId('lat').fill('70');
    await expect(page.getByTestId('warn')).toContainText('Above 65°');
    await page.getByTestId('lat').fill('35');
    await expect(page.getByTestId('warn')).toHaveText('');
  });
});
