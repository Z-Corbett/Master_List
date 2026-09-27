import { test, expect, Page } from '@playwright/test';

const URL = '/lab/121-moon-phases.html';
const MIN = 60_000;
const last = (page: Page) => page.evaluate(() => (window as any).__moon.last);

// Published reference instants (UTC), from the USNO / NASA phase tables. Meeus's series should land within a
// couple of minutes of these; the spec allows 3.
const REF = {
  full_2026_01_03: Date.UTC(2026, 0, 3, 10, 3),
  lq_2026_01_10: Date.UTC(2026, 0, 10, 15, 48),
  new_2026_01_18: Date.UTC(2026, 0, 18, 19, 52),
  fq_2026_01_26: Date.UTC(2026, 0, 26, 4, 47),
  full_2026_03_03: Date.UTC(2026, 2, 3, 11, 38),      // total lunar eclipse
  new_2024_04_08: Date.UTC(2024, 3, 8, 18, 21),       // total solar eclipse over North America
  full_2026_05_01: Date.UTC(2026, 4, 1, 17, 23),
  full_2026_05_31: Date.UTC(2026, 4, 31, 8, 45),      // the blue moon of 2026
};
const TOL = 3 * MIN;

async function at(page: Page, iso: string, url = URL) {
  await page.clock.install({ time: new Date(iso) });
  await page.goto(url);
  await page.clock.pauseAt(new Date(new Date(iso).getTime() + 1000));
}

test.describe('121 Moon Phases', () => {
  test("Meeus's example 49.a: the new moon of 1977 Feb 18 is JDE 2443192.65118", async ({ page }) => {
    await page.goto(URL);
    // k = −283 is the new moon of mid-February 1977 in Meeus's numbering; the book gives JDE 2443192.65118
    const jde = await page.evaluate(() => (window as any).__moon.phaseJDE(-283));
    expect(Math.abs(jde - 2443192.65118)).toBeLessThan(0.00002);
    await expect(page.getByTestId('meeus-check')).toHaveText('2443192.65118');
    // ΔT is about a minute near 2000–2026, never hours
    const dt = await page.evaluate(() => [(window as any).__moon.deltaT(2000), (window as any).__moon.deltaT(2026)]);
    expect(dt[0]).toBeGreaterThan(62);
    expect(dt[0]).toBeLessThan(66);
    expect(dt[1]).toBeGreaterThan(66);
    expect(dt[1]).toBeLessThan(74);
  });

  test('January 2026: every principal phase within 3 minutes of the published UTC times', async ({ page }) => {
    await at(page, '2026-01-01T00:00:00Z');
    await expect(page.getByTestId('cal-title')).toHaveText('January 2026');
    const ev = (await last(page)).month.events;
    expect(ev.map((e: any) => e.name)).toEqual(['Full Moon', 'Last Quarter', 'New Moon', 'First Quarter']);
    expect(ev.map((e: any) => e.day)).toEqual([3, 10, 18, 26]);
    const want = [REF.full_2026_01_03, REF.lq_2026_01_10, REF.new_2026_01_18, REF.fq_2026_01_26];
    ev.forEach((e: any, i: number) => expect(Math.abs(e.t - want[i])).toBeLessThan(TOL));
    // printed on the calendar in UTC hours and minutes
    await expect(page.getByTestId('ev-3')).toHaveText(/^Full 10:0[1-6]$/);
    await expect(page.getByTestId('ev-18')).toHaveText(/^New 19:(49|5\d)$/);
    await expect(page.getByTestId('day-18')).toHaveAttribute('aria-label', /New Moon at 19:\d\d UTC/);
    await expect(page.getByTestId('day-4')).not.toHaveClass(/has-ev/);
  });

  test('the next four principal phases follow the pinned clock, in order', async ({ page }) => {
    await at(page, '2026-01-01T00:00:00Z');
    const items = page.getByTestId('next-phases').locator('li');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText('Full Moon');
    await expect(items.nth(0)).toContainText('Sat 3 Jan 2026');
    await expect(items.nth(1)).toContainText('Last Quarter');
    await expect(items.nth(2)).toContainText('New Moon');
    await expect(items.nth(2)).toContainText('Sun 18 Jan 2026, 19:5');
    await expect(items.nth(3)).toContainText('First Quarter');
    const t = await items.evaluateAll((li) => li.map((l) => +(l as HTMLElement).dataset.ms!));
    const want = [REF.full_2026_01_03, REF.lq_2026_01_10, REF.new_2026_01_18, REF.fq_2026_01_26];
    t.forEach((x, i) => expect(Math.abs(x - want[i])).toBeLessThan(TOL));
    // consecutive principal phases are 6.5 to 8.5 days apart (a quarter of a 29.53-day month, give or take)
    for (let i = 1; i < 4; i++) { const d = (t[i] - t[i - 1]) / 864e5; expect(d).toBeGreaterThan(6.4); expect(d).toBeLessThan(8.6); }
    await expect(items.nth(0)).toContainText('in 2.4 d');                  // 3 Jan 10:03 − 1 Jan 00:00 = 2.42 d
  });

  test('illuminated fraction: ~0 at new, ~1 at full, ~½ at the quarters; Meeus 48.a gives 0.679', async ({ page }) => {
    await page.goto(URL);
    const il = (ms: number) => page.evaluate((ms) => (window as any).__moon.illum(ms), ms);
    expect((await il(REF.new_2026_01_18)).k).toBeLessThan(0.003);
    expect((await il(REF.full_2026_01_03)).k).toBeGreaterThan(0.997);
    const fq = await il(REF.fq_2026_01_26), lq = await il(REF.lq_2026_01_10);
    expect(Math.abs(fq.k - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(lq.k - 0.5)).toBeLessThan(0.02);
    expect(fq.waxing).toBe(true);
    expect(lq.waxing).toBe(false);
    // Meeus example 48.a: 1992 April 12, 0h TD → k = 0.6786 (the short series used here gives 0.680)
    const tt = Date.UTC(1992, 3, 12) - 58.5 * 1000;                        // 0h TD in UT (ΔT ≈ 58.5 s)
    const ex = await il(tt);
    expect(Math.abs(ex.k - 0.6786)).toBeLessThan(0.003);
    // and via the UI: pick the date in the inputs
    await page.getByTestId('date').fill('1992-04-12');
    await page.getByTestId('time').fill('00:00');
    await page.getByTestId('time').dispatchEvent('change');
    await expect(page.getByTestId('illum')).toHaveText(/^68\.0% · waxing$/);
    await expect(page.getByTestId('cal-title')).toHaveText('April 1992');
    await expect(page.getByTestId('phase-name')).toHaveText('Waxing Gibbous');
  });

  test('phase name, age and glyph for a chosen instant', async ({ page }) => {
    await at(page, '2026-01-06T12:00:00Z');
    await expect(page.getByTestId('phase-name')).toHaveText('Waning Gibbous');
    // age: days since the new moon of 20 Dec 2025, 01:43 UTC (USNO)
    const age = (Date.UTC(2026, 0, 6, 12) - Date.UTC(2025, 11, 20, 1, 43)) / 864e5;
    const shown = parseFloat((await page.getByTestId('age').textContent())!);
    expect(Math.abs(shown - age)).toBeLessThan(0.01);
    await expect(page.getByTestId('instant')).toHaveText('Tue 6 Jan 2026, 12:00 UTC');
    const g = page.getByTestId('big-moon').locator('g');
    await expect(g).toHaveAttribute('data-waxing', 'false');
    const f = +(await g.getAttribute('data-frac'))!;
    expect(f).toBeGreaterThan(0.8);
    expect(f).toBeLessThan(0.95);
    await expect(page.getByTestId('big-moon')).toHaveAttribute('aria-label', /Waning Gibbous, \d+\.\d% illuminated, waning/);
    // within 12 hours of the full moon the page names the principal phase
    await page.getByTestId('date').fill('2026-01-03');
    await page.getByTestId('time').fill('16:00');
    await page.getByTestId('time').dispatchEvent('change');
    await expect(page.getByTestId('phase-name')).toHaveText('Full Moon');
    // and the calendar marks the selected day
    await expect(page.getByTestId('day-3')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('day-3')).toHaveClass(/sel/);
  });

  test('the year strip: 2026 has 13 full moons, and 31 May is a blue moon', async ({ page }) => {
    await at(page, '2026-09-26T00:00:00Z');
    await expect(page.getByTestId('year-title')).toHaveText('The year 2026');
    const y = (await last(page)).year;
    expect(y.full).toHaveLength(13);
    expect(y.new).toHaveLength(12);
    expect(y.blue).toHaveLength(1);
    expect(Math.abs(y.blue[0] - REF.full_2026_05_31)).toBeLessThan(TOL);
    expect(y.full.some((t: number) => Math.abs(t - REF.full_2026_05_01) < TOL)).toBe(true);
    expect(y.full.some((t: number) => Math.abs(t - REF.full_2026_03_03) < TOL)).toBe(true);
    await expect(page.getByTestId('yrow-5')).toContainText('blue');
    await expect(page.getByTestId('year-summary')).toContainText('Blue moon (second full moon in a calendar month): Sun 31 May 2026, 08:4');
    await expect(page.getByTestId('year-strip').locator('circle[data-kind="full"]')).toHaveCount(13);
    await expect(page.getByTestId('year-strip')).toHaveAttribute('aria-label', /13 full moons and 12 new moons; blue moon on 31 May/);
    // 2025 had no calendar-month blue moon
    await page.getByTestId('prev-year').click();
    await expect(page.getByTestId('year-title')).toHaveText('The year 2025');
    await expect(page.getByTestId('year-summary')).toContainText('No calendar-month blue moon');
  });

  test('UTC throughout: the same day and time in Kiritimati (UTC+14) and Honolulu (UTC−10)', async ({ browser, baseURL }) => {
    for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Honolulu']) {
      const ctx = await browser.newContext({ timezoneId, baseURL });
      const p = await ctx.newPage();
      await p.clock.install({ time: new Date('2026-01-18T20:30:00Z') });  // 19 Jan 10:30 local in Kiritimati
      await p.goto(URL);
      await p.clock.pauseAt(new Date('2026-01-18T20:30:01Z'));
      expect(await p.evaluate(() => new Date().getDate())).toBe(timezoneId === 'Pacific/Kiritimati' ? 19 : 18);
      await expect(p.getByTestId('instant')).toHaveText('Sun 18 Jan 2026, 20:30 UTC');
      await expect(p.getByTestId('date')).toHaveValue('2026-01-18');
      await expect(p.getByTestId('time')).toHaveValue('20:30');
      await expect(p.getByTestId('phase-name')).toHaveText('New Moon');
      await expect(p.getByTestId('ev-18')).toHaveText(/^New 19:5\d$/);
      await expect(p.getByTestId('day-18')).toHaveAttribute('aria-selected', 'true');
      await ctx.close();
    }
  });

  test('month navigation, 2024 eclipse new moon, and keyboard movement in the calendar', async ({ page }) => {
    await at(page, '2024-03-15T00:00:00Z');
    await page.getByTestId('next-month').click();
    await expect(page.getByTestId('cal-title')).toHaveText('April 2024');
    const ev = (await last(page)).month.events;
    const nm = ev.find((e: any) => e.name === 'New Moon');
    expect(nm.day).toBe(8);
    expect(Math.abs(nm.t - REF.new_2024_04_08)).toBeLessThan(TOL);
    await expect(page.getByTestId('day-8')).toHaveClass(/has-ev/);
    // 1 April 2024 was a Monday: one blank before it in a Sunday-first grid
    await expect(page.getByTestId('calendar').locator('.day.blank')).toHaveCount(1);
    // December → January crosses the year
    for (let i = 0; i < 8; i++) await page.getByTestId('next-month').click();
    await expect(page.getByTestId('cal-title')).toHaveText('December 2024');
    await page.getByTestId('next-month').click();
    await expect(page.getByTestId('cal-title')).toHaveText('January 2025');
    await expect(page.getByTestId('year-title')).toHaveText('The year 2025');
    // arrows move a single tab stop around the days; clicking a day selects it
    await page.getByTestId('day-1').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('day-9')).toBeFocused();
    await expect(page.getByTestId('calendar').locator('.day[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('date')).toHaveValue('2025-01-09');
    await expect(page.getByTestId('day-9')).toBeFocused();
    await expect(page.getByTestId('day-9')).toHaveAttribute('aria-selected', 'true');
  });

  test('the Now button returns to the pinned clock; the Easter note links to the computus page', async ({ page }) => {
    await at(page, '2026-09-26T16:00:00Z');
    await expect(page.getByTestId('phase-name')).toHaveText('Full Moon');     // 26 Sep 2026 16:49 UTC
    await expect(page.getByTestId('utc-badge')).toHaveText('ALL TIMES UTC');
    await page.getByTestId('date').fill('2000-01-01');
    await page.getByTestId('date').dispatchEvent('change');
    await expect(page.getByTestId('cal-title')).toHaveText('January 2000');
    await page.getByTestId('now').click();
    await expect(page.getByTestId('cal-title')).toHaveText('September 2026');
    await expect(page.getByTestId('instant')).toHaveText('Sat 26 Sep 2026, 16:00 UTC');
    const note = page.getByTestId('easter-note');
    await expect(note).toContainText('ecclesiastical');
    await expect(note).toContainText('not from the sky');
    const link = page.getByTestId('easter-link');
    await expect(link).toHaveAttribute('href', '../lab/106-easter-dates.html');
    await link.click();
    await expect(page).toHaveURL(/\/lab\/106-easter-dates\.html(\?.*)?$/);   // that page writes ?year= itself
    await expect(page).toHaveTitle(/Easter/);
  });
});
