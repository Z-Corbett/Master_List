import { test, expect, Page } from '@playwright/test';

const URL = '/lab/112-southside-supper-club.html';
const S = (page: Page) => page.evaluate(() => { const s = (window as any).__supper; return { dinners: s.dinners, reservations: s.reservations, waitlist: s.waitlist }; });
const left = async (page: Page, id: string) => (await S(page)).dinners.find((d: any) => d.id === id).left;

// The seats the page starts with, written out here as the test's own model (capacity − already booked).
const START = { oct: 24 - 22, nov: 20 - 20, dec: 24 - 15, jan: 24 - 4 };

async function book(page: Page, dinner: string, size: number, name: string, opts: { email?: string; diet?: string; pair?: boolean } = {}) {
  await page.getByTestId('f-dinner').selectOption(dinner);
  await page.getByTestId('f-size').fill(String(size));
  await page.getByTestId('f-name').fill(name);
  await page.getByTestId('f-email').fill(opts.email ?? 'guest@example.com');
  if (opts.diet) await page.getByTestId('f-diet').fill(opts.diet);
  if (opts.pair) await page.getByTestId('f-pair').check();
  await page.getByTestId('submit').click();
}

test.describe('112 Southside Supper Club', () => {
  test('four Saturday dinners with four-course menus and correct opening availability', async ({ page }) => {
    await page.goto(URL);
    const expected: Record<string, [number, number, number]> = { oct: [2026, 10, 17], nov: [2026, 11, 14], dec: [2026, 12, 12], jan: [2027, 1, 9] };
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    await expect(page.locator('[data-testid^="dinner-"]')).toHaveCount(4);
    for (const [id, [y, m, d]] of Object.entries(expected)) {
      // weekday from the calendar, computed here rather than read from the page
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(6);
      await expect(page.getByTestId(`date-${id}`)).toHaveText(`Saturday, ${months[m - 1]} ${d}, ${y} · 7:00 PM`);
      await expect(page.getByTestId(`menu-${id}`).locator('li')).toHaveCount(4);
    }
    await expect(page.getByTestId('menu-nov')).toContainText('Gulf shrimp and stone-ground grits');
    await expect(page.getByTestId('left-oct')).toHaveText('2 seats left');
    await expect(page.getByTestId('left-nov')).toHaveText('Sold out');
    await expect(page.getByTestId('pick-nov')).toHaveText('Join the waitlist');
    await expect(page.getByTestId('left-dec')).toHaveText('9 seats left');
    await expect(page.getByTestId('left-jan')).toHaveText('20 seats left');
    const s = await S(page);
    for (const d of s.dinners) expect(d.left).toBe(START[d.id as keyof typeof START]);
    await expect(page.getByTestId('f-dinner').locator('option[value="nov"]')).toContainText('waitlist only');
  });

  test('price summary: seats × ($65 + $25 pairing), updated live', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('f-dinner').selectOption('dec');
    for (const [n, pair] of [[1, false], [3, true], [8, false], [5, true]] as const) {
      await page.getByTestId('f-size').fill(String(n));
      await page.getByTestId('f-pair').setChecked(pair);
      const total = n * (65 + (pair ? 25 : 0));
      await expect(page.getByTestId('submit')).toHaveText(`Reserve ${n} seat${n === 1 ? '' : 's'} · $${total}`);
      await expect(page.getByTestId('summary')).toContainText(`$${total} (${n} × $${pair ? 90 : 65})`);
      await expect(page.getByTestId('summary')).toContainText(`${9 - n} left after yours`);
    }
    // a party bigger than what's left flips the button to the waitlist
    await page.getByTestId('f-dinner').selectOption('oct');
    await page.getByTestId('f-size').fill('3');
    await expect(page.getByTestId('submit')).toHaveText('Join the waitlist');
    await expect(page.getByTestId('summary')).toHaveText('Only 2 seats left at First Frost, not enough for 3. Your party would be #1 on the waitlist.');
  });

  test('booking the last seats sells a dinner out, sends nothing, and escapes names', async ({ page }) => {
    await page.goto(URL);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await book(page, 'oct', 2, 'Ruth <b>Pruitt</b>', { diet: 'One vegetarian', pair: true });
    await expect(page.getByTestId('msg')).toHaveText('Confirmed: 2 seats for Ruth <b>Pruitt</b> at First Frost (Saturday, October 17, 2026). Code SSC-OCT-001. Nothing was sent.');
    await expect(page.getByTestId('left-oct')).toHaveText('Sold out');
    await expect(page.getByTestId('dinner-oct')).toHaveClass(/full/);
    await expect(page.getByTestId('f-dinner').locator('option[value="oct"]')).toContainText('waitlist only');
    const row = page.getByTestId('res-SSC-OCT-001');
    await expect(row).toContainText('Ruth <b>Pruitt</b> · 2 seats · First Frost · $180');
    await expect(row.locator('b b')).toHaveCount(0);                     // markup in a name is shown, not rendered
    await expect(row).toContainText('One vegetarian');
    const s = await S(page);
    expect(s.dinners.find((d: any) => d.id === 'oct')).toMatchObject({ left: 0, held: 2 });
    expect(s.reservations[0]).toMatchObject({ size: 2, pairing: true, total: 2 * 90, email: 'guest@example.com' });
    // the form resets for the next party, keeping dinner and size
    await expect(page.getByTestId('f-name')).toHaveValue('');
    await expect(page.getByTestId('f-pair')).not.toBeChecked();
    expect(requests).toEqual([]);
  });

  test('full dinners and oversize parties go on the waitlist in order', async ({ page }) => {
    await page.goto(URL);
    await book(page, 'nov', 2, 'Lettie Hale');
    await expect(page.getByTestId('msg')).toHaveText("You're #1 on the waitlist for Gulf Coast Supper, party of 2. We'll move you up if seats open.");
    await book(page, 'nov', 4, 'Amos Reddick');
    await expect(page.getByTestId('msg')).toContainText("#2 on the waitlist");
    await expect(page.getByTestId('left-nov')).toHaveText('Sold out · 2 on waitlist');
    // October has 2 seats: a party of 3 is not split, it waits
    await book(page, 'oct', 3, 'The Faircloths');
    await expect(page.getByTestId('msg')).toContainText('#1 on the waitlist for First Frost');
    expect(await left(page, 'oct')).toBe(2);
    await expect(page.getByTestId('wait-nov-1')).toContainText('Lettie Hale · party of 2');
    await expect(page.getByTestId('wait-nov-2')).toContainText('Amos Reddick · party of 4');
    await expect(page.getByTestId('wait-oct-1')).toContainText('The Faircloths');
    // leaving the list moves the next party up
    await page.getByRole('button', { name: 'Leave the Gulf Coast Supper waitlist for Lettie Hale' }).click();
    await expect(page.getByTestId('wait-nov-1')).toContainText('Amos Reddick');
    expect((await S(page)).dinners.find((d: any) => d.id === 'nov').waitlist).toEqual([{ name: 'Amos Reddick', size: 4 }]);
    expect((await S(page)).reservations).toEqual([]);
  });

  test('cancelling promotes the first waitlisted party that fits (model check)', async ({ page }) => {
    await page.goto(URL);
    // an independent model of the rules: seats = capacity − booked − held; promote in order, skip parties that don't fit
    const model = { left: START.dec, wait: [] as { name: string; size: number }[], held: new Map<string, number>() };
    const promote = () => { for (const w of [...model.wait]) if (w.size <= model.left) { model.left -= w.size; model.wait.splice(model.wait.indexOf(w), 1); } };
    const check = async () => {
      const d = (await S(page)).dinners.find((x: any) => x.id === 'dec');
      expect(d.left).toBe(model.left);
      expect(d.waitlist).toEqual(model.wait);
    };
    await book(page, 'dec', 6, 'Big Table'); model.left -= 6;
    await book(page, 'dec', 3, 'Small Table'); model.left -= 3;
    await expect(page.getByTestId('left-dec')).toHaveText('Sold out');
    await book(page, 'dec', 5, 'Party of Five'); model.wait.push({ name: 'Party of Five', size: 5 });
    await book(page, 'dec', 2, 'Pair'); model.wait.push({ name: 'Pair', size: 2 });
    await check();
    // freeing 3 seats: the 5 ahead doesn't fit, the 2 behind it does
    await page.getByRole('button', { name: 'Cancel reservation SSC-DEC-002 for Small Table' }).click();
    model.left += 3; promote();
    await check();
    expect(model.left).toBe(1);
    await expect(page.getByTestId('msg')).toHaveText('Cancelled SSC-DEC-002: 3 seats released at Candlelight & Cast Iron. Pair (party of 2) moved off the waitlist.');
    await expect(page.getByTestId('wait-dec-1')).toContainText('Party of Five');
    await expect(page.getByTestId('res-SSC-DEC-003')).toContainText('Pair · 2 seats');
    // freeing 6 more seats lets the party of five in
    await page.getByRole('button', { name: 'Cancel reservation SSC-DEC-001 for Big Table' }).click();
    model.left += 6; promote();
    await check();
    expect(model.left).toBe(2);
    await expect(page.getByTestId('left-dec')).toHaveText('2 seats left');
    await expect(page.getByTestId('wait-list')).toContainText('Not waiting on anything.');
    const held = (await S(page)).reservations.reduce((n: number, r: any) => n + r.size, 0);
    expect(24 - 15 - held).toBe(model.left);
  });

  test('validation: required fields, party size bounds, email shape, note length', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('msg')).toHaveText('Please fix the highlighted fields.');
    await expect(page.getByTestId('f-name')).toBeFocused();              // party size defaults to a valid 2
    await expect(page.getByTestId('f-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('e-email')).toHaveText('We need an email to send the address.');
    await expect(page.getByTestId('f-size')).toHaveAttribute('aria-invalid', 'false');
    await page.getByTestId('f-name').fill('Mae Tolbert');
    for (const bad of ['0', '9', '2.5', '-1', '']) {
      await page.getByTestId('f-size').fill(bad);
      await page.getByTestId('submit').click();
      await expect(page.getByTestId('e-size')).toHaveText('Party size must be a whole number from 1 to 8.');
      await expect(page.getByTestId('f-size')).toBeFocused();
    }
    await page.getByTestId('f-size').fill('8');
    for (const bad of ['mae@', 'mae@example', 'mae example@x.com']) {
      await page.getByTestId('f-email').fill(bad);
      await page.getByTestId('submit').click();
      await expect(page.getByTestId('e-email')).toContainText('name@example.com');
      await expect(page.getByTestId('f-email')).toBeFocused();
    }
    await page.getByTestId('f-email').fill('mae@example.com');
    await page.getByTestId('f-diet').fill('x'.repeat(241));
    await expect(page.getByTestId('diet-count')).toHaveText('241 / 240 characters');
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('e-diet')).toHaveText('Please keep dietary notes to 240 characters.');
    await expect(page.getByTestId('f-diet')).toBeFocused();
    expect((await S(page)).reservations).toHaveLength(0);
    await page.getByTestId('f-diet').fill('x'.repeat(240));
    await page.getByTestId('submit').click();
    // October had 2 seats, so the now-valid party of 8 goes on the waitlist rather than failing
    await expect(page.getByTestId('msg')).toHaveText("You're #1 on the waitlist for First Frost, party of 8. We'll move you up if seats open.");
    expect((await S(page)).waitlist).toHaveLength(1);
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  });

  test('a dinner card picks that dinner in the form and moves focus there', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('pick-jan').click();
    await expect(page.getByTestId('f-dinner')).toHaveValue('jan');
    await expect(page.getByTestId('f-size')).toBeFocused();
    await expect(page.getByTestId('summary')).toContainText('New Year Luck');
    await page.getByTestId('pick-nov').click();
    await expect(page.getByTestId('f-dinner')).toHaveValue('nov');
    await expect(page.getByTestId('summary')).toHaveText('Gulf Coast Supper is sold out. Your party of 2 would be #1 on the waitlist.');
  });

  test('FAQ accordion: Enter/Space toggle, arrows, Home and End move between headers', async ({ page }) => {
    await page.goto(URL);
    const q = (i: number) => page.getByTestId(`faq-q-${i}`), a = (i: number) => page.getByTestId(`faq-a-${i}`);
    await expect(page.locator('#faqList button.q')).toHaveCount(5);
    await expect(a(0)).toBeHidden();
    await q(0).focus();
    await page.keyboard.press('Enter');
    await expect(q(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(a(0)).toBeVisible();
    await expect(a(0)).toContainText('gratuity are included');
    await expect(a(0)).toHaveAttribute('aria-labelledby', 'fq-0');
    await expect(q(0)).toHaveAttribute('aria-controls', 'fa-0');
    await page.keyboard.press('ArrowDown');
    await expect(q(1)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(a(1)).toBeVisible();
    await expect(a(0)).toBeVisible();                                   // panels open independently
    await page.keyboard.press('Space');
    await expect(q(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(a(1)).toBeHidden();
    await page.keyboard.press('End');
    await expect(q(4)).toBeFocused();
    await page.keyboard.press('ArrowDown');                             // wraps to the top
    await expect(q(0)).toBeFocused();
    await page.keyboard.press('ArrowUp');                               // and back round to the bottom
    await expect(q(4)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(q(0)).toBeFocused();
    await q(3).click();
    await expect(a(3)).toContainText('a bigger party ahead of you keeps its place');
  });

  test('responsive: two-column dinners on a wide screen, one column on a phone', async ({ page }) => {
    await page.goto(URL);
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.setViewportSize({ width: 1200, height: 900 });
    let o = await box('dinner-oct'), n = await box('dinner-nov'), d = await box('dinner-dec');
    expect(Math.abs(o.y - n.y)).toBeLessThan(2);                       // side by side
    expect(n.x).toBeGreaterThan(o.x + o.width);
    expect(Math.abs(d.x - o.x)).toBeLessThan(2);                       // next row
    let f = await box('form');
    const ledger = (await page.locator('.ledger').boundingBox())!;
    expect(ledger.x).toBeGreaterThan(f.x + f.width);
    await page.setViewportSize({ width: 390, height: 844 });
    o = await box('dinner-oct'); n = await box('dinner-nov');
    expect(Math.abs(o.x - n.x)).toBeLessThan(2);                       // stacked
    expect(n.y).toBeGreaterThan(o.y + o.height);
    expect(o.x).toBeGreaterThanOrEqual(0);
    expect(o.x + o.width).toBeLessThanOrEqual(390);
    f = await box('form');
    expect(f.x + f.width).toBeLessThanOrEqual(390);
    expect(await overflow()).toBeLessThanOrEqual(1);
    // tap targets stay at least 44px tall on the phone layout
    expect((await box('submit')).height).toBeGreaterThanOrEqual(44);
    expect((await box('faq-q-0')).height).toBeGreaterThanOrEqual(44);
  });

  test('clearly fictional: host note, footer disclaimer, no real venue named', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('fiction-note')).toContainText('fictional');
    await expect(page.getByTestId('footer-fiction')).toContainText('No real reservations are taken');
    await expect(page.locator('footer')).toContainText('not affiliated with any real restaurant');
    await expect(page.getByTestId('host-note')).toContainText('(invented) hosts');
    await expect(page.locator('h1')).toHaveText(/Southside\s*Supper\s*Club/);
    // no address, phone number or outbound link that could point at a real place
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4}/);
    expect(text).not.toMatch(/\b\d{3,5}\s+\w+\s+(Ave|Avenue|St|Street|Blvd)\b/);
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs.every((h) => h!.startsWith('#') || h!.startsWith('../'))).toBe(true);
  });
});
