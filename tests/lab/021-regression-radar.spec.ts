import { test, expect, type Page } from '@playwright/test';

const num = async (page: Page, id: string) => Number(await page.getByTestId(id).textContent());

async function png(page: Page, w: number, h: number, color: string) {
  const url = await page.evaluate(([w, h, c]) => {
    const cv = document.createElement('canvas');
    cv.width = w as number; cv.height = h as number;
    const x = cv.getContext('2d')!;
    x.fillStyle = c as string; x.fillRect(0, 0, cv.width, cv.height);
    x.fillStyle = '#000'; x.fillRect(4, 4, 10, 10);
    return cv.toDataURL('image/png');
  }, [w, h, color]);
  return Buffer.from(url.split(',')[1], 'base64');
}

test.describe('Regression Radar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/021-regression-radar.html');
  });

  test('seeded regressions fail the check and are located as regions', async ({ page }) => {
    await expect(page.getByTestId('verdict')).toHaveText('Fail');
    await expect(page.getByTestId('region-count')).toHaveText('3');
    expect(await num(page, 'diff-pixels')).toBeGreaterThan(await num(page, 'allowed'));

    for (const k of ['padding', 'colour', 'icon', 'weight']) await page.getByTestId(`reg-${k}`).uncheck();
    await expect(page.getByTestId('diff-pixels')).toHaveText('0');
    await expect(page.getByTestId('verdict')).toHaveText('Pass');
    await expect(page.getByTestId('why')).toContainText('identical');

    await page.getByTestId('reg-icon').check();
    await expect(page.getByTestId('verdict')).toHaveText('Fail');
    await expect(page.getByTestId('region-count')).toHaveText('1');
    // the missing truck icon sits in the second progress row
    await expect(page.getByTestId('region-0')).toContainText('y128');
  });

  test('threshold: subtle colour drift hides under the default 0.2', async ({ page }) => {
    for (const k of ['padding', 'icon', 'weight']) await page.getByTestId(`reg-${k}`).uncheck();
    await expect(page.getByTestId('thr-out')).toHaveText('0.20');
    await expect(page.getByTestId('verdict')).toHaveText('Pass');
    await expect(page.getByTestId('diff-pixels')).toHaveText('0');
    await page.getByTestId('threshold').fill('0.05');
    await expect(page.getByTestId('thr-out')).toHaveText('0.05');
    await expect(page.getByTestId('verdict')).toHaveText('Fail');
    await expect(page.getByTestId('region-count')).toHaveText('1');
  });

  test('maxDiffPixelRatio decides whether the same diff passes', async ({ page }) => {
    const diff = await num(page, 'diff-pixels');
    await page.getByTestId('max-ratio').fill('0.05');
    await expect(page.getByTestId('ratio-out')).toHaveText('0.0500');
    await expect(page.getByTestId('allowed')).toHaveText('4320'); // 0.05 × 360 × 240
    await expect(page.getByTestId('diff-pixels')).toHaveText(String(diff));
    await expect(page.getByTestId('verdict')).toHaveText('Pass');
    await expect(page.getByTestId('why')).toContainText('would ship unnoticed');
  });

  test('masking: auto-mask regions, clear, and drag a mask by hand', async ({ page }) => {
    await page.getByTestId('mask-regions').click();
    await expect(page.getByTestId('masks').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('verdict')).toHaveText('Pass');
    await page.getByTestId('clear-masks').click();
    await expect(page.getByTestId('verdict')).toHaveText('Fail');

    await page.getByTestId('mask-mode').click();
    await expect(page.getByTestId('mask-mode')).toHaveAttribute('aria-pressed', 'true');
    const cv = page.getByTestId('canvas-diff');
    await cv.scrollIntoViewIfNeeded();
    const b = (await cv.boundingBox())!;
    await page.mouse.move(b.x + 2, b.y + 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.mouse.move(b.x + b.width - 2, b.y + b.height - 2, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId('mask-0')).toBeVisible();
    await expect(page.getByTestId('diff-pixels')).toHaveText('0');
    await expect(page.getByTestId('why')).toContainText('outside the masked areas');
  });

  test('uploaded images: identical pass, size mismatch fails', async ({ page }) => {
    const a = await png(page, 40, 30, '#3366cc');
    await page.getByTestId('file-baseline').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: a });
    await page.getByTestId('file-candidate').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: a });
    await expect(page.getByTestId('use-mock')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('diff-pixels')).toHaveText('0');
    await expect(page.getByTestId('verdict')).toHaveText('Pass');

    await page.getByTestId('file-candidate').setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: await png(page, 40, 32, '#3366cc') });
    await expect(page.getByTestId('verdict')).toHaveText('Fail');
    await expect(page.getByTestId('why')).toContainText('Size mismatch: expected 40×30 px, received 40×32 px');

    await page.getByTestId('use-mock').click();
    await expect(page.getByTestId('region-count')).toHaveText('3');
  });
});
