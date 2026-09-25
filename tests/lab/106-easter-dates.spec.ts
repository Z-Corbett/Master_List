import { test, expect, Page } from '@playwright/test';

const URL = '/lab/106-easter-dates.html';
const fl = Math.floor;

// Oracle 1: Gauss's Easter algorithm (with its two Gregorian exceptions), a different method from the page's Meeus/Jones/Butcher.
function gauss(Y: number): [number, number] {
  const a = Y % 19, b = Y % 4, c = Y % 7, k = fl(Y / 100), p = fl((13 + 8 * k) / 25), q = fl(k / 4);
  const M = (15 - p + k - q) % 30, N = (4 + k - q) % 7;
  const d = (19 * a + M) % 30, e = (2 * b + 4 * c + 6 * d + N) % 7;
  if (d === 29 && e === 6) return [4, 19];
  if (d === 28 && e === 6 && (11 * M + 11) % 30 < 19) return [4, 18];
  const n = 22 + d + e;
  return n > 31 ? [4, n - 31] : [3, n];
}
// Oracle 2: Orthodox Easter = Julian computus + the century-rule gap between the calendars (valid for March–May dates).
function orthodoxOracle(Y: number): string {
  const a = Y % 4, b = Y % 7, c = Y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const gap = fl(Y / 100) - fl(Y / 400) - 2;
  return new Date(Date.UTC(Y, 2, 22 + d + e + gap)).toISOString().slice(0, 10);
}
const isoOf = (Y: number, [m, d]: [number, number]) => `${Y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const shift = (isoDate: string, n: number) => new Date(Date.parse(isoDate + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function open(page: Page, year?: number) {
  await page.goto(URL + (year ? `?year=${year}` : ''));
}

test.describe('106 Easter Dates', () => {
  test('published reference dates for Western and Orthodox Easter', async ({ page }) => {
    await open(page, 2026);
    const cases: [number, string, string][] = [
      [2026, '2026-04-05', '2026-04-12'], [2025, '2025-04-20', '2025-04-20'], [2019, '2019-04-21', '2019-04-28'],
      [2038, '2038-04-25', ''], [2285, '2285-03-22', ''], [1818, '1818-03-22', ''],
    ];
    for (const [y, w, o] of cases) {
      await page.getByTestId('year').fill(String(y));
      await expect(page.getByTestId('western-iso')).toHaveText(w);
      if (o) await expect(page.getByTestId('orthodox-julian')).toContainText(o);
    }
    await page.getByTestId('year').fill('2025');
    await expect(page.getByTestId('same')).toHaveText('In 2025 both churches keep Easter on the same Sunday.');
    await page.getByTestId('year').fill('2026');
    await expect(page.getByTestId('western')).toHaveText('Sunday, April 5');
    await expect(page.getByTestId('orthodox')).toHaveText('Sunday, April 12');
    await expect(page.getByTestId('orthodox-julian')).toContainText('Julian calendar: March 30');
    await expect(page.getByTestId('same')).toContainText('1 week after');
  });

  test('intermediate variables for 2026 follow the Meeus/Jones/Butcher steps', async ({ page }) => {
    await open(page, 2026);
    const Y = 2026;
    const a = Y % 19, b = fl(Y / 100), c = Y % 100, d = fl(b / 4), e = b % 4, f = fl((b + 8) / 25), g = fl((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = fl(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = fl((a + 11 * h + 22 * l) / 451);
    const want: Record<string, number> = { a, b, c, d, e, f, g, h, i, k, l, m, month: fl((h + l - 7 * m + 114) / 31), day: ((h + l - 7 * m + 114) % 31) + 1 };
    expect(want).toMatchObject({ a: 12, b: 20, c: 26, h: 12, l: 2, m: 0, month: 4, day: 5 });
    for (const [key, v] of Object.entries(want)) await expect(page.getByTestId(`g-${key}`)).toHaveText(String(v));
    // Julian side: d = (19·12 + 15) mod 30 = 3, e = (2·2 + 4·3 − 3 + 34) mod 7 = 5 → March 30 (Julian), +13 days
    await expect(page.getByTestId('j-d')).toHaveText('3');
    await expect(page.getByTestId('j-e')).toHaveText('5');
    await expect(page.getByTestId('j-month')).toHaveText('3');
    await expect(page.getByTestId('j-day')).toHaveText('30');
    await expect(page.getByTestId('j-offset')).toHaveText('+13 days');
  });

  test('every year 1583–4099 agrees with Gauss\'s algorithm and falls on a Sunday', async ({ page }) => {
    await open(page);
    const got: [number, number][] = await page.evaluate(() => {
      const out: [number, number][] = [];
      for (let y = 1583; y <= 4099; y++) { const r = (window as any).__easter.western(y); out.push([r.month, r.day]); }
      return out;
    });
    expect(got).toHaveLength(4099 - 1583 + 1);
    const bad: string[] = [];
    got.forEach(([m, d], idx) => {
      const Y = 1583 + idx, [gm, gd] = gauss(Y);
      if (m !== gm || d !== gd) bad.push(`${Y}: ${m}/${d} vs Gauss ${gm}/${gd}`);
      if (new Date(Date.UTC(Y, m - 1, d)).getUTCDay() !== 0) bad.push(`${Y}: not a Sunday`);
    });
    expect(bad).toEqual([]);
  });

  test('Orthodox Easter: Julian computus converted to Gregorian, every year, never before Western', async ({ page }) => {
    await open(page);
    const got: [string, number][] = await page.evaluate(() => {
      const E = (window as any).__easter, out: [string, number][] = [];
      for (let y = 1583; y <= 4099; y++) {
        const o = E.orthodox(y);
        out.push([`${o.year}-${String(o.month).padStart(2, '0')}-${String(o.day).padStart(2, '0')}`, o.offset]);
      }
      return out;
    });
    // collect mismatches and assert once: thousands of individual expect() calls are slow
    const bad: string[] = [];
    got.forEach(([iso, offset], idx) => {
      const Y = 1583 + idx;
      if (iso !== orthodoxOracle(Y)) bad.push(`${Y}: ${iso} vs ${orthodoxOracle(Y)}`);
      if (offset !== fl(Y / 100) - fl(Y / 400) - 2) bad.push(`${Y}: offset ${offset}`);
      if (new Date(iso + 'T00:00:00Z').getUTCDay() !== 0) bad.push(`${Y}: not a Sunday`);
      if (iso < isoOf(Y, gauss(Y))) bad.push(`${Y}: before Western`);
    });
    expect(got).toHaveLength(2517);
    expect(bad).toEqual([]);
    // the calendars move from 13 to 14 days apart in 2100
    await page.getByTestId('year').fill('2100');
    await expect(page.getByTestId('j-offset')).toHaveText('+14 days');
    await expect(page.getByTestId('orthodox-julian')).toContainText(orthodoxOracle(2100));
  });

  test('distribution over 1583–4099: 35 dates, March 22 to April 25, counts match the oracle', async ({ page }) => {
    await open(page, 2285);
    const counts = new Map<string, number>();
    for (let y = 1583; y <= 4099; y++) { const [m, d] = gauss(y); counts.set(`${m}-${d}`, (counts.get(`${m}-${d}`) || 0) + 1); }
    const bars = page.locator('[data-testid^="bar-"]');
    await expect(bars).toHaveCount(35);
    await expect(page.getByTestId('bar-3-22')).toHaveAttribute('data-count', String(counts.get('3-22')));
    await expect(page.getByTestId('bar-4-25')).toHaveAttribute('data-count', String(counts.get('4-25')));
    const all = await bars.evaluateAll((els) => els.map((e) => [e.getAttribute('data-testid')!.slice(4), Number(e.getAttribute('data-count'))] as [string, number]));
    for (const [k, v] of all) expect(v, k).toBe(counts.get(k) || 0);
    expect(all.reduce((s, [, v]) => s + v, 0)).toBe(2517);
    await expect(page.getByTestId('stat-years')).toHaveText('2517');
    await expect(page.getByTestId('stat-earliest')).toHaveText('March 22');
    await expect(page.getByTestId('stat-latest')).toHaveText('April 25');
    const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split('-').map(Number);
    await expect(page.getByTestId('stat-mode')).toHaveText(`${['March', 'April'][mode[0] - 3]} ${mode[1]}`);
    // the chosen year (2285, March 22) is the highlighted bar
    await expect(page.getByTestId('bar-3-22')).toHaveAttribute('data-current', 'true');
  });

  test('a narrower range recounts; a backwards range is refused', async ({ page }) => {
    await open(page, 2026);
    await page.getByTestId('from').fill('2000');
    await page.getByTestId('to').fill('2099');
    await expect(page.getByTestId('stat-years')).toHaveText('100');
    const counts = new Map<string, number>();
    for (let y = 2000; y <= 2099; y++) { const [m, d] = gauss(y); counts.set(`${m}-${d}`, (counts.get(`${m}-${d}`) || 0) + 1); }
    for (const k of ['3-23', '3-31', '4-5', '4-16', '4-25']) await expect(page.getByTestId(`bar-${k}`)).toHaveAttribute('data-count', String(counts.get(k) || 0));
    await expect(page.getByTestId('bar-3-22')).toHaveAttribute('data-count', '0');   // no March 22 Easter this century
    await page.getByTestId('from').fill('2200');
    await expect(page.getByTestId('range-err')).toContainText('forwards');
    await expect(page.getByTestId('stat-years')).toHaveText('100');
    await page.getByTestId('range-full').click();
    await expect(page.getByTestId('stat-years')).toHaveText('2517');
    await expect(page.getByTestId('range-err')).toHaveText('');
  });

  test('movable feasts are derived from Easter by fixed offsets (2026)', async ({ page }) => {
    await open(page, 2026);
    const easter = isoOf(2026, gauss(2026));
    const want: Record<string, [number, string]> = {
      ash: [-46, 'Wed'], palm: [-7, 'Sun'], goodfriday: [-2, 'Fri'], easter: [0, 'Sun'],
      ascension: [39, 'Thu'], pentecost: [49, 'Sun'], trinity: [56, 'Sun'], corpus: [60, 'Thu'],
    };
    for (const [key, [off, wd]] of Object.entries(want)) {
      const [, m, d] = shift(easter, off).split('-').map(Number);
      await expect(page.getByTestId(`feast-${key}-date`), key).toHaveText(`${wd} ${MON[m - 1]} ${d}`);
    }
    // cross-check against the published 2026 calendar
    await expect(page.getByTestId('feast-ash-date')).toHaveText('Wed Feb 18');
    await expect(page.getByTestId('feast-pentecost-date')).toHaveText('Sun May 24');
    await expect(page.getByTestId('feast-ascension-date')).toHaveText('Thu May 14');
    await expect(page.getByTestId('feast-corpus-date')).toHaveText('Thu Jun 4');
  });

  test('defaults to the current year from the (fake) clock; This year returns to it', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-01-10T12:00:00Z') });
    await page.goto(URL);
    await expect(page.getByTestId('year')).toHaveValue('2027');
    await expect(page.getByTestId('western-iso')).toHaveText(isoOf(2027, gauss(2027)));   // 2027-03-28
    await expect(page.getByTestId('western-iso')).toHaveText('2027-03-28');
    await expect(page.getByTestId('orthodox-julian')).toContainText(orthodoxOracle(2027)); // 2027-05-02
    await page.getByTestId('next').click();
    await page.getByTestId('next').click();
    await expect(page.getByTestId('year')).toHaveValue('2029');
    await page.getByTestId('this-year').click();
    await expect(page.getByTestId('year')).toHaveValue('2027');
  });

  test('out-of-range years are refused with a message; prev and next stop at the ends', async ({ page }) => {
    await open(page, 4099);
    await expect(page.getByTestId('western-iso')).toHaveText(isoOf(4099, gauss(4099)));
    await page.getByTestId('next').click();
    await expect(page.getByTestId('year')).toHaveValue('4099');
    await page.getByTestId('year').fill('1500');
    await expect(page.getByTestId('year-err')).toHaveText('Enter a whole year from 1583 to 4099.');
    await expect(page.getByTestId('western-iso')).toHaveText(isoOf(4099, gauss(4099)));  // unchanged
    await page.getByTestId('year').fill('1583');
    await expect(page.getByTestId('year-err')).toHaveText('');
    await expect(page.getByTestId('western-iso')).toHaveText(isoOf(1583, gauss(1583)));
    await page.getByTestId('prev').click();
    await expect(page.getByTestId('year')).toHaveValue('1583');
    await expect(page.getByTestId('dates')).toHaveAttribute('aria-live', 'polite');
  });

  test('Orthodox distribution toggle shows later Gregorian dates', async ({ page }) => {
    await open(page, 2026);
    await page.getByTestId('kind-orthodox').click();
    await expect(page.getByTestId('kind-orthodox')).toHaveAttribute('aria-pressed', 'true');
    const seen = new Set<string>();
    for (let y = 1583; y <= 4099; y++) seen.add(orthodoxOracle(y).slice(5));
    const sorted = [...seen].sort();
    const label = (md: string) => { const [m, d] = md.split('-').map(Number); return `${['March', 'April', 'May'][m - 3]} ${d}`; };
    await expect(page.getByTestId('stat-earliest')).toHaveText(label(sorted[0]));
    await expect(page.getByTestId('stat-latest')).toHaveText(label(sorted[sorted.length - 1]));
    await expect(page.getByTestId('bar-4-12')).toHaveAttribute('data-current', 'true');   // Orthodox 2026
    await expect(page.getByTestId('chart')).toHaveAttribute('aria-label', /^Orthodox/);
  });
});
