import { test, expect, Page } from '@playwright/test';

const URL = '/lab/128-pecan-street-books.html';
const H = (page: Page) => page.evaluate(() => { const b = (window as any).__books; return { catalogue: b.catalogue, holds: b.holds, visible: b.visible, estimate: b.estimate }; });
const HOUR = 3600_000;

type Book = { id: string; title: string; author: string; genre: string; format: string; price: number; pick: boolean };
type Crit = { q?: string; genre?: string; format?: string; max?: number; pick?: boolean };
/** The shelf rules, written out in the test: case-insensitive substring on title or author, AND every other filter. */
const expectFilter = (books: Book[], c: Crit) => books.filter((b) =>
  (!c.q || `${b.title}\n${b.author}`.toLowerCase().includes(c.q.trim().toLowerCase()))
  && (!c.genre || b.genre === c.genre) && (!c.format || b.format === c.format)
  && (c.max === undefined || b.price <= c.max * 100) && (!c.pick || b.pick)).map((b) => b.id);

/** The buying rules from the page's own explainer, re-implemented in cents. */
const RATE: Record<string, number> = { 'Like new': 0.30, Good: 0.20, 'Well-read': 0.10, Damaged: 0 };
const offer = (cover: number, cond: string, hard: boolean) => {
  if (!RATE[cond]) return 0;
  const raw = cover * 100 * RATE[cond] + (hard ? 50 : 0);
  return Math.max(25, Math.floor(Math.round(raw * 1000) / 1000 / 25) * 25);
};

async function openAt(page: Page, iso: string) {
  const t = new Date(iso).getTime();
  await page.clock.install({ time: new Date(t - 60_000) });
  await page.goto(URL);
  await page.clock.pauseAt(new Date(t));
}
async function hold(page: Page, id: string, name: string) {
  await page.getByTestId(`hold-${id}`).click();
  await expect(page.getByTestId('hold-name')).toBeFocused();
  await page.getByTestId('hold-name').fill(name);
  await page.getByTestId('hold-place').click();
  await expect(page.getByTestId('hold-form')).toBeHidden();
}
async function addLine(page: Page, price: string, cond: string, qty: number, hard = false) {
  await page.getByTestId('e-price').fill(price);
  await page.getByTestId('e-cond').selectOption(cond);
  await page.getByTestId('e-qty').fill(String(qty));
  await page.getByTestId('e-hard').setChecked(hard);
  await page.getByTestId('e-add').click();
}

test.describe('128 Pecan Street Books', () => {
  test('the shelf: 40 invented books, five per section, all listed on load', async ({ page }) => {
    await page.goto(URL);
    const { catalogue } = await H(page);
    expect(catalogue).toHaveLength(40);
    expect(new Set(catalogue.map((b: Book) => b.title)).size).toBe(40);
    expect(new Set(catalogue.map((b: Book) => b.author)).size).toBe(40);
    const per: Record<string, number> = {};
    for (const b of catalogue) per[b.genre] = (per[b.genre] || 0) + 1;
    expect(Object.values(per)).toEqual(Array(8).fill(5));
    await expect(page.getByTestId('count')).toHaveText('Showing all 40 books');
    await expect(page.locator('[data-testid^="book-"]')).toHaveCount(40);
    await expect(page.getByTestId('f-genre').locator('option')).toHaveCount(9);
    // staff-pick stamps match the data
    await expect(page.locator('.bk .pick')).toHaveCount(catalogue.filter((b: Book) => b.pick).length);
  });

  test('search and filters: counts match the rules computed in the test', async ({ page }) => {
    await page.goto(URL);
    const books: Book[] = (await H(page)).catalogue;
    const set = async (c: Crit) => {
      await page.getByTestId('search').fill(c.q ?? '');
      await page.getByTestId('f-genre').selectOption(c.genre ?? '');
      await page.getByTestId('f-format').selectOption(c.format ?? '');
      await page.getByTestId('f-price').selectOption(c.max ? String(c.max) : '');
      await page.getByTestId('f-pick').setChecked(!!c.pick);
    };
    const cases: [Crit, number | null][] = [
      [{ q: 'armadillo' }, 2],                              // one space opera, one picture book
      [{ q: '  QUADE ' }, 1],                               // author match, case and spaces ignored
      [{ genre: 'Kids' }, 5],
      [{ format: 'hardcover', max: 10 }, null],
      [{ genre: 'Poetry', format: 'paperback', max: 5 }, null],
      [{ pick: true }, null],
      [{ q: 'the', genre: 'Mystery' }, null],
      [{ max: 5 }, null],
    ];
    for (const [c, known] of cases) {
      await set(c);
      const want = expectFilter(books, c);
      if (known !== null) expect(want).toHaveLength(known);
      await expect(page.getByTestId('count')).toHaveText(want.length === 40 ? 'Showing all 40 books' : `Showing ${want.length} of 40 books`);
      const shown = await page.locator('[data-testid^="book-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
      expect(shown, JSON.stringify(c)).toEqual(want);
    }
    await set({ q: 'zzz no such book' });
    await expect(page.getByTestId('count')).toHaveText('Showing 0 of 40 books');
    await expect(page.getByTestId('empty')).toBeVisible();
  });

  test('placing a hold: validation, a Central-time slip and nothing sent', async ({ page }) => {
    await openAt(page, '2026-09-26T15:00:00Z');                     // 10:00 AM CDT
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.getByTestId('hold-b07').click();
    await expect(page.getByTestId('hold-book')).toHaveText("Nine Keys to the Lamplighter's Room ($16.00)");
    await page.getByTestId('hold-name').fill(' x ');
    await page.getByTestId('hold-place').click();
    await expect(page.getByTestId('e-name')).toContainText('at least 2 characters');
    await expect(page.getByTestId('hold-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('hold-name')).toBeFocused();
    expect((await H(page)).holds).toHaveLength(0);
    await page.getByTestId('hold-name').fill('Ramona <i>V</i>');
    await page.getByTestId('hold-place').click();
    // 48 hours after 15:00 UTC Saturday is 15:00 UTC Monday = 10:00 AM CDT (UTC−5)
    const until = 'Mon Sep 28, 10:00 AM CDT';
    await expect(page.getByTestId('msg')).toHaveText(`Held: Nine Keys to the Lamplighter's Room for Ramona <i>V</i>, until ${until}. Slip PSB-001. Nothing was sent.`);
    await expect(page.getByTestId('until-PSB-001')).toHaveText(`Hold until ${until}`);
    await expect(page.getByTestId('left-PSB-001')).toHaveText('48 h 00 m left');
    await expect(page.getByTestId('slip-PSB-001').locator('i')).toHaveCount(0);   // markup shown as text
    await expect(page.getByTestId('hold-b07')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('hold-b07')).toBeFocused();                    // focus goes back to the book
    await expect(page.getByTestId('hold-count')).toHaveText('(1 of 3)');
    const h = (await H(page)).holds[0];
    expect(h.expires - h.placed).toBe(48 * HOUR);
    expect(h.placed).toBe(Date.parse('2026-09-26T15:00:00Z'));
    // "hide books on hold" removes it from the shelf count
    await page.getByTestId('f-avail').check();
    await expect(page.getByTestId('count')).toHaveText('Showing 39 of 40 books');
    expect(requests).toEqual([]);
  });

  test('at most three holds; releasing one frees a slot', async ({ page }) => {
    await openAt(page, '2026-09-26T15:00:00Z');
    for (const id of ['b01', 'b11', 'b32']) await hold(page, id, 'Otto');
    await expect(page.getByTestId('hold-count')).toHaveText('(3 of 3)');
    await page.getByTestId('hold-b40').click();
    await expect(page.getByTestId('msg')).toHaveText('You already have 3 books on hold, the most we keep for one reader. Release one first.');
    await expect(page.getByTestId('hold-form')).toBeHidden();
    expect((await H(page)).holds.map((h: any) => h.book)).toEqual(['b01', 'b11', 'b32']);
    // release from the slip, then the fourth book can be held
    await page.getByRole('button', { name: 'Release hold PSB-002 on Orbitals of the Armadillo Queen' }).click();
    await expect(page.getByTestId('msg')).toHaveText("Released Orbitals of the Armadillo Queen. It's back on the shelf.");
    await expect(page.getByTestId('hold-b11')).toHaveAttribute('aria-pressed', 'false');
    await hold(page, 'b40', 'Otto');
    await expect(page.getByTestId('hold-count')).toHaveText('(3 of 3)');
    // the shelf button toggles too: pressing a held book releases it
    await page.getByTestId('hold-b01').click();
    await expect(page.getByTestId('hold-count')).toHaveText('(2 of 3)');
    expect((await H(page)).holds.map((h: any) => h.code)).toEqual(['PSB-003', 'PSB-004']);
  });

  test('holds expire after 48 hours on the fake clock, each on its own schedule', async ({ page }) => {
    await openAt(page, '2026-09-26T15:00:00Z');
    await hold(page, 'b17', 'Ines');                               // expires Mon 15:00 UTC
    await page.clock.runFor(HOUR);
    await hold(page, 'b27', 'Ines');                               // expires Mon 16:00 UTC
    await expect(page.getByTestId('left-PSB-002')).toHaveText('48 h 00 m left');
    await page.clock.runFor(47 * HOUR - 60_000);                   // one minute before the first expiry
    expect((await H(page)).holds).toHaveLength(2);
    await expect(page.getByTestId('hold-b17')).toHaveAttribute('aria-pressed', 'true');
    await page.clock.runFor(60_000);
    await expect(page.getByTestId('msg')).toHaveText("Your hold on Limestone Psalms expired; it's back on the shelf.");
    expect((await H(page)).holds.map((h: any) => h.code)).toEqual(['PSB-002']);
    await expect(page.getByTestId('hold-b17')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('hold-count')).toHaveText('(1 of 3)');
    await page.clock.runFor(HOUR - 1);
    expect((await H(page)).holds).toHaveLength(1);                 // not a millisecond early
    await page.clock.runFor(1);
    await expect(page.getByTestId('hold-count')).toHaveText('(0 of 3)');
    await expect(page.getByTestId('msg')).toContainText('The Ranch That Moved Twice expired');
  });

  test('hold time is shown in Central time, across the end of daylight saving', async ({ page }) => {
    // US DST ends at 2:00 AM on Sunday, November 1, 2026: a hold placed Saturday at 10 AM CDT lapses Monday at 9 AM CST.
    await openAt(page, '2026-10-31T15:00:00Z');
    await hold(page, 'b05', 'Cal');
    await expect(page.getByTestId('until-PSB-001')).toHaveText('Hold until Mon Nov 2, 9:00 AM CST');
    const f = await page.evaluate(() => [(window as any).__books.fmtCentral(Date.parse('2026-07-04T00:30:00Z')), (window as any).__books.fmtCentral(Date.parse('2027-01-01T06:00:00Z'))]);
    expect(f).toEqual(['Fri Jul 3, 7:30 PM CDT', 'Fri Jan 1, 12:00 AM CST']);
  });

  test('keyboard: / jumps to search, arrows rove through the books, Enter holds, Escape backs out', async ({ page }) => {
    await page.goto(URL);
    await page.locator('h1').click();
    await page.keyboard.press('/');
    await expect(page.getByTestId('search')).toBeFocused();
    await page.keyboard.type('kids');                              // "/" itself wasn't typed
    await expect(page.getByTestId('search')).toHaveValue('kids');
    await page.getByTestId('search').fill('');
    await page.getByTestId('f-genre').selectOption('Cooking');
    await expect(page.locator('#books button[tabindex="0"]')).toHaveCount(1);
    await page.getByTestId('hold-b36').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('hold-b37')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByTestId('hold-b40')).toBeFocused();
    await page.keyboard.press('ArrowDown');                        // stops at the end
    await expect(page.getByTestId('hold-b40')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('hold-b36')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('hold-b36')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#books button[tabindex="0"]')).toHaveCount(1);
    await expect(page.getByTestId('hold-b37')).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hold-name')).toBeFocused();
    await expect(page.getByTestId('hold-book')).toContainText('The Tortilla Ledger');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hold-form')).toBeHidden();
    await expect(page.getByTestId('hold-b37')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Nell');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hold-b37')).toBeFocused();
    await expect(page.getByTestId('hold-b37')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');                            // Space on the same button releases it
    await expect(page.getByTestId('hold-b37')).toHaveAttribute('aria-pressed', 'false');
    expect((await H(page)).holds).toHaveLength(0);
  });

  test('sell-us-your-books estimator follows its written rules', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('totals')).toHaveText('Add a book to see an offer.');
    const lines: [string, string, number, boolean][] = [
      ['12.99', 'Good', 2, false],        // 259.8¢ → 250¢ each
      ['28', 'Like new', 1, true],        // 840 + 50 = 890¢ → 875¢
      ['4.99', 'Well-read', 1, false],    // 49.9¢ → 25¢ floor
      ['$30.00', 'Damaged', 1, false],    // no offer
      ['19.95', 'Well-read', 3, true],    // 199.5 + 50 = 249.5¢ → 225¢
    ];
    let cash = 0, books = 0;
    for (const [i, [p, cond, qty, hard]] of lines.entries()) {
      await addLine(page, p, cond, qty, hard);
      const each = offer(parseFloat(p.replace('$', '')), cond, hard);
      cash += each * qty; books += qty;
      await expect(page.getByTestId(`line-${i}`)).toContainText(each ? `$${(each / 100).toFixed(2)} each = $${(each * qty / 100).toFixed(2)}` : 'no offer = $0.00');
    }
    expect(cash).toBe(500 + 875 + 25 + 0 + 675);
    const credit = Math.floor(cash * 1.5);
    await expect(page.getByTestId('cash')).toHaveText(`$${(cash / 100).toFixed(2)}`);
    await expect(page.getByTestId('credit')).toHaveText(`$${(credit / 100).toFixed(2)}`);
    await expect(page.getByTestId('totals')).toContainText(`${books} books`);
    expect((await H(page)).estimate).toMatchObject({ cash, credit, books });
    // removing a line updates the totals
    await page.getByRole('button', { name: 'Remove line 1' }).click();
    await expect(page.getByTestId('cash')).toHaveText(`$${((cash - 500) / 100).toFixed(2)}`);
  });

  test('estimator validation: price format and range, whole copies, 20 books per visit', async ({ page }) => {
    await page.goto(URL);
    for (const bad of ['', 'abc', '0.50', '250', '3.999', '-4']) {
      await addLine(page, bad, 'Good', 1);
      await expect(page.getByTestId('e-price-err')).toHaveText('Enter the cover price in dollars, from $1.00 to $200.00.');
      await expect(page.getByTestId('e-price')).toBeFocused();
    }
    for (const bad of [0, 21]) {
      await addLine(page, '10', 'Good', bad);
      await expect(page.getByTestId('e-qty-err')).toHaveText('Copies must be a whole number from 1 to 20.');
      await expect(page.getByTestId('e-qty')).toBeFocused();
    }
    await addLine(page, '10', 'Good', 18);
    await addLine(page, '10', 'Good', 3);
    await expect(page.getByTestId('e-qty-err')).toHaveText("That makes 21 books; we can look at 20 per visit.");
    await addLine(page, '1', 'Good', 2);
    await expect(page.getByTestId('e-qty-err')).toHaveText('');
    // $10 Good = 200¢ ×18, $1 Good = 20¢ → 25¢ floor ×2
    expect((await H(page)).estimate).toMatchObject({ books: 20, cash: 18 * 200 + 2 * 25 });
  });

  test('events fall on the weekdays they claim; staff picks are real picks from the shelf', async ({ page }) => {
    await page.goto(URL);
    const want = [['2026-10-10', 6], ['2026-10-15', 4], ['2026-10-31', 6], ['2026-11-12', 4]] as const;
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (const [i, [iso, wd]] of want.entries()) {
      const [y, m, d] = iso.split('-').map(Number);
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(wd);
      await expect(page.getByTestId(`event-when-${i}`)).toContainText(`${days[wd]}, ${mo[m - 1]} ${d}, ${y}`);
    }
    const { catalogue } = await H(page);
    const cards = await page.locator('[data-testid^="pick-b"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)));
    expect(cards).toHaveLength(4);
    for (const id of cards) expect(catalogue.find((b: Book) => b.id === id).pick).toBe(true);
    // the book-club event is for a book that is actually on the shelf
    expect(catalogue.some((b: Book) => b.title === 'The Last Bus to Buda')).toBe(true);
  });

  test('responsive: three-column shelf on desktop, one column and big tap targets on a phone', async ({ page }) => {
    await page.goto(URL);
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    await page.setViewportSize({ width: 1200, height: 900 });
    let a = await box('book-b01'), b = await box('book-b02'), c = await box('book-b03'), d = await box('book-b04');
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(Math.abs(a.y - c.y)).toBeLessThan(2);
    expect(c.x).toBeGreaterThan(b.x + b.width);
    expect(Math.abs(d.x - a.x)).toBeLessThan(2);                 // fourth wraps to the next row
    await page.setViewportSize({ width: 390, height: 844 });
    a = await box('book-b01'); b = await box('book-b02');
    expect(Math.abs(a.x - b.x)).toBeLessThan(2);
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(a.x + a.width).toBeLessThanOrEqual(390);
    const search = await box('search'), genre = await box('f-genre');
    expect(genre.y).toBeGreaterThan(search.y + search.height);    // filters stack
    expect(search.x + search.width).toBeLessThanOrEqual(390);
    for (const id of ['hold-b01', 'search', 'f-genre', 'e-add']) expect((await box(id)).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  test('clearly fictional: notices, invented catalogue, no real contact details or outbound links', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('fiction-note')).toContainText('fictional');
    await expect(page.getByTestId('footer-fiction')).toContainText('nothing on this page is sent over the network');
    await expect(page.locator('footer')).toContainText('every title and author on this page is made up');
    await expect(page.locator('footer')).toContainText('not affiliated with any real bookstore');
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4}/);
    expect(text).not.toMatch(/\b\d{2,5}\s+\w+\s+(Ave|Avenue|St|Street|Blvd)\b/);
    expect(text).not.toMatch(/ISBN/i);
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs.every((h) => h!.startsWith('#') || h!.startsWith('../'))).toBe(true);
  });
});
