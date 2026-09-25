import { test, expect, Page } from '@playwright/test';

const URL = '/lab/113-hill-country-half.html';

/** Freeze the clock at an exact instant before the page loads, so every readout is computed at that instant. */
async function at(page: Page, iso: string) {
  const t = new Date(iso).getTime();
  await page.clock.install({ time: new Date(t - 1000) });
  await page.clock.pauseAt(new Date(t));
  await page.goto(URL);
}
const dhms = (ms: number) => {
  const s = Math.floor(ms / 1000), p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 86400)}d ${p(Math.floor((s % 86400) / 3600))}h ${p(Math.floor((s % 3600) / 60))}m ${p(s % 60)}s`;
};
// The course tables as published on the page, copied here so the climb is computed independently of the page's code.
const HALF = [[0, 1120], [0.5, 1138], [1, 1172], [1.5, 1215], [2, 1248], [2.5, 1230], [3, 1196], [3.5, 1162], [4, 1140], [4.5, 1178], [5, 1236], [5.5, 1290], [6, 1318],
  [6.5, 1284], [7, 1240], [7.5, 1205], [8, 1188], [8.5, 1150], [9, 1102], [9.5, 1125], [10, 1164], [10.5, 1198], [11, 1212], [11.5, 1186], [12, 1160], [12.5, 1142], [13.1, 1120]];
const TENK = [[0, 1120], [0.5, 1138], [1, 1172], [1.5, 1215], [2, 1248], [2.5, 1230], [3.1, 1196], [3.6, 1228], [4.1, 1246], [4.6, 1212], [5.1, 1170], [5.6, 1141], [6.2, 1120]];
const climb = (t: number[][]) => t.slice(1).reduce((g, p, i) => g + Math.max(0, p[1] - t[i][1]), 0);
const descent = (t: number[][]) => t.slice(1).reduce((g, p, i) => g + Math.max(0, t[i][1] - p[1]), 0);
const n = (x: number) => Math.round(x).toLocaleString('en-US');

async function fillValid(page: Page) {
  await page.getByTestId('name').fill('Rosa Delgado');
  await page.getByTestId('email').fill('rosa@example.com');
  await page.getByTestId('phone').fill('(512) 555-0142');
  await page.getByTestId('dob').fill('1990-05-20');
  await page.getByTestId('dist-half').check();
  await page.getByTestId('shirt').selectOption('M');
  await page.getByTestId('ec-name').fill('Tomás Delgado');
  await page.getByTestId('ec-phone').fill('512-555-0199');
  await page.getByTestId('waiver').check();
}

test.describe('113 Hill Country Half', () => {
  test('is plainly marked as fictional', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('fiction-banner')).toBeVisible();
    await expect(page.getByTestId('fiction-banner')).toContainText('A fictional event.');
    await expect(page.getByTestId('fiction-banner')).toContainText('the form sends nothing');
    await expect(page.locator('footer')).toContainText('fictional race');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hill Country Half');
    // the call to action jumps to the form
    await page.getByRole('link', { name: 'Register now' }).click();
    await expect(page).toHaveURL(/#register$/);
    await expect(page.getByTestId('form')).toBeInViewport();
  });

  test('price tiers switch at midnight CST: the last second of early bird, then regular', async ({ page }) => {
    await at(page, '2027-01-01T05:59:59Z');                              // Dec 31, 11:59:59 PM CST
    await expect(page.getByTestId('tier-early')).toHaveAttribute('data-state', 'now');
    await expect(page.getByTestId('tier-early')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('tier-regular')).toHaveAttribute('data-state', 'future');
    await expect(page.getByTestId('countdown-label')).toHaveText('Early bird price ends in');
    await expect(page.getByTestId('countdown')).toHaveText('0d 00h 00m 01s');
    await expect(page.getByTestId('fee')).toHaveText('$40–$65');
    await page.clock.runFor(1000);                                       // midnight
    await expect(page.getByTestId('tier-early')).toHaveAttribute('data-state', 'past');
    await expect(page.getByTestId('tier-regular')).toHaveAttribute('data-state', 'now');
    await expect(page.getByTestId('countdown-label')).toHaveText('Regular price ends in');
    await expect(page.getByTestId('countdown')).toHaveText(dhms(Date.UTC(2027, 1, 28, 6) - Date.UTC(2027, 0, 1, 6)));
    await expect(page.getByTestId('countdown')).toHaveText('58d 00h 00m 00s');   // 31 days of January + 27 of February
    await expect(page.getByTestId('fee')).toHaveText('$50–$80');
    await page.getByTestId('dist-half').check();
    await expect(page.getByTestId('fee')).toHaveText('$80');
    await expect(page.getByTestId('fee-tier')).toHaveText('(regular)');
  });

  test('race week, closing time and race day', async ({ page }) => {
    await at(page, '2027-02-28T05:59:59Z');
    await expect(page.getByTestId('tier-regular')).toHaveAttribute('data-state', 'now');
    await at(page, '2027-02-28T06:00:00Z');                              // Sunday Feb 28, 12:00 AM CST
    await expect(page.getByTestId('tier-raceweek')).toHaveAttribute('data-state', 'now');
    await expect(page.getByTestId('countdown-label')).toHaveText('Online registration closes in');
    await expect(page.getByTestId('countdown')).toHaveText('5d 00h 00m 00s');
    await page.getByTestId('dist-10k').check();
    await expect(page.getByTestId('fee')).toHaveText('$60');
    await at(page, '2027-03-05T06:00:00Z');                              // closed from Friday
    await expect(page.locator('[data-state="now"]')).toHaveCount(0);
    await expect(page.locator('[data-state="past"]')).toHaveCount(3);
    await expect(page.getByTestId('closed-note')).toHaveText('Online registration is closed. See you on the trail Saturday!');
    await expect(page.getByTestId('submit')).toBeDisabled();
    await expect(page.getByTestId('countdown-label')).toHaveText('Starting cannon in');
    await expect(page.getByTestId('countdown')).toHaveText('1d 07h 00m 00s');   // to 7:00 AM CST Saturday
    await at(page, '2027-03-06T14:00:00Z');
    await expect(page.getByTestId('countdown-label')).toHaveText('The race is on.');
    // and on an ordinary day in the early-bird window, the countdown is exact to the second
    await at(page, '2026-09-25T17:03:21Z');
    await expect(page.getByTestId('countdown')).toHaveText(dhms(Date.UTC(2027, 0, 1, 6) - Date.UTC(2026, 8, 25, 17, 3, 21)));
    await page.clock.runFor(61_000);
    await expect(page.getByTestId('countdown')).toHaveText(dhms(Date.UTC(2027, 0, 1, 6) - Date.UTC(2026, 8, 25, 17, 4, 22)));
  });

  test('elevation profile: total climb, descent and extremes computed from the course table', async ({ page }) => {
    await page.goto(URL);
    const gain = climb(HALF), loss = descent(HALF);
    expect(gain).toBe(loss);                                              // a loop ends where it starts
    await expect(page.getByTestId('gain')).toHaveText(`${n(gain)} ft (${n(gain * 0.3048)} m)`);
    await expect(page.getByTestId('loss')).toHaveText(`${n(loss)} ft`);
    await expect(page.getByTestId('high')).toHaveText(`${n(Math.max(...HALF.map((p) => p[1])))} ft`);
    await expect(page.getByTestId('low')).toHaveText(`${n(Math.min(...HALF.map((p) => p[1])))} ft`);
    await expect(page.getByTestId('dist')).toHaveText('13.1 mi');
    await expect(page.getByTestId('aid')).toHaveText('4');
    await expect(page.getByTestId('aid-mark')).toHaveCount(4);
    // the page's table is the one the test copied
    const rows = await page.getByTestId('course-table').locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [parseFloat(tr.children[0].textContent!), parseFloat(tr.children[1].textContent!.replace(/,/g, ''))]));
    expect(rows).toEqual(HALF);
    // the drawn line has one vertex per surveyed point, and its highest vertex is at the Lookout
    const pts = (await page.getByTestId('profile-line').getAttribute('points'))!.trim().split(/\s+/).map((s) => s.split(',').map(Number));
    expect(pts).toHaveLength(HALF.length);
    const top = pts.reduce((b, p, i) => (p[1] < pts[b][1] ? i : b), 0);
    expect(HALF[top][0]).toBe(6);
    for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0]);
    await expect(page.getByTestId('profile')).toHaveAttribute('aria-label', new RegExp(`${n(gain)} feet of total climb`));
    // 10K tab, by keyboard
    await page.getByTestId('tab-half').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-10k')).toBeFocused();
    await expect(page.getByTestId('tab-10k')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('gain')).toHaveText(`${n(climb(TENK))} ft (${n(climb(TENK) * 0.3048)} m)`);
    await expect(page.getByTestId('dist')).toHaveText('6.2 mi');
    await expect(page.getByTestId('aid-mark')).toHaveCount(1);
    expect(((await page.getByTestId('profile-line').getAttribute('points'))!.trim().split(/\s+/))).toHaveLength(TENK.length);
  });

  test('scrubbing the course interpolates between surveyed points', async ({ page }) => {
    await page.goto(URL);
    const scrub = async (mi: number) => page.getByTestId('scrub').evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, mi);
    const lerp = (t: number[][], mi: number) => { for (let i = 1; i < t.length; i++) if (mi <= t[i][0]) return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * (mi - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t[t.length - 1][1]; };
    for (const mi of [0, 6, 6.25, 9, 12.8, 13.1]) {
      await scrub(mi);
      await expect(page.getByTestId('scrub-out')).toHaveText(`Mile ${mi.toFixed(2)}: ${n(lerp(HALF, mi))} ft`);
    }
    expect(lerp(HALF, 6.25)).toBe(1301);
    await page.getByTestId('scrub').focus();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('scrub-out')).toHaveText('Mile 0.00: 1,120 ft');
  });

  test('an empty submit lists every problem, marks each field and moves focus to the summary', async ({ page }) => {
    await at(page, '2026-10-01T15:00:00Z');
    await page.getByTestId('submit').click();
    const summary = page.getByTestId('error-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary.locator('li')).toHaveCount(9);
    for (const id of ['name', 'email', 'phone', 'dob', 'shirt', 'ec-name', 'ec-phone', 'waiver']) await expect(page.getByTestId(id)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('dist-err')).toHaveText('Choose a distance.');
    await expect(page.getByTestId('shirt-err')).toHaveText('Choose a shirt size.');
    // a summary link takes you to its field
    await summary.getByRole('link', { name: 'Choose a shirt size.' }).click();
    await expect(page.getByTestId('shirt')).toBeFocused();
    // errors clear live as fields are fixed
    await page.getByTestId('shirt').selectOption('L');
    await expect(page.getByTestId('shirt-err')).toHaveText('');
    await expect(page.getByTestId('shirt')).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('email').fill('rosa@');
    await expect(page.getByTestId('email-err')).toHaveText('Enter an email address like name@example.com.');
    await expect(page.getByTestId('confirm')).toBeHidden();
  });

  test('age limits are checked on race day: 16 for the half, 12 for the 10K', async ({ page }) => {
    await at(page, '2026-10-01T15:00:00Z');
    await fillValid(page);
    const age = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return 2027 - y - (m > 3 || (m === 3 && d > 6) ? 1 : 0); };
    const dobErr = page.getByTestId('dob-err');
    await page.getByTestId('dob').fill('2011-03-07');                       // turns 16 the day after the race
    expect(age('2011-03-07')).toBe(15);
    await page.getByTestId('submit').click();
    await expect(dobErr).toHaveText("Half marathon runners must be 16 on race day; you'll be 15. The 10K is open from 12.");
    await page.getByTestId('dob').fill('2011-03-06');                       // 16th birthday is race day: allowed
    expect(age('2011-03-06')).toBe(16);
    await expect(dobErr).toHaveText('');
    await page.getByTestId('dist-10k').check();
    await page.getByTestId('dob').fill('2015-03-07');
    expect(age('2015-03-07')).toBe(11);
    await expect(dobErr).toHaveText("10K runners must be 12 on race day; you'll be 11.");
    await page.getByTestId('dob').fill('2015-03-06');
    await expect(dobErr).toHaveText('');
    expect(await page.evaluate(() => (window as any).__hill.ageOnRaceDay('1990-05-20'))).toBe(age('1990-05-20'));
  });

  test('the emergency contact must be someone else, with a different, valid number', async ({ page }) => {
    await at(page, '2026-10-01T15:00:00Z');
    await fillValid(page);
    await page.getByTestId('ec-name').fill('rosa delgado');
    await page.getByTestId('ec-phone').fill('512.555.0142');                // same digits as the runner's phone
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('ec-name-err')).toHaveText('Your emergency contact has to be someone other than you.');
    await expect(page.getByTestId('ec-phone-err')).toContainText('Use a different number');
    await expect(page.getByTestId('error-summary').locator('li')).toHaveCount(2);
    await page.getByTestId('ec-phone').fill('555-01');
    await expect(page.getByTestId('ec-phone-err')).toHaveText('Enter a 10-digit US phone number.');
    await page.getByTestId('ec-phone').fill('+1 (830) 555-0101');           // country code is fine
    await expect(page.getByTestId('ec-phone-err')).toHaveText('');
    await page.getByTestId('ec-name').fill('Tomás Delgado');
    await expect(page.getByTestId('ec-name-err')).toHaveText('');
  });

  test('a valid registration is confirmed at the current price, and nothing goes over the network', async ({ page }) => {
    await at(page, '2027-01-15T18:00:00Z');                              // regular pricing
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await fillValid(page);
    await expect(page.getByTestId('fee')).toHaveText('$80');
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('confirm')).toBeVisible();
    await expect(page.getByTestId('confirm')).toBeFocused();
    await expect(page.getByTestId('form')).toBeHidden();
    await expect(page.getByTestId('confirm-text')).toHaveText(/^Rosa Delgado, bib reserved for the half marathon, shirt M, at the regular price of \$80\. Confirmation HCH-\d{6}\.$/);
    const reg = await page.evaluate(() => (window as any).__hill.lastReg);
    expect(reg).toMatchObject({ dist: 'half', price: 80, tier: 'regular', shirt: 'M', age: 36 });
    expect(requests).toEqual([]);
    await page.getByTestId('another').click();
    await expect(page.getByTestId('form')).toBeVisible();
    await expect(page.getByTestId('name')).toHaveValue('');
    await expect(page.getByTestId('name')).toBeFocused();
  });

  test('pace-group finder: pace per mile and km, and the right sign to stand by', async ({ page }) => {
    await page.goto(URL);
    const mmss = (s: number) => { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
    const HALF_KM = 21.0975, MILE_KM = 1.609344;
    const res = page.getByTestId('pace-result');
    await page.getByTestId('pace-goal').fill('2:00:00');
    await expect(res).toContainText(`That's ${mmss(7200 / (HALF_KM / MILE_KM))} per mile (${mmss(7200 / HALF_KM)} per km).`);
    await expect(res).toContainText("That's 9:09 per mile (5:41 per km).");
    await expect(page.getByTestId('group-120')).toHaveAttribute('aria-current', 'true');
    await page.getByTestId('pace-goal').fill('1:52');
    await expect(res).toContainText('Line up with the 2:00 group, the nearest one at or slower than your goal');
    await page.getByTestId('pace-goal').fill('1:30');
    await expect(res).toContainText("ahead of our fastest pacer");
    await expect(page.locator('[data-testid^="group-"].pick')).toHaveCount(0);
    await page.getByTestId('pace-goal').fill('3:20');
    await expect(res).toContainText('No pacer that far back');
    await page.getByTestId('pace-goal').fill('3:45');
    await expect(res).toContainText('slower than the 3:30 half cutoff');
    await page.getByTestId('pace-dist').selectOption('tenk');
    await page.getByTestId('pace-goal').fill('0:55');
    await expect(res).toContainText(`That's ${mmss(3300 / (10 / MILE_KM))} per mile (5:30 per km).`);
    await expect(page.getByTestId('group-60')).toHaveAttribute('aria-current', 'true');
    await page.getByTestId('pace-goal').fill('fast');
    await expect(res).toHaveText('Enter a goal like 2:15 or 1:58:30.');
    await expect(page.getByTestId('pace-goal')).toHaveAttribute('aria-invalid', 'true');
  });

  test('layout: tiers and form fields sit side by side on desktop and stack on a phone', async ({ page, isMobile }) => {
    await page.goto(URL);
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    const [e, r, w] = [await box('tier-early'), await box('tier-regular'), await box('tier-raceweek')];
    const [nm, em] = [await box('name'), await box('email')];
    if (isMobile) {
      expect(Math.abs(e.x - r.x)).toBeLessThan(2);
      expect(r.y).toBeGreaterThan(e.y + e.height - 1);
      expect(w.y).toBeGreaterThan(r.y + r.height - 1);
      expect(em.y).toBeGreaterThan(nm.y + nm.height);
      const vw = page.viewportSize()!.width;
      expect(e.width).toBeGreaterThan(vw - 40);
      expect(nm.width).toBeGreaterThan(vw - 90);
    } else {
      expect(Math.abs(e.y - r.y)).toBeLessThan(2);
      expect(r.x).toBeGreaterThan(e.x + e.width);
      expect(w.x).toBeGreaterThan(r.x + r.width);
      expect(Math.abs(nm.y - em.y)).toBeLessThan(2);
    }
    // the fixed back link never covers the banner text
    const back = await box('back-link'), banner = await page.getByTestId('fiction-banner').locator('b').boundingBox();
    const overlap = !(back.x + back.width <= banner!.x || banner!.x + banner!.width <= back.x || back.y + back.height <= banner!.y || banner!.y + banner!.height <= back.y);
    expect(overlap).toBe(false);
  });
});
