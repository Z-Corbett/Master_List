import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/032-pixel-press.html?blank=1';

const px = (page: Page, x: number, y: number, f?: number) => page.evaluate(([x, y, f]) => (window as any).__pixel.pixel(x, y, f ?? undefined), [x, y, f ?? null] as const);
const count = (page: Page, f?: number) => page.evaluate(f => (window as any).__pixel.count(f ?? undefined), f ?? null);

async function cellPos(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const size = await page.evaluate(() => (window as any).__pixel.size);
  const c = box.width / size;
  return { x: box.x + (x + 0.5) * c, y: box.y + (y + 0.5) * c, local: { x: (x + 0.5) * c, y: (y + 0.5) * c } };
}
async function clickCell(page: Page, x: number, y: number) {
  const p = await cellPos(page, x, y);
  await page.getByTestId('canvas').click({ position: p.local });
}
async function dragCells(page: Page, from: [number, number], to: [number, number]) {
  const a = await cellPos(page, ...from), b = await cellPos(page, ...to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
}

test.describe('032 Pixel Press', () => {
  test('first visit shows a four-frame starter sprite; ?blank=1 starts empty', async ({ page }) => {
    await page.goto('/lab/032-pixel-press.html');
    for (const f of [0, 1, 2, 3]) expect(await count(page, f)).toBeGreaterThan(20);
    expect(await count(page, 1)).toBeGreaterThan(await count(page, 3)); // the heart beats: big frame vs small frame
    // Autosave is debounced (250 ms). Let the pending save land first, or it re-saves the heart after we clear.
    await expect(page.locator('#saved')).toHaveText('Saved locally');
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    expect(await count(page)).toBe(0);
  });

  test('pencil, eraser, undo/redo by button and keyboard', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('swatch-3').click();
    const color = await page.getByTestId('current-color').textContent();
    await clickCell(page, 3, 4);
    expect(await px(page, 3, 4)).toBe(color);
    await page.getByTestId('tool-eraser').click();
    await clickCell(page, 3, 4);
    expect(await px(page, 3, 4)).toBeNull();

    await page.getByTestId('undo').click();
    expect(await px(page, 3, 4)).toBe(color);
    await page.getByTestId('redo').click();
    expect(await px(page, 3, 4)).toBeNull();
    await page.keyboard.press('Control+z');
    expect(await px(page, 3, 4)).toBe(color);
    await page.keyboard.press('Control+y');
    expect(await px(page, 3, 4)).toBeNull();
    // tool shortcuts
    await page.keyboard.press('b');
    await expect(page.getByTestId('tool-pencil')).toHaveAttribute('aria-pressed', 'true');
  });

  test('line tool draws a Bresenham box; flood fill fills only the inside', async ({ page }) => {
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 900 });
    await page.goto(URL);
    await page.getByTestId('size-select').selectOption('16');
    await page.getByTestId('tool-line').click();
    await dragCells(page, [2, 2], [9, 2]);
    await dragCells(page, [9, 2], [9, 8]);
    await dragCells(page, [9, 8], [2, 8]);
    await dragCells(page, [2, 8], [2, 2]);
    expect(await count(page)).toBe(2 * 8 + 2 * 5); // 8 wide × 7 tall outline
    await page.getByTestId('swatch-6').click();
    const fillColor = await page.getByTestId('current-color').textContent();
    await page.getByTestId('tool-fill').click();
    await clickCell(page, 5, 5);
    await expect(page.getByTestId('toast')).toHaveText('Filled 30 pixels'); // 6 × 5 interior
    expect(await px(page, 5, 5)).toBe(fillColor);
    expect(await px(page, 12, 12)).toBeNull();
    // eyedropper picks the fill colour back after switching away
    await page.getByTestId('swatch-0').click();
    await page.getByTestId('tool-picker').click();
    await clickCell(page, 4, 4);
    await expect(page.getByTestId('current-color')).toHaveText(fillColor!);
    await expect(page.getByTestId('tool-pencil')).toHaveAttribute('aria-pressed', 'true');
  });

  test('mirror mode reflects strokes across the vertical centre; size change is undoable', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('size-select').selectOption('16');
    await page.getByTestId('mirror').click();
    await expect(page.getByTestId('mirror')).toHaveAttribute('aria-pressed', 'true');
    await clickCell(page, 2, 6);
    expect(await px(page, 2, 6)).not.toBeNull();
    expect(await px(page, 13, 6)).toBe(await px(page, 2, 6));
    expect(await count(page)).toBe(2);
    await page.getByTestId('size-select').selectOption('64');
    expect(await page.evaluate(() => (window as any).__pixel.size)).toBe(64);
    expect(await count(page)).toBe(0);
    await page.getByTestId('undo').click();
    expect(await page.evaluate(() => (window as any).__pixel.size)).toBe(16);
    expect(await count(page)).toBe(2);
  });

  test('frames are independent, copy to next works, and the preview animates on the clock', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-23T10:00:00') });
    await page.clock.pauseAt(new Date('2026-09-23T10:00:01'));
    await page.goto(URL);
    await clickCell(page, 1, 1);
    await page.getByTestId('copy-to-next').click();
    await expect(page.getByTestId('frame-2')).toHaveAttribute('aria-pressed', 'true');
    expect(await px(page, 1, 1, 1)).not.toBeNull();
    await clickCell(page, 5, 5);
    expect(await count(page, 1)).toBe(2);
    expect(await count(page, 0)).toBe(1);
    await page.getByTestId('frame-3').click();
    expect(await count(page)).toBe(0);

    await page.getByTestId('play').click(); // 6 fps
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) { await page.clock.runFor(170); seen.add(await page.evaluate(() => (window as any).__pixel.previewFrame)); }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'false');
  });

  test('exports a scaled PNG, imports it back, and autosaves across reloads', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('size-select').selectOption('16');
    await clickCell(page, 0, 0);
    await clickCell(page, 15, 15);
    const color = await page.getByTestId('current-color').textContent();
    await page.getByTestId('export-scale').selectOption('4');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
    expect(download.suggestedFilename()).toBe('pixel-press-frame1-16px-x4.png');
    const file = await download.path();
    const png = readFileSync(file!);
    expect(png.readUInt32BE(16)).toBe(64); // IHDR width
    expect(png.readUInt32BE(20)).toBe(64); // IHDR height

    await page.getByTestId('clear-frame').click();
    expect(await count(page)).toBe(0);
    await page.getByTestId('import').setInputFiles(file!);
    await expect(page.getByTestId('toast')).toContainText('Imported');
    expect(await px(page, 0, 0)).toBe(color);
    expect(await px(page, 15, 15)).toBe(color);
    expect(await count(page)).toBe(2);

    await expect(page.getByTestId('save-status')).toHaveText('Saved locally');
    await page.reload();
    expect(await page.evaluate(() => (window as any).__pixel.size)).toBe(16);
    expect(await px(page, 15, 15)).toBe(color);
  });
});
