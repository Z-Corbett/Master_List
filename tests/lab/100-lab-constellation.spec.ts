import { test, expect, Page } from '@playwright/test';

const URL = '/lab/100-lab-constellation.html';
type Item = { id: string; title: string; category: string; tags: string[]; description: string; file: string; tests: number; thumb?: string };
/** The Lab items straight from the site's data file, as the oracle for everything the chart shows. */
const labItems = (page: Page): Promise<Item[]> => page.evaluate(() => ((window as any).PROJECTS || [])
  .filter((p: any) => p.kind === 'lab' || /^lab\//.test(p.file || ''))
  .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })));
const stars = (page: Page) => page.evaluate(() => (window as any).__constellation.stars);
const slug = (c: string) => c.toLowerCase().replace(/[^a-z]+/g, '-');

test.describe('100 The Lab Constellation', () => {
  test('one star per Lab page, grouped by category, brighter with more tests', async ({ page }) => {
    await page.goto(URL);
    const items = await labItems(page);
    expect(items.length).toBeGreaterThanOrEqual(80);
    const s = await stars(page);
    expect(s.map((x: any) => x.id)).toEqual(items.map((i) => i.id));
    await expect(page.locator('#sky .star')).toHaveCount(items.length);
    // counts per constellation match the data
    const byCat: Record<string, number> = {};
    for (const i of items) byCat[i.category] = (byCat[i.category] || 0) + 1;
    for (const [c, n] of Object.entries(byCat)) await expect(page.getByTestId(`count-${slug(c)}`)).toHaveText(String(n));
    await expect(page.getByTestId('chip-all')).toContainText(String(items.length));
    const totalTests = items.reduce((a, i) => a + (i.tests || 0), 0);
    await expect(page.getByTestId('totals')).toContainText(`${items.length}pages · ${totalTests} page tests, each run on desktop + mobile`);
    // brightness: more tests never means a smaller star
    for (const a of s) for (const b of s) if (a.tests > b.tests) expect(a.r).toBeGreaterThan(b.r);
    // each constellation stays together: every star is nearer its own category's centroid than any other's
    const cent: Record<string, { x: number; y: number }> = {};
    for (const c of Object.keys(byCat)) { const m = s.filter((x: any) => x.category === c); cent[c] = { x: m.reduce((a: number, x: any) => a + x.x, 0) / m.length, y: m.reduce((a: number, x: any) => a + x.y, 0) / m.length }; }
    for (const x of s) {
      const d = (c: string) => Math.hypot(x.x - cent[c].x, x.y - cent[c].y);
      for (const c of Object.keys(cent)) if (c !== x.category) expect(d(x.category)).toBeLessThan(d(c));
    }
  });

  test('hover or tap a star for its card; clicking opens the page', async ({ page, isMobile }) => {
    await page.goto(URL);
    const items = await labItems(page);
    const it = items.find((i) => i.id === '013') || items[0];
    const star = page.getByTestId(`star-${it.id}`);
    await star.scrollIntoViewIfNeeded();
    if (isMobile) {
      await star.tap();                                      // first tap: the card, not the page
      await expect(page.getByTestId('card')).toBeVisible();
      await expect(page).toHaveURL(/100-lab-constellation/);
    } else {
      const c = await page.evaluate((id) => (window as any).__constellation.center(id), it.id);
      await page.mouse.move(c.x, c.y);
      await expect(page.getByTestId('card')).toBeVisible();
    }
    await expect(page.getByTestId('card-title')).toHaveText(it.title);
    await expect(page.getByTestId('card-desc')).toHaveText(it.description);
    await expect(page.getByTestId('card-meta')).toHaveText(`No. ${it.id} · ${it.category} · ${it.tests} tests`);
    if (it.thumb) await expect(page.getByTestId('card-thumb')).toHaveAttribute('src', `../${it.thumb}`);
    await expect(page.getByTestId('card-open')).toHaveAttribute('href', `../${it.file}`);
    await expect(star).toHaveAttribute('href', `../${it.file}`);
    if (isMobile) await star.tap();                          // second tap opens it
    else await star.click();
    await expect(page).toHaveURL(new RegExp(`/${it.file.replace(/\./g, '\\.')}$`));
  });

  test('filter by constellation and search across titles, tags and descriptions', async ({ page }) => {
    await page.goto(URL);
    const items = await labItems(page);
    const on = async () => (await stars(page)).filter((x: any) => x.on).map((x: any) => x.id);
    await page.getByTestId('chip-data-viz').click();
    await expect(page.getByTestId('chip-data-viz')).toHaveAttribute('aria-pressed', 'true');
    expect(await on()).toEqual(items.filter((i) => i.category === 'Data Viz').map((i) => i.id));
    await expect(page.getByTestId('status')).toContainText('in Data Viz');
    await page.getByTestId('chip-all').click();
    await page.getByTestId('search').fill('bitcoin');
    const want = items.filter((i) => `${i.title} ${(i.tags || []).join(' ')} ${i.description} ${i.id}`.toLowerCase().includes('bitcoin')).map((i) => i.id);
    expect(want.length).toBeGreaterThan(2);
    expect(await on()).toEqual(want);
    await expect(page.getByTestId('status')).toHaveText(`${want.length} of ${items.length} pages shown for “bitcoin”.`);
    await expect(page.getByTestId(`star-${items.find((i) => !want.includes(i.id))!.id}`)).toHaveClass(/dim/);
    // Enter jumps to the first match
    await page.getByTestId('search').press('Enter');
    await expect(page.getByTestId('card-title')).toHaveText(items.find((i) => i.id === want[0])!.title);
    await page.getByTestId('search').fill('zzzz-nothing');
    expect(await on()).toEqual([]);
  });

  test('the tour flies through every page in order', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-12-24T20:00:00') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-12-24T20:00:01'));
    const items = await labItems(page);
    const step = await page.evaluate(() => (window as any).__constellation.STEP_MS);
    await page.getByTestId('tour').click();
    await expect(page.getByTestId('tourbar')).toBeVisible();
    await expect(page.getByTestId('tour-pos')).toHaveText(`1 / ${items.length}`);
    await expect(page.getByTestId('card-title')).toHaveText(items[0].title);
    await page.clock.runFor(step + 50);
    await expect(page.getByTestId('tour-pos')).toHaveText(`2 / ${items.length}`);
    await expect(page.getByTestId('card-title')).toHaveText(items[1].title);
    await page.clock.runFor(step);
    await expect(page.getByTestId('card-title')).toHaveText(items[2].title);
    // the camera zooms in on the current star
    const v = await page.evaluate(() => (window as any).__constellation.view);
    expect(v.w).toBeLessThan(1000);
    // pause holds it; next / previous and the arrow keys step
    await page.getByTestId('tour-pause').click();
    await page.clock.runFor(step * 3);
    await expect(page.getByTestId('card-title')).toHaveText(items[2].title);
    await page.getByTestId('tour-next').click();
    await expect(page.getByTestId('card-title')).toHaveText(items[3].title);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('card-title')).toHaveText(items[1].title);
    await page.getByTestId('tour-prev').click();
    await page.getByTestId('tour-prev').click();
    await expect(page.getByTestId('tour-pos')).toHaveText(`${items.length} / ${items.length}`);   // wraps round to the last
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tourbar')).toBeHidden();
    await expect(page.getByTestId('status')).toHaveText('Tour ended.');
  });

  test('the list view links every page', async ({ page }) => {
    await page.goto(URL);
    const items = await labItems(page);
    await page.getByTestId('list-view').locator('summary').click();
    await expect(page.locator('[data-testid^="list-"] >> visible=true').filter({ has: page.locator('xpath=self::a') })).toHaveCount(items.length);
    for (const it of [items[0], items[items.length - 1]]) await expect(page.getByTestId(`list-${it.id}`)).toHaveAttribute('href', `../${it.file}`);
  });

  test('without the data file it says so, and nothing breaks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/data/projects.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* data unavailable */' }));
    await page.goto(URL);
    await expect(page.getByTestId('empty')).toBeVisible();
    await expect(page.getByTestId('empty')).toContainText('The sky is overcast');
    await expect(page.locator('#sky .star')).toHaveCount(0);
    await expect(page.getByTestId('tour')).toBeHidden();
    // malformed data is treated the same way
    await page.route('**/data/projects.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.PROJECTS = [{ "id": "C01", "file": "clients/x.html" }, null, 42];' }));
    await page.reload();
    await expect(page.getByTestId('empty')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
