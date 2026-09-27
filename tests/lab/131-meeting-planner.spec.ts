import { test, expect, Page } from '@playwright/test';

const BASE = '/lab/131-meeting-planner.html';
const S = (page: Page) => page.evaluate(() => (window as any).__meet.state);
const slots = (page: Page) => page.evaluate(() => (window as any).__meet.slots());

async function open(page: Page, query = '', at = '2026-03-16T15:00:00Z') {
  await page.clock.install({ time: new Date(at) });
  await page.goto(BASE + query);
  await page.clock.pauseAt(new Date(Date.parse(at) + 60000));        // generous: a slow load must not overshoot it
}

// Published rules, written out independently of the page:
// US: DST from 02:00 local on the second Sunday in March to 02:00 local on the first Sunday in November.
// EU/UK: from 01:00 UTC on the last Sunday in March to 01:00 UTC on the last Sunday in October.
const nthSunday = (y: number, m: number, n: number) => { const d = new Date(Date.UTC(y, m, 1)); return 1 + ((7 - d.getUTCDay()) % 7) + 7 * (n - 1); };
const lastSunday = (y: number, m: number) => { const d = new Date(Date.UTC(y, m + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (ms: number) => { const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

test.describe('131 Meeting Planner', () => {
  test('mid-March 2026: New York is 4 h behind London, Kolkata +5:30, and the out-of-step weeks are flagged', async ({ page }) => {
    // 16 March 2026 lies after the US change (8 March) and before the EU one (29 March)
    expect(nthSunday(2026, 2, 2)).toBe(8);
    expect(lastSunday(2026, 2)).toBe(29);
    await open(page);
    const s = await S(page);
    expect(s.date).toBe('2026-03-16');                                   // today, from the pinned clock, in the first zone
    expect(s.zones).toEqual(['America/New_York', 'Europe/London', 'Asia/Kolkata']);
    await expect(page.getByTestId('offset-0')).toHaveText('UTC-4:00');
    await expect(page.getByTestId('offset-1')).toHaveText('UTC+0:00');
    await expect(page.getByTestId('offset-2')).toHaveText('UTC+5:30');
    expect(s.info[1].off - s.info[0].off).toBe(4 * 60);
    expect(s.info[2].off - s.info[1].off).toBe(5 * 60 + 30);
    expect(s.info.map((z: any) => z.dst)).toEqual([true, false, false]);
    const warn = page.getByTestId('out-of-sync');
    await expect(warn).toHaveCount(1);
    await expect(warn).toContainText('New York and London are 4 h apart on this date, but usually 5 h');
  });

  test('July 2026: the gap is back to 5 h, Kolkata still +5:30, nothing out of step', async ({ page }) => {
    await open(page, '?date=2026-07-15');
    const s = await S(page);
    expect(s.info.map((z: any) => z.off)).toEqual([-240, 60, 330]);
    await expect(page.getByTestId('offset-1')).toHaveText('UTC+1:00');
    expect(s.info[1].off - s.info[0].off).toBe(300);
    await expect(page.getByTestId('out-of-sync')).toHaveCount(0);
    // cross-check the hook against a direct lookup for a few more known instants
    const offs = await page.evaluate(() => {
      const o = (window as any).__meet.offset;
      return [o('America/New_York', '2026-01-15T12:00:00Z'), o('Europe/London', '2026-10-24T12:00:00Z'), o('Europe/London', '2026-10-26T12:00:00Z'), o('America/Phoenix', '2026-07-01T12:00:00Z')];
    });
    expect(offs).toEqual([-300, 60, 0, -420]);
  });

  test('next clock changes land exactly where the US and EU rules put them', async ({ page }) => {
    await open(page, '?date=2026-03-01&zones=America/New_York,Europe/London', '2026-03-01T12:00:00Z');
    const s = await S(page);
    const us = Date.UTC(2026, 2, nthSunday(2026, 2, 2), 2 + 5);           // 02:00 EST = 07:00 UTC
    const eu = Date.UTC(2026, 2, lastSunday(2026, 2), 1);                 // 01:00 UTC
    expect(s.info[0].next.at).toBe(new Date(us).toISOString());
    expect(s.info[0].next.shift).toBe(60);
    expect(s.info[1].next.at).toBe(new Date(eu).toISOString());
    await expect(page.getByTestId('next-0')).toContainText('Sun 8 Mar 2026, at 02:00 local the clocks go forward 1 h');
    await expect(page.getByTestId('next-1')).toContainText('Sun 29 Mar 2026, at 01:00 local the clocks go forward 1 h');
    // and in the autumn: first Sunday in November vs last Sunday in October
    await page.getByTestId('date').fill('2026-10-10');
    await expect.poll(async () => (await S(page)).info[0].next.at).toBe(new Date(Date.UTC(2026, 10, nthSunday(2026, 10, 1), 2 + 4)).toISOString());
    expect((await S(page)).info[1].next.at).toBe(new Date(Date.UTC(2026, 9, lastSunday(2026, 9), 1)).toISOString());
    await expect(page.getByTestId('next-1')).toContainText('the clocks go back 1 h');
  });

  test('Lord Howe Island: +10:30 in winter, +11 in summer, and a clock change of only 30 minutes', async ({ page }) => {
    await open(page, '?zones=Australia/Lord_Howe,Australia/Sydney&date=2026-07-15');
    await expect(page.getByTestId('offset-0')).toHaveText('UTC+10:30');
    await expect(page.getByTestId('offset-1')).toHaveText('UTC+10:00');
    await page.getByTestId('date').fill('2026-01-15');
    await expect(page.getByTestId('offset-0')).toHaveText('UTC+11:00');
    await expect(page.getByTestId('offset-1')).toHaveText('UTC+11:00');
    // summer time ends on the first Sunday in April, at 02:00 local daylight time (15:00 UTC the day before)
    await page.getByTestId('date').fill('2026-03-16');
    const lh = (await S(page)).info[0];
    expect(nthSunday(2026, 3, 1)).toBe(5);
    expect(lh.next.at).toBe('2026-04-04T15:00:00.000Z');
    expect(lh.next.shift).toBe(-30);
    await expect(page.getByTestId('next-0')).toContainText('Sun 5 Apr 2026, at 02:00 local the clocks go back 30 min (UTC+11:00 → UTC+10:30)');
  });

  test('a day has 46 half-hours when the clocks go forward, 50 when they go back', async ({ page }) => {
    await open(page, '?zones=America/New_York,Europe/London&date=2026-03-08');
    expect((await S(page)).n).toBe(46);
    await expect(page.getByTestId('grid').locator('tbody tr').first().locator('td')).toHaveCount(46);
    const sl = await slots(page);
    // 01:30 EST is followed straight away by 03:00 EDT
    const i = sl.findIndex((x: any) => x.cells[0].local === '01:30');
    expect(sl[i + 1].cells[0].local).toBe('03:00');
    expect(Date.parse(sl[i + 1].utc) - Date.parse(sl[i].utc)).toBe(30 * 60000);
    await page.getByTestId('date').fill('2026-11-01');
    await expect.poll(async () => (await S(page)).n).toBe(50);
    const autumn = (await slots(page)).map((x: any) => x.cells[0].local);
    expect(autumn.filter((l: string) => l === '01:00' || l === '01:30')).toHaveLength(4);   // the repeated hour
    await page.getByTestId('date').fill('2026-03-16');
    await expect.poll(async () => (await S(page)).n).toBe(48);
  });

  test('every cell in the grid shows UTC plus the published offset for that zone', async ({ page }) => {
    await open(page);
    const sl = await slots(page);
    expect(sl).toHaveLength(48);
    expect(sl[0].utc).toBe('2026-03-16T04:00:00.000Z');                  // midnight in New York, UTC-4
    const known = [-240, 0, 330];
    for (const x of sl) known.forEach((off, k) => expect(x.cells[k].local).toBe(hhmm(Date.parse(x.utc) + off * 60000)));
    // the DOM matches: Kolkata's hour labels sit on New York's half-hours
    const row = page.getByTestId('grid').locator('tbody tr').nth(2).locator('td');
    await expect(row.nth(0)).toHaveAttribute('data-local', '09:30');
    await expect(row.nth(1)).toHaveAttribute('data-local', '10:00');
    await expect(row.nth(1)).toHaveText('10');
    await expect(row.nth(0)).toHaveText('');
  });

  test('overlap: New York and London share 4 h in mid-March but 3 h in July; add Kolkata and there is none', async ({ page }) => {
    /** Intersect the 09:00–17:00 windows as UTC intervals, from fixed offsets (minutes). */
    const overlap = (offs: number[], from = 9, to = 17) => Math.max(0, Math.min(...offs.map((o) => to * 60 - o)) - Math.max(...offs.map((o) => from * 60 - o)));
    expect(overlap([-240, 0])).toBe(240);
    expect(overlap([-240, 60])).toBe(180);
    expect(overlap([-240, 0, 330])).toBe(0);
    await open(page, '?zones=America/New_York,Europe/London&date=2026-03-16');
    await expect(page.getByTestId('overlap-len')).toHaveText('4 h');
    let st = await S(page);
    expect(st.best).toEqual({ start: 18, len: 8 });                       // 09:00 New York, 16 half-hours from midnight + 2
    await expect(page.getByTestId('suggest')).toContainText('New York 09:00–13:00 · London 13:00–17:00');
    const fit = (await slots(page)).map((x: any) => x.fit);
    expect(fit.filter(Boolean)).toHaveLength(8);
    await page.getByTestId('date').fill('2026-07-15');
    await expect(page.getByTestId('overlap-len')).toHaveText('3 h');
    await page.getByTestId('city').selectOption('Asia/Kolkata');
    await page.getByTestId('add-city').click();
    await expect(page.getByTestId('overlap-len')).toHaveText('No shared working hours');
    st = await S(page);
    expect(st.best).toBe(null);
    // widen the day to 07:30–20:00 and a window opens: 11:30 UTC (07:30 in New York) to 14:30 UTC (20:00 in Kolkata)
    expect(overlap([-240, 60, 330], 7.5, 20)).toBe(180);
    await page.getByTestId('from').selectOption('7.5');
    await page.getByTestId('to').selectOption('20');
    await expect(page.getByTestId('overlap-len')).toHaveText('3 h');
    await expect(page.getByTestId('suggest')).toContainText('New York 07:30–10:30 · London 12:30–15:30 · Kolkata 17:00–20:00');
  });

  test('share link and copy-as-text round-trip the whole plan', async ({ page, context }) => {
    await open(page, '?zones=America/Chicago,Europe/Berlin&date=2026-03-20');
    await page.getByTestId('duration').selectOption('1');
    await page.getByTestId('slot').fill('20');
    let st = await S(page);
    expect(st.slot).toBe(20);
    await expect(page.getByTestId('slot-out')).toContainText('10:00 in Chicago');
    const text = await page.getByTestId('copy-text').inputValue();
    expect(text.split('\n')).toEqual([
      'Meeting · Fri 20 Mar 2026 (Chicago) · 30 min',
      'Chicago  10:00–10:30  UTC-5:00',
      'Berlin   16:00–16:30  UTC+1:00',
      'UTC 2026-03-20 15:00',
    ]);
    await page.getByTestId('copy').click();
    await expect(page.getByTestId('copied')).toHaveText(/Copied|Selected/);
    expect((await S(page)).lastCopy).toBe(text);
    const link = await page.getByTestId('share-link').inputValue();
    expect(page.url()).toBe(link);
    const other = await context.newPage();
    await other.clock.install({ time: new Date('2026-09-01T00:00:00Z') });
    await other.goto(link);
    const o = await other.evaluate(() => (window as any).__meet.state);
    st = await S(page);
    for (const k of ['zones', 'date', 'from', 'to', 'dur', 'slot', 'text']) expect(o[k], k).toEqual(st[k]);
    await expect(other.getByTestId('offset-1')).toHaveText('UTC+1:00');
  });

  test('zones can be added by city or IANA name, rejected when unknown, reordered and removed', async ({ page }) => {
    await open(page, '?zones=Europe/London&date=2026-07-15');
    await page.getByTestId('iana').fill('Mars/Olympus_Mons');
    await page.getByTestId('add-iana').click();
    await expect(page.getByTestId('msg')).toContainText("isn't a time zone this browser knows");
    await page.getByTestId('iana').fill('America/Phoenix');
    await page.getByTestId('iana').press('Enter');
    await expect(page.getByTestId('offset-1')).toHaveText('UTC-7:00');   // Arizona keeps standard time all year
    await expect(page.getByTestId('zone-1')).toContainText('standard');
    await expect(page.getByTestId('next-1')).toContainText('No clock changes');
    await page.getByTestId('city').selectOption('Australia/Lord_Howe');
    await page.getByTestId('add-city').click();
    await expect(page.getByTestId('zone-2')).toContainText('Lord Howe Island');
    await page.getByTestId('first-2').click();
    expect((await S(page)).zones).toEqual(['Australia/Lord_Howe', 'Europe/London', 'America/Phoenix']);
    // the grid now follows Lord Howe's calendar day: it starts at 13:30 UTC the day before
    expect((await slots(page))[0].utc).toBe('2026-07-14T13:30:00.000Z');
    await page.getByTestId('remove-2').click();
    expect((await S(page)).zones).toEqual(['Australia/Lord_Howe', 'Europe/London']);
    await expect(page.getByTestId('msg')).toHaveText('Removed Phoenix.');
  });

  test('results do not depend on the machine time zone', async ({ browser }) => {
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles']) {
      const ctx = await browser.newContext({ timezoneId: tz });
      const p = await ctx.newPage();
      await open(p);
      const s = await S(p);
      expect(s.date).toBe('2026-03-16');
      expect(s.info.map((z: any) => z.offText)).toEqual(['-4:00', '+0:00', '+5:30']);
      expect((await slots(p))[0].utc).toBe('2026-03-16T04:00:00.000Z');
      await ctx.close();
    }
  });
});
