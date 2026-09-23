import { test, expect, Page } from '@playwright/test';

const URL = '/lab/010-rose-window.html';

const canvasHash = (page: Page) =>
  page.evaluate(() => {
    const d = (document.querySelector('[data-testid="scene"]') as HTMLCanvasElement).toDataURL();
    let h = 0;
    for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) | 0;
    return h;
  });

test.describe('Rose Window — generative stained glass', () => {
  test.beforeEach(async ({ page }) => {
    // no dust-mote animation, so the canvas is a pure function of seed + sun
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('?seed= makes the window reproducible, a different seed changes it', async ({ page }) => {
    await page.goto(`${URL}?seed=42`);
    await expect(page.getByTestId('seed')).toHaveText('42');
    const a = await canvasHash(page);
    await page.reload();
    expect(await canvasHash(page)).toBe(a);
    await page.goto(`${URL}?seed=43`);
    await expect(page.getByTestId('seed')).toHaveText('43');
    expect(await canvasHash(page)).not.toBe(a);
  });

  test('moving the sun moves the coloured light pool across the floor', async ({ page }) => {
    await page.goto(`${URL}?seed=42`);
    const scene = page.getByTestId('scene');
    const slider = page.getByTestId('sun-slider');

    await slider.fill('20'); // morning: sun in the east, light lands to the west (right)
    const morningX = Number(await scene.getAttribute('data-pool-x'));
    expect(morningX).toBeGreaterThan(600);
    // the floor under the pool is brighter than the mirrored spot on the other side
    const lum = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="scene"]') as HTMLCanvasElement;
      const x = Number(c.dataset.poolX), y = Number(c.dataset.poolY);
      const at = (px: number) => { const d = c.getContext('2d')!.getImageData(px, y, 1, 1).data; return d[0] + d[1] + d[2]; };
      return { lit: at(x), dark: at(1000 - x) };
    });
    expect(lum.lit).toBeGreaterThan(lum.dark + 60);

    await slider.fill('80');
    await expect(page.getByTestId('sun-time')).toHaveText('3:30 pm');
    expect(Number(await scene.getAttribute('data-pool-x'))).toBeLessThan(400);

    // dragging the sun on the sky dial drives the same control
    const box = (await page.getByTestId('sky').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, { steps: 4 });
    await page.mouse.up();
    expect(Number(await slider.inputValue())).toBeLessThan(40);
  });

  test('clicking a pane recolours its whole ring (pointer and keyboard)', async ({ page }) => {
    await page.goto(`${URL}?seed=42`);
    const ringBtn = page.getByTestId('ring-btn-2');
    const before = await ringBtn.getAttribute('data-color');
    const before2 = await canvasHash(page);
    const pt = await page.evaluate(() => (window as any).__rose.ringPoint(2));
    await page.getByTestId('scene').click({ position: pt });
    await expect(ringBtn).not.toHaveAttribute('data-color', before!);
    await expect(page.getByTestId('status')).toContainText('Ring 2 is now');
    expect(await canvasHash(page)).not.toBe(before2);

    const oculus = page.getByTestId('ring-btn-0');
    const oc = await oculus.getAttribute('data-color');
    await oculus.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('ring-btn-0')).not.toHaveAttribute('data-color', oc!);
    await expect(page.getByTestId('ring-btn-0')).toBeFocused();
  });

  test('fold buttons redraw the tracery and keep the seed in the URL', async ({ page }) => {
    await page.goto(`${URL}?seed=42`);
    await page.getByTestId('fold-16').click();
    await expect(page.getByTestId('fold-16')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('scene')).toHaveAttribute('data-folds', '16');
    await expect(page).toHaveURL(/seed=42/);
    await expect(page).toHaveURL(/folds=16/);
    await page.getByTestId('fold-8').click();
    await expect(page.getByTestId('scene')).toHaveAttribute('data-folds', '8');
    await expect(page.getByTestId('fold-16')).toHaveAttribute('aria-pressed', 'false');
  });

  test('"New window" regenerates with a new seed and the PNG download is named after it', async ({ page }) => {
    await page.goto(`${URL}?seed=42`);
    await page.getByTestId('new-window').click();
    const seed = await page.getByTestId('seed').innerText();
    expect(seed).not.toBe('42');
    await expect(page).toHaveURL(new RegExp(`seed=${seed}`));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download').click(),
    ]);
    expect(download.suggestedFilename()).toBe(`rose-window-${seed}.png`);
  });
});
