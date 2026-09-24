import { test, expect, Page } from '@playwright/test';

const URL = '/lab/059-night-train.html?seed=20';

/** Freeze time on a Tuesday so the first departure (Wednesday) is a weekday fare. */
async function openOnTuesday(page: Page) {
  await page.clock.install({ time: new Date('2026-10-06T09:00:00') });
  await page.clock.pauseAt(new Date('2026-10-06T09:00:05'));
  await page.goto(URL);
}
const openBerths = (page: Page, car: number) => page.locator(`[data-testid="car-${car}"] .berth:not([disabled])`);

test.describe('059 The Night Owl', () => {
  test('cabin classes show fares, and choosing one jumps to that car in the berth picker', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await expect(page.getByTestId('class-roomette')).toContainText('$189');
    await expect(page.getByTestId('class-deluxe')).toContainText('$349');
    await expect(page.getByTestId('class-suite')).toContainText('$690');
    await expect(page.getByTestId('class-deluxe')).toContainText('Most booked');
    await expect(page.getByTestId('matrix').locator('tbody tr')).toHaveCount(5);
    await page.getByRole('link', { name: 'Choose Sleeper Cabin' }).click();
    await expect(page).toHaveURL(/#berths$/);
    const focused = page.locator('.berth:focus');
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveAttribute('data-testid', /^berth-4-/);
  });

  test('route timeline: stop details and the train-position scrubber', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('route').locator('button')).toHaveCount(7);
    await expect(page.getByTestId('stop-detail')).toContainText('Departs 20:15');
    await page.getByTestId('stop-3').click();
    await expect(page.getByTestId('stop-3')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('stop-0')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('stop-detail')).toContainText('Coldwater Junction');
    await expect(page.getByTestId('stop-detail')).toContainText('Arrives 00:35 · departs 00:50 (15 min stop) · mile 214');
    await expect(page.getByTestId('stop-detail')).toContainText('Lamps dimmed');
    await page.getByTestId('stop-2').click();
    await expect(page.getByTestId('stop-detail')).not.toContainText('Lamps dimmed');

    const clock = page.getByTestId('clock');
    await expect(page.getByTestId('where')).toContainText('Waiting at Harrowgate Central');
    await clock.fill('265');
    await expect(page.getByTestId('clock-out')).toHaveText('00:40');
    await expect(page.getByTestId('where')).toHaveText('Standing at Coldwater Junction. Corridor lamps are dimmed.');
    // 01:00 is ten minutes out of Coldwater (dep 00:50) on the 140-minute, 104-mile run to Ashby Ridge
    await clock.fill('285');
    await expect(page.getByTestId('clock-out')).toHaveText('01:00');
    await expect(page.getByTestId('where')).toContainText('Between Coldwater Junction and Ashby Ridge, 221 miles from Harrowgate.');
    await clock.fill('100');
    await expect(page.getByTestId('where')).toHaveText(/^Between Millbrook and Linden Falls, \d+ miles from Harrowgate\.$/);
    await clock.fill('685');
    await expect(page.getByTestId('clock-out')).toHaveText('07:40');
    await expect(page.getByTestId('where')).toHaveText('Arrived at Port Aurelia. Good morning.');
    const pos = await page.evaluate(() => (window as any).__owl.positionAt(285));
    expect(pos.mi).toBeCloseTo(214 + (10 / 140) * 104, 5);
  });

  test('berth picker: seeded availability, selection, price total, weekend supplement and a four-berth cap', async ({ page }) => {
    await openOnTuesday(page);
    await expect(page.getByTestId('date').locator('option').first()).toHaveText('Wed 7 Oct');
    const taken = await page.evaluate(() => (window as any).__owl.taken);
    expect(taken.length).toBeGreaterThan(3);
    for (const id of taken.slice(0, 3)) await expect(page.getByTestId(`berth-${id}`)).toBeDisabled();

    const r = openBerths(page, 3);
    await r.nth(0).click();
    await r.nth(1).click();
    await expect(r.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('lines').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('total')).toHaveText('$402'); // 2 × $189 + 2 × $12 fee
    await openBerths(page, 5).first().click();
    await expect(page.getByTestId('total')).toHaveText('$1,104'); // + $690 + $12
    // unselect one
    await r.nth(1).click();
    await expect(page.getByTestId('total')).toHaveText('$903');

    // Friday night is a weekend departure: 15% supplement, choices cleared
    await page.getByTestId('date').selectOption({ label: 'Fri 9 Oct · weekend' });
    await expect(page.getByTestId('msg')).toContainText('berth choices cleared');
    await expect(page.getByTestId('total')).toHaveText('$0');
    const q = await page.evaluate(() => (window as any).__owl.quote());
    expect(q.weekend).toBe(true);
    await openBerths(page, 4).first().click();
    await expect(page.getByTestId('total')).toHaveText(`$${Math.round(349 * 1.15) + 12}`);
    await expect(page.getByTestId('lines')).toContainText('15% supplement');

    // four is the limit
    const more = openBerths(page, 3);
    for (let i = 0; i < 4; i++) await more.nth(i).click();
    await expect(page.getByTestId('msg')).toHaveText('Up to 4 berths per booking.');
    expect(await page.evaluate(() => (window as any).__owl.selected.length)).toBe(4);
  });

  test('a hold counts down for ten minutes, locks the map, and releases or expires', async ({ page }) => {
    await openOnTuesday(page);
    await expect(page.getByTestId('hold')).toBeDisabled();
    const picks = openBerths(page, 4);
    await picks.nth(0).click();
    await picks.nth(1).click();
    const ids = await page.evaluate(() => (window as any).__owl.selected);
    await page.getByTestId('hold').click();
    await expect(page.getByTestId('hold-box')).toBeVisible();
    await expect(page.getByTestId('ref')).toHaveText(/^NO-[A-Z2-9]{5}$/);
    await expect(page.getByTestId('countdown')).toHaveText('10:00');
    for (const id of ids) await expect(page.getByTestId(`berth-${id}`)).toHaveClass(/held/);
    await expect(openBerths(page, 3)).toHaveCount(0); // everything else is locked
    await expect(page.getByTestId('date')).toBeDisabled();

    await page.clock.fastForward('04:00');
    await expect(page.getByTestId('countdown')).toHaveText('6:00');
    await page.getByTestId('release').click();
    await expect(page.getByTestId('msg')).toHaveText('Berths released.');
    await expect(page.getByTestId('hold-box')).toBeHidden();
    await expect(page.getByTestId('total')).toHaveText('$0');

    // hold again and let it lapse
    await openBerths(page, 5).first().click();
    await page.getByTestId('hold').click();
    await page.clock.fastForward('09:59');
    await expect(page.getByTestId('countdown')).toHaveText('0:01');
    await page.clock.fastForward('00:02');
    await expect(page.getByTestId('msg')).toContainText('hold expired');
    await expect(page.getByTestId('hold-box')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__owl.hold)).toBeNull();
    await expect(openBerths(page, 3).first()).toBeEnabled();
  });

  test('FAQ answers open and close, and the page is honest that the railway is fictional', async ({ page }) => {
    await page.goto(URL);
    const q = page.locator('summary', { hasText: 'Is The Night Owl a real train?' });
    const answer = page.locator('details', { has: q }).locator('p');
    await expect(answer).toBeHidden();
    await q.click();
    await expect(answer).toBeVisible();
    await expect(answer).toContainText('No. The Night Owl, its stations and its fares are invented');
    await q.click();
    await expect(answer).toBeHidden();
    await expect(page.locator('footer')).toContainText('fictional sleeper line');
  });
});
