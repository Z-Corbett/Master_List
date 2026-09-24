import { test, expect, Page } from '@playwright/test';

const URL = '/lab/075-mission-trail.html';
const order = (page: Page) => page.evaluate(() => (window as any).__missions.plan.order);

test.describe('075 Mission Trail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await page.evaluate(() => { try { localStorage.removeItem('lab075-plan'); } catch (e) { /* */ } });
    await page.reload();
  });

  test('the five missions are presented with accurate founding dates and a plain link out to the NPS', async ({ page }) => {
    await expect(page.getByTestId('facts')).toContainText('2015');
    await expect(page.getByTestId('facts')).toContainText('1718');
    await expect(page.getByTestId('year-valero')).toContainText('1718');
    await expect(page.getByTestId('year-sanjose')).toContainText('Founded 1720');
    for (const id of ['concepcion', 'sanjuan', 'espada']) await expect(page.getByTestId(`year-${id}`)).toHaveText('Moved here 1731');
    await expect(page.locator('.m-card')).toHaveCount(5);
    await expect(page.getByTestId('mission-valero')).toContainText('Mission San Antonio de Valero');
    // every card carries its own architectural drawing
    for (const id of ['valero', 'concepcion', 'sanjose', 'sanjuan', 'espada'])
      await expect(page.getByTestId(`mission-${id}`).locator('use')).toHaveAttribute('href', `#ill-${id}`);
    // no invented hours/prices: a note and a generic link instead
    await expect(page.getByTestId('nps-note')).toContainText("doesn't list any");
    await expect(page.getByTestId('nps-link')).toHaveAttribute('href', 'https://www.nps.gov/saan/');
    await expect(page.locator('body')).not.toContainText(/\$\d|\(\d{3}\)\s?\d{3}-\d{4}/);
  });

  test('the default plan adds up: legs, distance, moving time and a timed schedule', async ({ page }) => {
    const legs = await page.evaluate(() => (window as any).__missions.legs());
    expect(legs.map((l: any) => l.from + '>' + l.to)).toEqual(['valero>concepcion', 'concepcion>sanjose', 'sanjose>sanjuan', 'sanjuan>espada']);
    for (const l of legs) expect(l.min).toBe(Math.round(l.mi / 8 * 60)); // bike at 8 mph
    const miles = Math.round(legs.reduce((s: number, l: any) => s + l.mi, 0) * 10) / 10;
    const move = legs.reduce((s: number, l: any) => s + l.min, 0);
    await expect(page.getByTestId('sum-dist')).toHaveText(`≈ ${miles.toFixed(1)} mi`);
    await expect(page.getByTestId('sum-stops')).toHaveText('5');
    await expect(page.getByTestId('assumptions')).toContainText('3 mph');
    await expect(page.getByTestId('assumptions')).toContainText('8 mph');
    // 9:00 start, 45 minutes at each stop
    await expect(page.getByTestId('row-valero')).toContainText('9:00 AM');
    await expect(page.getByTestId('row-valero')).toContainText('9:45 AM');
    const arriveC = 9 * 60 + 45 + legs[0].min;
    const clock = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
    await expect(page.getByTestId('row-concepcion')).toContainText(clock(arriveC));
    await expect(page.getByTestId('sum-end')).toHaveText(clock(9 * 60 + move + 5 * 45));
    // walking at 3 mph, 60 minutes per stop, starting at 8:30
    await page.getByTestId('mode-walk').click();
    await expect(page.getByTestId('mode-walk')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('dwell').fill('60');
    await expect(page.getByTestId('dwell-out')).toHaveText('60 min');
    await page.getByTestId('start').fill('08:30');
    const walk = await page.evaluate(() => (window as any).__missions.legs());
    for (const l of walk) expect(l.min).toBe(Math.round(l.mi / 3 * 60));
    const wMove = walk.reduce((s: number, l: any) => s + l.min, 0);
    await expect(page.getByTestId('sum-move')).toHaveText(`${Math.floor(wMove / 60)} h ${String(wMove % 60).padStart(2, '0')} min`);
    await expect(page.getByTestId('sum-end')).toHaveText(clock(8 * 60 + 30 + wMove + 5 * 60));
    await expect(page.getByTestId('stop-concepcion')).toHaveAttribute('data-leg', /^Walk ≈ \d\.\d mi · \d+ min$/);
  });

  test('reorder with the arrow buttons, reverse, and drop stops from the list or the map', async ({ page }) => {
    await page.getByTestId('up-sanjose').click();
    expect(await order(page)).toEqual(['valero', 'sanjose', 'concepcion', 'sanjuan', 'espada']);
    await expect(page.getByTestId('live')).toHaveText('San José moved to position 2.');
    await expect(page.getByTestId('up-sanjose')).toBeFocused();
    await expect(page.locator('#schedBody tr').nth(1)).toContainText('2. San José');
    await page.getByTestId('reverse').click();
    expect(await order(page)).toEqual(['espada', 'sanjuan', 'concepcion', 'sanjose', 'valero']);
    await expect(page.getByTestId('up-espada')).toBeDisabled();
    // the dashed route on the map follows the new order: it starts at Espada
    const [routeStart, espadaAt] = await page.evaluate(() => {
      const d = document.querySelector('[data-testid=route]')!.getAttribute('d')!;
      const t = document.querySelector('[data-testid=marker-espada]')!.getAttribute('transform')!;
      return [d.match(/^M([\d.]+) ([\d.]+)/)!.slice(1).join(' '), t.match(/translate\(([\d.]+) ([\d.]+)\)/)!.slice(1).join(' ')];
    });
    expect(routeStart).toBe(espadaAt);
    await page.getByTestId('include-concepcion').uncheck();
    await expect(page.getByTestId('sum-stops')).toHaveText('4');
    await expect(page.getByTestId('marker-concepcion')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('marker-valero').locator('circle').click();
    await expect(page.getByTestId('sum-stops')).toHaveText('3');
    await expect(page.getByTestId('live')).toHaveText('The Alamo removed from your plan.');
    const legs = await page.evaluate(() => (window as any).__missions.legs());
    expect(legs.map((l: any) => l.to)).toEqual(['sanjuan', 'sanjose']);
    await page.getByTestId('marker-concepcion').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sum-stops')).toHaveText('4');
    await page.getByTestId('southward').click();
    expect(await order(page)).toEqual(['valero', 'concepcion', 'sanjose', 'sanjuan', 'espada']);
  });

  test('dragging a stop by its handle reorders the itinerary', async ({ page }) => {
    const grip = page.getByTestId('stop-espada').locator('[data-grip]');
    await grip.scrollIntoViewIfNeeded();
    const g = (await grip.boundingBox())!;
    const top = (await page.getByTestId('stop-concepcion').boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + (top.y + 4 - (g.y + g.height / 2)) * i / 8);
    await page.mouse.up();
    expect(await order(page)).toEqual(['valero', 'espada', 'concepcion', 'sanjose', 'sanjuan']);
    await expect(page.getByTestId('live')).toHaveText('Espada moved to position 2.');
    await expect(page.getByTestId('stop-espada').locator('.badge')).toHaveText('2');
  });

  test('the plan is saved and comes back after a reload; reset restores the default', async ({ page }) => {
    await page.getByTestId('down-valero').click();
    await page.getByTestId('mode-walk').click();
    await page.getByTestId('include-espada').uncheck();
    await page.reload();
    expect(await order(page)).toEqual(['concepcion', 'valero', 'sanjose', 'sanjuan', 'espada']);
    await expect(page.getByTestId('mode-walk')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('include-espada')).not.toBeChecked();
    await expect(page.getByTestId('sum-stops')).toHaveText('4');
    await page.getByTestId('reset-plan').click();
    await expect(page.getByTestId('sum-stops')).toHaveText('5');
    await expect(page.getByTestId('mode-bike')).toHaveAttribute('aria-pressed', 'true');
  });
});
