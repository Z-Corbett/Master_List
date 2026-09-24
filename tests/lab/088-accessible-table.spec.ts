import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/088-accessible-table.html';
const colValues = (page: Page, col: string) => page.locator(`[data-testid="row"] td[data-col="${col}"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-v')!));
const focusedPos = (page: Page) => page.evaluate(() => {
  const el = document.activeElement!; const cell = el.closest('th, td')!; const row = cell.closest('tr')!;
  return { row: Number(row.getAttribute('aria-rowindex')), col: Number(cell.getAttribute('aria-colindex')) };
});
const tabStops = (page: Page) => page.locator('[data-testid="grid"] [tabindex="0"]').count();

test.describe('Accessible Data Table', () => {
  test('sorting sets aria-sort on exactly one column and orders the rows', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('[data-testid="grid"] th[aria-sort]')).toHaveCount(0);
    await page.getByTestId('sort-stock').click();
    await expect(page.getByTestId('th-stock')).toHaveAttribute('aria-sort', 'ascending');
    let v = (await colValues(page, 'stock')).map(Number);
    expect(v).toEqual([...v].sort((a, b) => a - b));
    await page.getByTestId('sort-stock').click();
    await expect(page.getByTestId('th-stock')).toHaveAttribute('aria-sort', 'descending');
    v = (await colValues(page, 'stock')).map(Number);
    expect(v).toEqual([...v].sort((a, b) => b - a));
    await expect(page.getByTestId('live')).toHaveText('Showing 200 of 200 plants, sorted by Stock descending. Page 1 of 20.');
    await page.getByTestId('sort-plant').click();
    await expect(page.locator('[data-testid="grid"] th[aria-sort]')).toHaveCount(1);
    await expect(page.getByTestId('th-plant')).toHaveAttribute('aria-sort', 'ascending');
    const names = await colValues(page, 'plant');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })));
  });

  test('filters and pagination keep aria-rowcount and aria-rowindex honest', async ({ page }) => {
    await page.goto(URL);
    const grid = page.getByTestId('grid');
    await expect(grid).toHaveAttribute('aria-rowcount', '201');
    await page.getByTestId('page-2').click();
    await expect(page.getByTestId('row').first()).toHaveAttribute('aria-rowindex', '12'); // header is row 1
    await page.getByTestId('category').selectOption('Fern');
    const ferns = await page.evaluate(() => (window as any).__table.rows.filter((r: any) => r.cat === 'Fern').length);
    await expect(grid).toHaveAttribute('aria-rowcount', String(ferns + 1));
    await expect(page.getByTestId('live')).toContainText(`Showing ${ferns} of 200 plants`);
    await expect(page.getByTestId('row').first()).toHaveAttribute('aria-rowindex', '2'); // filters reset to page 1
    await page.getByTestId('search').fill('maidenhair');
    const rows = await page.getByTestId('row').count();
    expect(await page.locator('[data-testid="row"] td[data-col="plant"]').allTextContents()).toEqual(Array(rows).fill(0).map(() => expect.stringContaining('Maidenhair')));
    await page.getByTestId('search').fill('zzz');
    await expect(page.getByTestId('empty')).toBeVisible();
    await expect(page.getByTestId('live')).toContainText('Showing 0 of 200');
    await page.getByTestId('search').fill('');
    await page.getByTestId('category').selectOption('all');
    await page.getByTestId('pagesize').selectOption('50');
    await expect(page.getByTestId('row')).toHaveCount(50);
    await expect(page.getByTestId('live')).toContainText('Page 1 of 4');
  });

  test('ARIA grid keyboard navigation with a single tab stop', async ({ page }) => {
    await page.goto(URL);
    expect(await tabStops(page)).toBe(1);
    await page.getByTestId('search').focus();
    // the one roving tab stop starts on the first data cell
    await page.locator('[data-testid="row"]').first().locator('td[data-col="sku"]').focus();
    expect(await focusedPos(page)).toEqual({ row: 2, col: 2 });
    await page.keyboard.press('ArrowRight');
    expect(await focusedPos(page)).toEqual({ row: 2, col: 3 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await focusedPos(page)).toEqual({ row: 4, col: 3 });
    await page.keyboard.press('End');
    expect(await focusedPos(page)).toEqual({ row: 4, col: 8 });
    await page.keyboard.press('Home');
    expect(await focusedPos(page)).toEqual({ row: 4, col: 1 });
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'row-check'); // the widget inside the cell gets focus
    await page.keyboard.press('PageDown');
    expect(await focusedPos(page)).toEqual({ row: 9, col: 1 });
    await page.keyboard.press('PageDown');
    expect(await focusedPos(page)).toEqual({ row: 11, col: 1 }); // clamps to the last row on the page
    await page.keyboard.press('Control+Home');
    expect(await focusedPos(page)).toEqual({ row: 1, col: 1 });
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'sort-sku');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('th-sku')).toHaveAttribute('aria-sort', 'ascending');
    await page.keyboard.press('Control+End');
    expect(await focusedPos(page)).toEqual({ row: 11, col: 8 });
    expect(await tabStops(page)).toBe(1);
    await expect(page.getByTestId('attr-aria-rowindex')).toHaveText('11');
    await expect(page.getByTestId('attr-aria-colindex')).toHaveText('8');
  });

  test('row selection: Space, checkboxes, select-page tri-state and counts across pages', async ({ page }) => {
    await page.goto(URL);
    const row = (i: number) => page.getByTestId('row').nth(i);
    await row(0).locator('td[data-col="plant"]').click();
    await page.keyboard.press('Space');
    await expect(row(0)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('sel-count')).toHaveText('1');
    await expect(page.getByTestId('live')).toContainText('selected. 1 selected.');
    await row(2).getByTestId('row-check').click();
    await expect(row(2)).toHaveAttribute('aria-selected', 'true');
    const indeterminate = () => page.getByTestId('select-page').evaluate((e) => (e as HTMLInputElement).indeterminate);
    expect(await indeterminate()).toBe(true);
    await page.getByTestId('select-page').click();
    await expect(page.locator('[data-testid="row"][aria-selected="true"]')).toHaveCount(10);
    await expect(page.getByTestId('select-page')).toBeChecked();
    expect(await indeterminate()).toBe(false);
    await page.getByTestId('next').click();
    await expect(page.locator('[data-testid="row"][aria-selected="true"]')).toHaveCount(0);
    await expect(page.getByTestId('select-page')).not.toBeChecked();
    await row(4).getByTestId('row-check').click();
    await expect(page.getByTestId('sel-count')).toHaveText('11');
    await page.getByTestId('clear-sel').click();
    await expect(page.getByTestId('sel-count')).toHaveText('0');
    await expect(page.getByTestId('clear-sel')).toBeDisabled();
  });

  test('the inspector follows focus; the seed controls the dataset', async ({ page }) => {
    await page.goto(URL + '?seed=11');
    const first = await page.evaluate(() => (window as any).__table.view().slice(0, 3));
    await page.getByTestId('sort-price').click();
    await expect(page.getByTestId('attr-role')).toHaveText('columnheader');
    await expect(page.getByTestId('attr-aria-sort')).toHaveText('ascending');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('attr-role')).toHaveText('gridcell');
    await expect(page.getByTestId('attr-aria-rowindex')).toHaveText('2');
    await expect(page.getByTestId('snippet')).toContainText('role="gridcell"');
    await page.goto(URL + '?seed=12');
    const other = await page.evaluate(() => (window as any).__table.rows.slice(0, 5).map((r: any) => r.plant));
    await page.goto(URL + '?seed=11');
    expect(await page.evaluate(() => (window as any).__table.view().slice(0, 3))).toEqual(first);
    const again = await page.evaluate(() => (window as any).__table.rows.slice(0, 5).map((r: any) => r.plant));
    expect(again).not.toEqual(other);
  });
});
