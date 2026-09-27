import { test, expect, Page } from '@playwright/test';

const URL = '/lab/127-magic-city-bike-coop.html';
const B = (page: Page) => page.evaluate(() => { const b = (window as any).__bike; return { slots: b.slots, bookings: b.bookings, selection: b.selection }; });

/** Fake clock paused at an exact UTC instant (on a whole minute), then one 15 s refresh tick, so "open now" is known. */
async function at(page: Page, iso: string) {
  await page.clock.install({ time: new Date(Date.parse(iso) - 600_000) });
  await page.goto(URL);
  await page.clock.pauseAt(new Date(iso));
  await page.clock.runFor(15_000);                                    // the sign re-renders within [iso, iso + 15 s)
}

// Independent oracle for US Central time: UTC−5 (CDT) from 2 a.m. on the second Sunday in March
// until 2 a.m. on the first Sunday in November, UTC−6 (CST) otherwise (Energy Policy Act of 2005 rules).
function centralOffsetHours(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  const nthSunday = (month: number, n: number) => { const first = new Date(Date.UTC(y, month, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + 7 * (n - 1); };
  const start = Date.UTC(y, 2, nthSunday(2, 2), 2 + 6);     // 2:00 CST = 08:00 UTC
  const end = Date.UTC(y, 10, nthSunday(10, 1), 2 + 5);     // 2:00 CDT = 07:00 UTC
  return utcMs >= start && utcMs < end ? -5 : -6;
}
const wall = (iso: string) => { const ms = Date.parse(iso); const d = new Date(ms + centralOffsetHours(ms) * 3600e3); return { dow: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() }; };

// The pre-booked mechanics per slot and the job sizes, written out here as the test's own model.
const CAP = 3;
const PRE: Record<string, number> = { 'tue-17': 1, 'tue-18': 3, 'tue-19': 0, 'wed-17': 2, 'wed-18': 0, 'wed-19': 1, 'thu-17': 0, 'thu-18': 2, 'thu-19': 3,
  'sat-10': 1, 'sat-11': 2, 'sat-12': 0, 'sat-13': 3, 'sat-14': 0, 'sat-15': 1, 'sun-12': 0, 'sun-13': 1, 'sun-14': 2, 'sun-15': 0 };
const UNITS: Record<string, number> = { flat: 1, brakes: 1, gears: 1, wheel: 1, overhaul: 2 };

async function book(page: Page, day: string, slot: string, issue: string, name: string, email = 'rider@example.com') {
  await page.getByTestId(`day-${day}`).check();
  await page.getByTestId(`slot-${slot}`).check();
  await page.getByTestId('r-issue').selectOption(issue);
  await page.getByTestId('r-name').fill(name);
  await page.getByTestId('r-email').fill(email);
  await page.getByTestId('r-submit').click();
}

test.describe('127 Magic City Bike Co-op', () => {
  test('summer (CDT): Saturday opens at exactly 10:00 AM Central, 15:00 UTC', async ({ page }) => {
    expect(centralOffsetHours(Date.parse('2026-07-18T15:00:00Z'))).toBe(-5);
    expect(wall('2026-07-18T15:00:00Z')).toEqual({ dow: 6, mins: 600 });  // Saturday 10:00
    await at(page, '2026-07-18T14:59:00Z');
    await expect(page.getByTestId('sign-main')).toHaveText('Closed now');
    await expect(page.getByTestId('sign-sub')).toHaveText('Opens today at 10:00 AM');
    await expect(page.getByTestId('clock')).toHaveText("It's 9:59 AM on Saturday in Birmingham (CDT, UTC−5).");
    await expect(page.getByTestId('tz-abbr')).toHaveText('CDT');
    await expect(page.getByTestId('hours-row-6')).toHaveAttribute('aria-current', 'date');
    await expect(page.locator('tr[aria-current]')).toHaveCount(1);
    // the table: Monday first, closed Mondays and Fridays
    await expect(page.locator('#hoursBody tr')).toHaveCount(7);
    await expect(page.getByTestId('hours-row-1')).toContainText('Closed');
    await expect(page.getByTestId('hours-row-5')).toContainText('Closed');
    await expect(page.getByTestId('hours-row-2')).toContainText('5:00 PM – 8:00 PM');
    await expect(page.getByTestId('hours-row-6')).toContainText('10:00 AM – 4:00 PM');
    // one minute later the 15 s refresh flips the sign, and the live region says so
    await page.clock.runFor(61_000);
    await expect(page.getByTestId('sign-main')).toHaveText('Open now');
    await expect(page.getByTestId('sign-sub')).toHaveText('Closes at 4:00 PM');
    await expect(page.getByTestId('status')).toHaveText('Open now. Closes at 4:00 PM.');
    await expect(page.getByTestId('sign')).toHaveClass(/open/);
  });

  test('winter (CST): the same UTC time is an hour earlier in Birmingham', async ({ page }) => {
    // 15:30 UTC on a Saturday: 10:30 CDT in July (open) but 9:30 CST in December (closed)
    expect(centralOffsetHours(Date.parse('2026-12-19T15:30:00Z'))).toBe(-6);
    expect(wall('2026-12-19T15:30:00Z')).toEqual({ dow: 6, mins: 570 });
    await at(page, '2026-12-19T15:30:00Z');
    await expect(page.getByTestId('sign-main')).toHaveText('Closed now');
    await expect(page.getByTestId('sign-sub')).toHaveText('Opens today at 10:00 AM');
    await expect(page.getByTestId('clock')).toHaveText("It's 9:30 AM on Saturday in Birmingham (CST, UTC−6).");
    await expect(page.getByTestId('tz-abbr')).toHaveText('CST');
    const s = await page.evaluate(() => { const b = (window as any).__bike; return [b.status(Date.parse('2026-07-18T15:30:00Z')), b.status(Date.parse('2026-12-19T16:00:00Z'))]; });
    expect(s[0]).toMatchObject({ open: true, abbr: 'CDT', offsetMin: -300, mins: 630 });
    expect(s[1]).toMatchObject({ open: true, abbr: 'CST', offsetMin: -360, mins: 600, dow: 6 });
  });

  test('closing edge and the November DST change, checked against the rule', async ({ page }) => {
    // Tuesday 7:59 PM CDT = Wednesday 00:59 UTC: open, then closed from 8:00 PM, reopening Wednesday
    expect(wall('2026-07-22T00:59:00Z')).toEqual({ dow: 2, mins: 19 * 60 + 59 });
    await at(page, '2026-07-22T00:59:00Z');
    await expect(page.getByTestId('sign-main')).toHaveText('Open now');
    await expect(page.getByTestId('sign-sub')).toHaveText('Closes at 8:00 PM');
    await page.clock.runFor(60_000);
    await expect(page.getByTestId('sign-main')).toHaveText('Closed now');
    await expect(page.getByTestId('sign-sub')).toHaveText('Opens tomorrow at 5:00 PM');
    // 1 Nov 2026 is the first Sunday of November: CDT ends at 07:00 UTC. At 17:30 UTC it is 11:30 CST (closed;
    // Sunday opens at noon); a page that still assumed CDT would say 12:30 and open.
    const cases = ['2026-11-01T06:59:00Z', '2026-11-01T07:00:00Z', '2026-11-01T17:30:00Z', '2026-11-01T18:00:00Z', '2026-03-08T07:59:00Z', '2026-03-08T08:00:00Z',
      '2026-07-20T18:00:00Z', '2026-07-24T23:00:00Z', '2026-12-20T21:59:00Z', '2026-12-20T22:00:00Z'];
    const got = await page.evaluate((cs) => cs.map((c) => (window as any).__bike.status(Date.parse(c))), cases);
    const HOURS: Record<number, [number, number] | null> = { 0: [720, 960], 1: null, 2: [1020, 1200], 3: [1020, 1200], 4: [1020, 1200], 5: null, 6: [600, 960] };
    cases.forEach((c, i) => {
      const w = wall(c), h = HOURS[w.dow];
      expect(got[i].offsetMin, c).toBe(centralOffsetHours(Date.parse(c)) * 60);
      expect(got[i].abbr, c).toBe(centralOffsetHours(Date.parse(c)) === -5 ? 'CDT' : 'CST');
      expect(got[i].mins, c).toBe(w.mins);
      expect(got[i].open, c).toBe(!!h && w.mins >= h[0] && w.mins < h[1]);
    });
    expect(got[2]).toMatchObject({ open: false, sub: 'Opens today at 12:00 PM' });
    expect(got[6]).toMatchObject({ dow: 1, open: false, sub: 'Opens tomorrow at 5:00 PM' });    // Monday
    expect(got[7]).toMatchObject({ dow: 5, open: false, sub: 'Opens tomorrow at 10:00 AM' });   // Friday
  });

  test('the sign ignores the device time zone', async ({ browser, baseURL }) => {
    for (const timezoneId of ['Pacific/Auckland', 'Europe/London', 'America/Los_Angeles']) {
      const ctx = await browser.newContext({ timezoneId, baseURL });
      const page = await ctx.newPage();
      await at(page, '2026-12-19T15:30:00Z');
      await expect(page.getByTestId('clock')).toHaveText("It's 9:30 AM on Saturday in Birmingham (CST, UTC−6).");
      await expect(page.getByTestId('sign-main')).toHaveText('Closed now');
      await ctx.close();
    }
  });

  test('booking flow is gated: day, then slot, then issue; changing the day clears the slot', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('#slotFs')).toHaveJSProperty('disabled', true);
    await expect(page.getByTestId('slot-hint')).toHaveText('Pick a day first.');
    await expect(page.getByTestId('r-issue')).toBeDisabled();
    await page.getByTestId('day-tue').check();
    await expect(page.locator('#slotFs')).toHaveJSProperty('disabled', false);
    await expect(page.locator('[name=rSlot]')).toHaveCount(3);
    await expect(page.getByTestId('slot-tue-18')).toBeDisabled();                   // pre-booked full
    await expect(page.getByTestId('slotfree-tue-18')).toHaveText('Full');
    await expect(page.getByTestId('slotfree-tue-17')).toHaveText('2 of 3 free');
    await expect(page.getByTestId('r-issue')).toBeDisabled();
    await page.getByTestId('slot-tue-17').check();
    await expect(page.getByTestId('r-issue')).toBeEnabled();
    await expect(page.getByTestId('issue-hint')).toHaveText('Tuesday 5:00 PM: 2 mechanics free.');
    await page.getByTestId('r-issue').selectOption('overhaul');
    await page.getByTestId('day-sat').check();
    expect((await B(page)).selection).toEqual({ day: 6, slot: null, issue: '' });
    await expect(page.locator('[name=rSlot]')).toHaveCount(6);                     // 10 AM … 3 PM
    await expect(page.locator('[name=rSlot]:checked')).toHaveCount(0);
    await expect(page.getByTestId('r-issue')).toBeDisabled();
    // day totals: free mechanics summed over that day's slots, from the test's own table
    for (const d of ['tue', 'wed', 'thu', 'sat', 'sun']) {
      const ids = Object.keys(PRE).filter((k) => k.startsWith(d));
      const f = ids.reduce((n, k) => n + CAP - PRE[k], 0);
      await expect(page.getByTestId(`dayfree-${d}`)).toHaveText(`${f} of ${ids.length * CAP} free`);
    }
  });

  test('capacity math matches an independent model through bookings and cancellations', async ({ page }) => {
    await page.goto(URL);
    const held: Record<string, number> = {};
    const free = (k: string) => CAP - PRE[k] - (held[k] ?? 0);
    const check = async () => {
      for (const s of (await B(page)).slots) expect(s.free, s.id).toBe(free(s.id));
    };
    await check();
    // Saturday 10 AM starts with 2 free: an overhaul takes both
    await book(page, 'sat', 'sat-10', 'overhaul', 'Dee Kincaid', 'dee@example.com'); held['sat-10'] = 2;
    await expect(page.getByTestId('r-msg')).toHaveText('Booked: Saturday 10:00 AM, full overhaul, for Dee Kincaid. Code MCB-001. That slot is now full. Nothing was sent.');
    await check();
    await expect(page.getByTestId('slot-sat-10')).toBeDisabled();
    await expect(page.getByTestId('dayfree-sat')).toHaveText('9 of 18 free');
    // Sunday 12 PM: three one-mechanic jobs fill it
    await book(page, 'sun', 'sun-12', 'flat', 'A. One', 'a@example.com'); held['sun-12'] = 1;
    await expect(page.getByTestId('r-msg')).toContainText('2 mechanics still free then.');
    await book(page, 'sun', 'sun-12', 'brakes', 'B. Two', 'b@example.com'); held['sun-12'] = 2;
    await book(page, 'sun', 'sun-12', 'wheel', 'C. Three', 'c@example.com'); held['sun-12'] = 3;
    await check();
    expect(free('sun-12')).toBe(0);
    await expect(page.getByTestId('slotfree-sun-12')).toHaveText('Full');
    await expect(page.locator('#myList li')).toHaveCount(4);
    // cancelling returns exactly that job's mechanics
    await page.getByRole('button', { name: 'Cancel MCB-001, Saturday 10:00 AM for Dee Kincaid' }).click();
    held['sat-10'] = 0;
    await expect(page.getByTestId('r-msg')).toHaveText('Cancelled MCB-001: Saturday 10:00 AM has 2 mechanics free again.');
    await check();
    await expect(page.locator('#myList button').first()).toBeFocused();
    const total = (await B(page)).bookings.reduce((n: number, b: any) => n + UNITS[b.issue], 0);
    expect(total).toBe(3);
  });

  test('an overhaul needs two free mechanics: it is disabled where only one is free', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('day-sat').check();
    await page.getByTestId('slot-sat-11').check();                                  // 3 − 2 = 1 free
    const opt = page.locator('#rIssue option[value="overhaul"]');
    await expect(opt).toBeDisabled();
    await expect(opt).toHaveText('Full overhaul (needs 2 mechanics, only 1 free)');
    await expect(page.locator('#rIssue option[value="flat"]')).toBeEnabled();
    await page.getByTestId('slot-sat-12').check();                                  // 3 free
    await expect(opt).toBeEnabled();
    await expect(opt).toHaveText('Full overhaul (needs 2 mechanics)');
    // after a 1-mechanic booking the same slot still takes an overhaul (2 left); after another it can't
    await book(page, 'sat', 'sat-12', 'gears', 'Rider One', 'one@example.com');
    await page.getByTestId('slot-sat-12').check();
    await expect(opt).toBeEnabled();
    await book(page, 'sat', 'sat-12', 'flat', 'Rider Two', 'two@example.com');
    await page.getByTestId('slot-sat-12').check();
    await expect(opt).toBeDisabled();
    await expect(page.getByTestId('issue-hint')).toHaveText('Saturday 12:00 PM: 1 mechanic free.');
  });

  test('validation: first invalid field gets focus; email shape; two slots per email; note length', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('r-submit').click();
    await expect(page.getByTestId('r-msg')).toHaveText('Please fix the marked fields.');
    await expect(page.getByTestId('e-day')).toHaveText('Pick a day.');
    await expect(page.getByTestId('day-tue')).toBeFocused();
    await expect(page.getByTestId('e-name')).toHaveText('Please give your name.');
    await expect(page.getByTestId('e-email')).toHaveText('We need an email to confirm the slot.');
    await page.getByTestId('day-wed').check();
    await page.getByTestId('r-submit').click();
    await expect(page.getByTestId('e-day')).toHaveText('');
    await expect(page.getByTestId('e-slot')).toHaveText('Pick a time slot.');
    await page.getByTestId('slot-wed-18').check();
    await page.getByTestId('r-submit').click();
    await expect(page.getByTestId('e-issue')).toHaveText('Tell us what needs fixing.');
    await expect(page.getByTestId('r-issue')).toBeFocused();
    await page.getByTestId('r-issue').selectOption('flat');
    await page.getByTestId('r-name').fill('Pat Loveless');
    for (const bad of ['pat@', 'pat@example', 'pat example@x.com']) {
      await page.getByTestId('r-email').fill(bad);
      await page.getByTestId('r-submit').click();
      await expect(page.getByTestId('e-email')).toContainText('name@example.com');
      await expect(page.getByTestId('r-email')).toBeFocused();
      await expect(page.getByTestId('r-email')).toHaveAttribute('aria-invalid', 'true');
    }
    await page.getByTestId('r-email').fill('pat@example.com');
    await page.getByTestId('r-note').fill('x'.repeat(121));
    await expect(page.getByTestId('note-count')).toHaveText('121 / 120 characters');
    await page.getByTestId('r-submit').click();
    await expect(page.getByTestId('e-note')).toHaveText('Please keep notes to 120 characters.');
    await page.getByTestId('r-note').fill('x'.repeat(120));
    await page.getByTestId('r-submit').click();
    await expect(page.getByTestId('r-msg')).toContainText('Code MCB-001');
    await book(page, 'thu', 'thu-17', 'brakes', 'Pat Loveless', 'pat@example.com');
    await expect(page.getByTestId('r-msg')).toContainText('Code MCB-002');
    await book(page, 'sun', 'sun-15', 'gears', 'Pat Loveless', 'PAT@example.com');   // same email, other case
    await expect(page.getByTestId('e-email')).toHaveText('That email already has 2 slots this week. Cancel one to book another.');
    expect((await B(page)).bookings).toHaveLength(2);
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);
  });

  test('volunteer sign-up validates and confirms; donation tiers are simulated with no payment fields', async ({ page }) => {
    await page.goto(URL);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.getByTestId('v-submit').click();
    await expect(page.getByTestId('v-name')).toBeFocused();
    await expect(page.getByTestId('e-vexp')).toHaveText('Tell us your experience; every level is welcome.');
    await expect(page.getByTestId('e-vdays')).toHaveText('Pick at least one shift day.');
    await page.getByTestId('v-name').fill('Juno Parrish');
    await page.getByTestId('v-email').fill('juno@example.com');
    await page.getByTestId('v-exp-new').check();
    await page.getByTestId('v-submit').click();
    await expect(page.getByTestId('v-day-tue')).toBeFocused();
    await page.getByTestId('v-day-tue').check();
    await page.getByTestId('v-day-sat').check();
    await page.getByTestId('v-day-sun').check();
    await page.getByTestId('v-submit').click();
    await expect(page.getByTestId('v-msg')).toHaveText("Thanks, Juno Parrish. You're down for Tuesday, Saturday and Sunday shifts, starting with two shadow shifts. (Demo: nothing was sent.)");
    expect(await page.evaluate(() => (window as any).__bike.volunteers)).toEqual([{ name: 'Juno Parrish', email: 'juno@example.com', exp: 'new', days: ['Tuesday', 'Saturday', 'Sunday'] }]);
    // donations: tier × 12 for monthly
    await expect(page.getByTestId('d-out')).toHaveText('$25 once. Tube & tire: A new tube and tire for one commuter bike.');
    for (const amt of [10, 25, 60, 150]) {
      await page.getByTestId(`tier-${amt}`).check();
      await page.getByTestId('freq-monthly').check();
      await expect(page.getByTestId('d-out')).toContainText(`$${amt} a month = $${amt * 12} a year.`);
      await page.getByTestId('freq-once').check();
      await expect(page.getByTestId('d-out')).toContainText(`$${amt} once.`);
    }
    await page.getByTestId('freq-monthly').check();
    await page.getByTestId('d-submit').click();
    await expect(page.getByTestId('d-msg')).toHaveText('Pledge noted: $150 a month (simulated). No payment was taken and nothing was sent.');
    expect(await page.evaluate(() => (window as any).__bike.pledge)).toMatchObject({ amount: 150, freq: 'monthly', yearly: 1800 });
    // no payment fields anywhere: the donation form holds radios only, and no field asks for card data
    const kinds = await page.locator('#dForm input, #dForm select, #dForm textarea').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).type));
    expect(new Set(kinds)).toEqual(new Set(['radio']));
    await expect(page.locator('[autocomplete^="cc-"], [autocomplete*=" cc-"]')).toHaveCount(0);
    const labels = await page.locator('input, select, textarea').evaluateAll((els) => els.map((e) => `${(e as HTMLInputElement).name} ${e.id} ${(e as HTMLInputElement).labels?.[0]?.textContent ?? ''} ${e.getAttribute('placeholder') ?? ''}`));
    for (const l of labels) expect(l).not.toMatch(/card|cvv|cvc|expir|routing|account number|iban/i);
    expect(requests).toEqual([]);
  });

  test('FAQ accordion: Enter/Space toggle, arrows wrap, Home and End', async ({ page }) => {
    await page.goto(URL);
    const q = (i: number) => page.getByTestId(`faq-q-${i}`), a = (i: number) => page.getByTestId(`faq-a-${i}`);
    await expect(page.locator('#faqList button.q')).toHaveCount(5);
    await q(0).focus();
    await page.keyboard.press('Enter');
    await expect(q(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(a(0)).toBeVisible();
    await expect(a(0)).toHaveAttribute('role', 'region');
    await expect(a(0)).toHaveAttribute('aria-labelledby', 'fq-0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(q(2)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(a(2)).toContainText('only fits a slot with at least two free');
    await expect(a(0)).toBeVisible();
    await page.keyboard.press('Space');
    await expect(a(2)).toBeHidden();
    await expect(q(2)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('End');
    await expect(q(4)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(q(0)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(q(4)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(q(0)).toBeFocused();
  });

  test('layout: side-by-side on desktop, one column on a phone with 44px targets; clearly fictional', async ({ page }) => {
    await page.goto(URL);
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.setViewportSize({ width: 1200, height: 900 });
    let f = await box('#rForm'), m = await box('#myList');
    expect(m.x).toBeGreaterThan(f.x + f.width);
    expect(Math.abs((await box('.tier:nth-child(1)')).y - (await box('.tier:nth-child(4)')).y)).toBeLessThan(2);
    await page.setViewportSize({ width: 390, height: 844 });
    f = await box('#rForm'); m = await box('#myList');
    expect(m.y).toBeGreaterThan(f.y + f.height);
    expect(f.x + f.width).toBeLessThanOrEqual(390);
    const tiers = await page.locator('.tier').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
    tiers.forEach((x) => expect(Math.abs(x - tiers[0])).toBeLessThan(2));                   // stacked
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.getByTestId('day-sat').check();
    for (const sel of ['label:has([data-testid="day-sat"])', 'label:has([data-testid="slot-sat-12"])', '[data-testid="r-submit"]', '[data-testid="faq-q-0"]', '.tier']) {
      expect((await box(sel)).height, sel).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId('fiction-note')).toContainText('fictional');
    await expect(page.getByTestId('footer-fiction')).toContainText('No real bookings, sign-ups or donations');
    await expect(page.locator('footer')).toContainText('not affiliated with any real bike shop');
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4}/);
    expect(text).not.toMatch(/\b\d{2,5}\s+\w+\s+(Ave|Avenue|St|Street|Blvd)\b/);
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs.every((h) => h!.startsWith('#') || h!.startsWith('../'))).toBe(true);
  });
});
