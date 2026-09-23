import { test, expect } from '@playwright/test';

const URL = '/lab/025-bluebonnet-season.html?seed=42';

test.describe('025 Bluebonnet Season', () => {
  test('the meadow grows as the hero is scrolled and is fully in bloom at the end', async ({ page }) => {
    await page.goto(URL);
    const meadow = () => page.evaluate(() => ({ ...(window as any).__meadow }));
    const start = await meadow();
    expect(start.total).toBeGreaterThan(50);
    expect(start.grown).toBeLessThan(start.total / 4);
    await expect(page.getByTestId('flower-total')).toHaveText(String(start.total));

    await page.evaluate(() => window.scrollTo(0, (document.getElementById('scrolly')!.offsetHeight - innerHeight) * 0.45));
    await expect.poll(async () => (await meadow()).grown).toBeGreaterThan(start.grown);
    const mid = await meadow();
    expect(mid.grown).toBeLessThan(mid.total);

    await page.evaluate(() => window.scrollTo(0, document.getElementById('scrolly')!.offsetHeight));
    await expect.poll(async () => (await meadow()).grown).toBe(start.total);
    await expect(page.getByTestId('grown-count')).toHaveText(String(start.total));
  });

  test('the same seed lays out the same meadow; reduced motion shows it fully grown', async ({ page }) => {
    await page.goto(URL);
    const a = await page.evaluate(() => (window as any).__meadow.kinds());
    await page.goto(URL);
    const b = await page.evaluate(() => (window as any).__meadow.kinds());
    expect(b).toEqual(a);
    expect(a.filter((k: string) => k === 'bluebonnet').length).toBeGreaterThan(a.length / 4);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await expect(page.getByTestId('meadow')).toHaveAttribute('data-motion', 'static');
    const m = await page.evaluate(() => ({ ...(window as any).__meadow }));
    expect(m.grown).toBe(m.total);
  });

  test('what\'s-blooming filter narrows the field guide by month and colour', async ({ page }) => {
    await page.goto(URL);
    const cards = page.getByTestId('species-card');
    const visible = async () => (await cards.evaluateAll(els => els.filter(e => !(e as HTMLElement).hidden).map(e => (e as HTMLElement).dataset.species))).sort();

    // default: April
    expect(await visible()).toEqual(['bluebonnet', 'coreopsis', 'paintbrush', 'primrose', 'winecup']);
    await expect(page.getByTestId('bloom-count')).toHaveText('5 species blooming in April');

    await page.getByTestId('month-select').selectOption('6');
    expect(await visible()).not.toContain('bluebonnet');
    expect(await visible()).toContain('blanket');

    await page.getByTestId('colour-red').click();
    await expect(page.getByTestId('colour-red')).toHaveAttribute('aria-pressed', 'true');
    expect(await visible()).toEqual(['blanket', 'hat']);
    await expect(page.getByTestId('bloom-count')).toHaveText('2 species blooming in June · red & orange');

    await page.getByTestId('colour-blue').click();
    expect(await visible()).toEqual([]);
    await expect(page.getByTestId('empty-state')).toBeVisible();

    await page.getByTestId('month-select').selectOption('3');
    expect(await visible()).toEqual(['bluebonnet']);
    await expect(page.getByTestId('empty-state')).toBeHidden();
  });

  test('clicking a calendar month drives the filter, and the grid matches the guide', async ({ page }) => {
    await page.goto(URL);
    const cal = page.getByTestId('bloom-calendar');
    // Every row has one cell per month
    await expect(cal.locator('tbody tr')).toHaveCount(9);
    await expect(cal.locator('tbody tr').first().locator('td')).toHaveCount(12);
    // Bluebonnet row: Mar and Apr on, May off
    const blue = cal.locator('tbody tr').first();
    await expect(blue.locator('td[data-month="3"]')).toHaveClass(/\bon\b/);
    await expect(blue.locator('td[data-month="4"]')).toHaveClass(/peak/);
    await expect(blue.locator('td[data-month="5"]')).not.toHaveClass(/\bon\b/);

    await page.getByTestId('cal-month-7').click();
    await expect(page.getByTestId('cal-month-7')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('month-select')).toHaveValue('7');
    await expect(page.getByTestId('bloom-count')).toHaveText('4 species blooming in July');
    const onInJuly = await cal.locator('td.on[data-month="7"]').count();
    expect(onInJuly).toBe(4);

    await page.getByTestId('cal-month-1').click();
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('trip checklist tracks progress and persists across reloads', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('check-progress')).toHaveText('0 of 10 ready');
    await page.getByTestId('check-water').check();
    await page.getByTestId('check-shoes').check();
    await page.getByTestId('check-fence').check();
    await expect(page.getByTestId('check-progress')).toHaveText('3 of 10 ready');
    expect(await page.getByTestId('check-bar').evaluate(e => (e as HTMLElement).style.width)).toBe('30%');

    await page.reload();
    await expect(page.getByTestId('check-progress')).toHaveText('3 of 10 ready');
    await expect(page.getByTestId('check-shoes')).toBeChecked();

    await page.getByTestId('reset-checks').click();
    await expect(page.getByTestId('check-progress')).toHaveText('0 of 10 ready');
    await expect(page.getByTestId('check-water')).not.toBeChecked();
  });

  test('tour quote applies the group discount and holds seats', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('total')).toHaveText('$178'); // 2 × $89
    await page.getByTestId('tour-brazos').check();
    await expect(page.getByTestId('total')).toHaveText('$218');
    await page.getByTestId('party-inc').click();
    await page.getByTestId('party-inc').click(); // 4 riders
    await expect(page.getByTestId('party')).toHaveText('4');
    await expect(page.getByTestId('subtotal')).toHaveText('$436');
    await expect(page.getByTestId('discount')).toHaveText('−$43.60');
    await expect(page.getByTestId('total')).toHaveText('$392.40');

    for (let i = 0; i < 3; i++) await page.getByTestId('party-dec').click();
    await expect(page.getByTestId('party')).toHaveText('1');
    await expect(page.getByTestId('party-dec')).toBeDisabled();

    await page.getByTestId('hold-seats').click();
    await expect(page.getByTestId('confirmation')).toContainText('1 seat');
    await expect(page.getByTestId('confirmation')).toContainText('Brazos Backroads');
    await expect(page.getByTestId('hold-code')).toHaveText(/^PP-\d{4}$/);
  });
});
