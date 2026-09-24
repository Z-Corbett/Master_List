import { test, expect, type Page } from '@playwright/test';

const txt = (page: Page, id: string) => page.getByTestId(id).textContent();
const num = async (page: Page, id: string) => Number(await txt(page, id));
const width = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!.width;

test.describe('Layout Lab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/033-layout-lab.html');
  });

  test('auto-fill keeps empty tracks, auto-fit collapses them and stretches the items', async ({ page }) => {
    await page.getByTestId('count').fill('2');
    await page.getByTestId('grid-min').fill('80');
    await expect(page.getByTestId('css-out')).toContainText('repeat(auto-fill, minmax(80px, 1fr))');
    await expect.poll(() => num(page, 'track-empty')).toBeGreaterThanOrEqual(1);
    expect(await num(page, 'track-collapsed')).toBe(0);
    const fillW = await width(page, 'item-0');

    await page.getByTestId('kind-fit').click();
    await expect(page.getByTestId('kind-fit')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('css-out')).toContainText('repeat(auto-fit, minmax(80px, 1fr))');
    await expect.poll(() => num(page, 'track-collapsed')).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('track-empty')).toHaveText('0');
    await expect(page.getByTestId('track-count')).toHaveText('2');
    expect(await width(page, 'item-0')).toBeGreaterThan(fillW + 20);
  });

  test('holy grail recipe: named areas, then a container query stacks it', async ({ page }) => {
    await page.getByTestId('recipe-holy-grail').click();
    const css = page.getByTestId('css-out');
    await expect(css).toContainText('"header header header"');
    await expect(css).toContainText('@container lab (max-width: 520px)');
    await expect(page.getByTestId('item-2')).toHaveAccessibleName('Item main');
    await expect(page.getByTestId('count')).toBeDisabled();

    const handle = page.getByTestId('handle');
    await handle.focus();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('container-width')).toHaveText('192px'); // 220 minus padding and border
    await expect(page.getByTestId('cq-state')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('track-count')).toHaveText('1');
    await expect(page.getByTestId('row-count')).toHaveText('5');

    // lower the breakpoint under the widest container this viewport allows, then widen: 3 columns come back
    await page.getByTestId('cq-bp').fill('240');
    await handle.focus();
    await page.keyboard.press('End');
    await expect(page.getByTestId('cq-state')).toHaveAttribute('data-state', 'inactive');
    await expect(page.getByTestId('track-count')).toHaveText('3');
    await expect(page.getByTestId('row-count')).toHaveText('3');
    const cols = await page.getByTestId('stage').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(3);
  });

  test('dragging the handle resizes the container and the grid reflows', async ({ page }) => {
    await page.getByTestId('grid-min').fill('60');
    await expect.poll(() => num(page, 'track-count')).toBeGreaterThanOrEqual(3);
    const h = page.getByTestId('handle');
    await h.scrollIntoViewIfNeeded();
    const b = (await h.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x - 200, b.y + b.height / 2, { steps: 5 });
    await page.mouse.move(b.x - 2000, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId('container-width')).toHaveText('192px');
    // floor((192 + 12) / (60 + 12)) = 2 tracks
    await expect(page.getByTestId('track-count')).toHaveText('2');
    await expect(h).toHaveAttribute('aria-valuenow', '220');
  });

  test('flexbox: wrap, per-item flex-grow and direction', async ({ page }) => {
    await page.getByTestId('mode-flex').click();
    await expect(page.getByTestId('css-out')).toContainText('display: flex');
    await page.getByTestId('count').fill('3');
    await page.getByTestId('flex-wrap').selectOption('nowrap');
    await expect(page.getByTestId('row-count')).toHaveText('1');

    await page.getByTestId('item-0').click();
    await expect(page.getByTestId('item-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('item-who')).toContainText('.item:nth-child(1)');
    await page.getByTestId('item-grow').fill('1');
    await expect(page.getByTestId('css-out')).toContainText('.item:nth-child(1) {\n  flex: 1 1 auto;\n}');
    expect(await width(page, 'item-0')).toBeGreaterThan((await width(page, 'item-1')) * 2);

    await page.getByTestId('flex-direction').selectOption('column');
    await expect(page.getByTestId('row-count')).toHaveText('3');
    await page.getByTestId('item-reset').click();
    await expect(page.getByTestId('css-out')).not.toContainText('nth-child');
  });

  test('masonry recipe: the printed CSS is exactly the CSS that runs', async ({ page }) => {
    await page.getByTestId('recipe-masonry').click();
    await expect(page.getByTestId('recipe-masonry')).toHaveAttribute('aria-pressed', 'true');
    const css = page.getByTestId('css-out');
    await expect(css).toContainText('grid-auto-flow: row dense');
    await expect(css).toContainText('grid-row: span 12');
    await expect(css).toContainText('grid-column: span 2');
    // span 12 at 10px rows + 8px gaps = 12*10 + 11*8 = 208px
    await expect.poll(async () => Math.round((await page.getByTestId('item-2').boundingBox())!.height)).toBe(208);
    const [live, shown] = await Promise.all([
      page.getByTestId('live-css').evaluate((el) => el.textContent),
      css.textContent(),
    ]);
    expect(shown).toBe(live);
    await page.getByTestId('copy').click();
    await expect(page.getByTestId('copy-status')).toHaveText(/Copied \d+ lines|Selected/);
    // editing any control drops the recipe highlight
    await page.getByTestId('gap').fill('20');
    await expect(page.getByTestId('recipe-masonry')).toHaveAttribute('aria-pressed', 'false');
  });

  test('template areas are validated before they are applied', async ({ page }) => {
    const areas = page.getByTestId('grid-areas');
    await areas.fill('a b\nc');
    await expect(page.getByTestId('areas-err')).toHaveText(/same number of cells/);
    await expect(areas).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('css-out')).not.toContainText('grid-template-areas');
    await areas.fill('a b\nb b');
    await expect(page.getByTestId('areas-err')).toHaveText(/single rectangle/);
    await areas.fill('a a\nb c');
    await expect(page.getByTestId('areas-err')).toBeHidden();
    await expect(page.getByTestId('count-out')).toHaveText('3');
    await expect(page.getByTestId('stage').getByRole('button')).toHaveCount(3);
    await expect(page.getByTestId('css-out')).toContainText('.item:nth-child(3) {\n  grid-area: c;\n}');
  });
});
