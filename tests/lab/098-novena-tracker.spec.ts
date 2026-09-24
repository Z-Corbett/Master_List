import { test, expect, Page } from '@playwright/test';

const URL = '/lab/098-novena-tracker.html';
const data = (page: Page) => page.evaluate(() => (window as any).__novena.data);
const DAY = 24 * 60 * 60 * 1000;

async function openOn(page: Page, local: string) {
  await page.clock.install({ time: new Date(local) });
  await page.goto(URL);
  await page.clock.pauseAt(new Date(new Date(local).getTime() + 1000));
}
async function begin(page: Page, title = 'Novena to St. Joseph', intention = 'for our family') {
  await page.getByTestId('title').fill(title);
  await page.getByTestId('intention').fill(intention);
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('active')).toBeVisible();
}
const nextDay = (page: Page, n = 1) => page.clock.fastForward(n * DAY);

test.describe('098 Novena Tracker', () => {
  test('begin a novena: nine beads, day 1 today, saved only on this device', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => { if (!r.url().includes('/lab/098-novena-tracker.html')) requests.push(r.url()); });
    await openOn(page, '2026-10-01T08:00:00');
    await expect(page.getByTestId('privacy')).toContainText('nothing is sent anywhere');
    await expect(page.getByTestId('start-date')).toHaveValue('2026-10-01');
    await page.getByTestId('prayer').fill('O glorious St. Joseph, …');
    await page.getByTestId('glory').check();
    await begin(page);
    await expect(page.locator('[data-testid^="bead-"]')).toHaveCount(9);
    await expect(page.getByTestId('bead-1')).toHaveAttribute('data-state', 'today');
    await expect(page.getByTestId('bead-9')).toHaveAttribute('data-state', 'upcoming');
    await expect(page.getByTestId('day-title')).toHaveText('Day 1 of 9');
    await expect(page.getByTestId('day-date')).toHaveText('Thursday, October 1');
    await expect(page.getByTestId('novena-title')).toHaveText('Novena to St. Joseph');
    await expect(page.getByTestId('novena-intention')).toHaveText('For: for our family');
    await expect(page.getByTestId('day-prayer')).toHaveText('O glorious St. Joseph, …');
    await expect(page.getByTestId('glory-text')).toContainText('world without end. Amen.');
    const d = await data(page);
    expect(d.active.days.map((x: any) => x.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
    // persisted: a reload brings it back
    await page.reload();
    await expect(page.getByTestId('novena-title')).toHaveText('Novena to St. Joseph');
    expect(requests).toEqual([]);
  });

  test('daily check-in and notes: one bead a day, future days stay closed', async ({ page }) => {
    await openOn(page, '2026-10-01T08:00:00');
    await begin(page);
    await page.getByTestId('prayed').click();
    await expect(page.getByTestId('day-msg')).toHaveText('Day 1 prayed. 8 to go.');
    await expect(page.getByTestId('bead-1')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('prayed')).toBeDisabled();
    await expect(page.getByTestId('ring')).toHaveAttribute('aria-label', 'Nine beads: 1 of 9 days prayed');
    // a note is saved as you type
    await page.getByTestId('note').fill('Prayed at the 7:30 Mass.');
    expect((await data(page)).active.days[0].note).toBe('Prayed at the 7:30 Mass.');
    // looking ahead: day 5 can't be checked in yet
    await page.getByTestId('bead-5').click();
    await expect(page.getByTestId('day-state')).toHaveText('Still to come');
    await expect(page.getByTestId('prayed')).toBeDisabled();
    await expect(page.getByTestId('prayed')).toHaveText('Opens Monday');
    // the next morning, day 2 opens by itself
    await nextDay(page);
    await expect(page.getByTestId('day-title')).toHaveText('Day 2 of 9');
    await expect(page.getByTestId('prayed')).toBeEnabled();
    await page.getByTestId('prayed').click();
    await expect(page.getByTestId('bead-2')).toHaveAttribute('data-state', 'done');
    // keyboard: arrows move between beads, Enter opens a day and its note
    await page.getByTestId('bead-2').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('bead-1')).toBeFocused();
    await expect(page.getByTestId('day-title')).toHaveText('Day 1 of 9');
    await expect(page.getByTestId('note')).toHaveValue('Prayed at the 7:30 Mass.');
    await page.reload();
    await page.getByTestId('bead-1').click();
    await expect(page.getByTestId('note')).toHaveValue('Prayed at the 7:30 Mass.');
  });

  test('a missed day: resume moves the rest of the novena along', async ({ page }) => {
    await openOn(page, '2026-10-01T08:00:00');
    await begin(page);
    await page.getByTestId('prayed').click();
    await nextDay(page, 3);                                     // Oct 4: days 2 and 3 went by
    await expect(page.getByTestId('missed-banner')).toBeVisible();
    await expect(page.getByTestId('missed-text')).toContainText('Day 2 (Friday, October 2) went by without a check-in, and 1 more after it');
    await expect(page.getByTestId('bead-2')).toHaveAttribute('data-state', 'missed');
    await expect(page.getByTestId('prayed')).toBeDisabled();
    await page.getByTestId('resume').click();
    await expect(page.getByTestId('missed-banner')).toBeHidden();
    const d = await data(page);
    expect(d.active.days.map((x: any) => x.date)).toEqual(['2026-10-01', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(d.active.resumed).toBe(1);
    await expect(page.getByTestId('day-msg')).toHaveText('Resumed: day 2 is today, and day 9 falls on Sunday, October 11.');
    await expect(page.getByTestId('bead-2')).toHaveAttribute('data-state', 'today');
    await page.getByTestId('prayed').click();
    await expect(page.getByTestId('bead-2')).toHaveAttribute('data-state', 'done');
    // the calendar shows it
    await expect(page.getByTestId('cal-2026-10-01')).toHaveClass(/prayed/);
    await expect(page.getByTestId('cal-2026-10-04')).toHaveClass(/prayed/);
    await expect(page.getByTestId('cal-2026-10-11')).toHaveAttribute('aria-label', /novena day 9, to come/);
    await expect(page.getByTestId('cal-2026-10-02')).not.toHaveClass(/nov/);
  });

  test('restart or "I forgot to tap", with history kept', async ({ page }) => {
    await openOn(page, '2026-10-01T08:00:00');
    await begin(page, 'Pentecost novena', '');
    await page.getByTestId('prayed').click();
    await nextDay(page, 2);                                     // day 2 missed
    await page.getByTestId('forgot').click();
    await expect(page.getByTestId('bead-2')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('day-state')).toHaveText('Prayed (checked in Oct 3)');
    await expect(page.getByTestId('missed-banner')).toBeHidden();
    await nextDay(page, 3);                                     // Oct 6: days 3, 4 and 5 missed
    await page.getByTestId('restart').click();
    await expect(page.getByTestId('day-msg')).toHaveText('Begun again from day 1, today.');
    const d = await data(page);
    expect(d.active.days[0].date).toBe('2026-10-06');
    expect(d.active.title).toBe('Pentecost novena');
    expect(d.history).toHaveLength(1);
    expect(d.history[0].status).toBe('restarted');
    await expect(page.getByTestId('hist-item')).toHaveText(/Pentecost novena.*Restarted · Oct 1–Oct 9, 2026 · 2\/9 prayed/);
  });

  test('nine days prayed completes the novena; the calendar pages through months', async ({ page }) => {
    await openOn(page, '2026-10-28T07:00:00');
    await begin(page, 'Thanksgiving novena', '');
    for (let i = 1; i <= 9; i++) {
      await expect(page.getByTestId('day-title')).toHaveText(`Day ${i} of 9`);
      await page.getByTestId('prayed').click();
      if (i < 9) await nextDay(page);
    }
    await expect(page.getByTestId('complete-banner')).toBeVisible();
    await expect(page.getByTestId('complete-text')).toContainText('from October 28 to November 5');
    await expect(page.getByTestId('day-msg')).toHaveText('Day 9 prayed. Your novena is complete.');
    await expect(page.getByTestId('ring')).toHaveAttribute('aria-label', 'Nine beads: 9 of 9 days prayed');
    // the novena spans two months
    await expect(page.getByTestId('cal-title')).toHaveText('October 2026');
    await expect(page.getByTestId('cal-2026-10-31')).toHaveClass(/prayed/);
    await page.getByTestId('next-month').click();
    await expect(page.getByTestId('cal-title')).toHaveText('November 2026');
    await expect(page.getByTestId('cal-2026-11-05')).toHaveClass(/prayed/);
    await expect(page.getByTestId('cal-2026-11-05')).toHaveClass(/today/);
    await page.getByTestId('another').click();
    await expect(page.getByTestId('start-card')).toBeVisible();
    await expect(page.getByTestId('hist-item')).toContainText('Completed');
    await expect(page.getByTestId('hist-item')).toContainText('9/9 prayed');
  });
});
