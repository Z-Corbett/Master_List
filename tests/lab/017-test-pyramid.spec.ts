import { test, expect, type Page } from '@playwright/test';

const num = async (page: Page, id: string) =>
  parseFloat((await page.getByTestId(id).textContent())!.replace(/[^\d.]/g, ''));

const metrics = async (page: Page) => ({
  runtime: await num(page, 'm-runtime'),
  flake: await num(page, 'm-flake'),
  maint: await num(page, 'm-maint'),
  conf: await num(page, 'm-conf'),
});

test.describe('Test Pyramid Builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/017-test-pyramid.html?fresh');
  });

  test('presets are classified by their shape and explained', async ({ page }) => {
    await expect(page.getByTestId('shape')).toHaveText('Empty site');
    const cases: [string, string, RegExp][] = [
      ['preset-pyramid', 'Pyramid', /healthy pyramid/i],
      ['preset-cone', 'Ice-cream cone', /anti-pattern/i],
      ['preset-trophy', 'Testing trophy', /integration tests/i],
      ['preset-hourglass', 'Hourglass', /almost nothing between/i],
    ];
    for (const [btn, shape, text] of cases) {
      await page.getByTestId(btn).click();
      await expect(page.getByTestId(btn)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('shape')).toHaveText(shape);
      await expect(page.getByTestId('explain')).toContainText(text);
    }
  });

  test('the ice-cream cone is slower, flakier and costlier than the pyramid', async ({ page }) => {
    await page.getByTestId('preset-pyramid').click();
    const pyr = await metrics(page);
    await page.getByTestId('preset-cone').click();
    await expect(page.getByTestId('shape')).toHaveText('Ice-cream cone');
    const cone = await metrics(page);
    expect(cone.runtime).toBeGreaterThan(pyr.runtime);
    expect(cone.flake).toBeGreaterThan(pyr.flake);
    expect(cone.maint).toBeGreaterThan(pyr.maint);
    await expect(page.getByTestId('m-runtime-sub')).toContainText('h manual per release');
    await expect(page.getByTestId('insights')).toContainText('person-hours of manual checking');
  });

  test('tapping bundles adds tests and the model matches its formula', async ({ page }) => {
    await page.getByTestId('add-unit').click();
    await page.getByTestId('add-unit').click();
    await page.getByTestId('add-e2e').click();
    await expect(page.getByTestId('row-unit')).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('row-e2e')).toHaveAttribute('data-count', '1');
    await expect(page.getByTestId('budget-spent')).toContainText('20 / 180');
    await expect(page.getByTestId('stage-note')).toHaveText('210 automated tests · 0 manual checks');
    // 200 unit × 0.01s + 10 E2E × 30s = 302s over 4 workers ≈ 1.26 min
    await expect(page.getByTestId('m-runtime')).toHaveText('1.3 min');
    // 1 − (1 − 0.00002)^200 · (1 − 0.02)^10 ≈ 18.6% → 19%
    await expect(page.getByTestId('m-flake')).toHaveText('19%');
    await page.getByTestId('minus-e2e').click();
    await expect(page.getByTestId('row-e2e')).toHaveAttribute('data-count', '0');
    await expect(page.getByTestId('cat-journey')).toHaveText('0%');
  });

  test('budget is enforced and adjustable', async ({ page }) => {
    await page.getByTestId('budget-slider').fill('80');
    await expect(page.getByTestId('budget-spent')).toContainText('0 / 80');
    for (let i = 0; i < 6; i++) await page.getByTestId('add-e2e').click(); // 12h each = 72h
    await expect(page.getByTestId('row-e2e')).toHaveAttribute('data-count', '6');
    await page.getByTestId('add-e2e').click();
    await expect(page.getByTestId('row-e2e')).toHaveAttribute('data-count', '6');
    await expect(page.getByTestId('toast')).toContainText('Over budget');
    await expect(page.getByTestId('plus-e2e')).toBeDisabled();
    await expect(page.getByTestId('shape')).toHaveText('Ice-cream cone');
    await page.getByTestId('clear').click();
    await expect(page.getByTestId('budget-spent')).toContainText('0 / 80');
  });

  test('dragging a bundle onto the site adds it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse drag path; touch users tap (covered above)');
    const src = page.getByTestId('add-integration');
    const box = (await src.boundingBox())!;
    const target = (await page.getByTestId('stage').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    await expect(page.getByTestId('stage')).toHaveClass(/drop/);
    await page.mouse.up();
    await expect(page.getByTestId('row-integration')).toHaveAttribute('data-count', '1');
    // a drag released outside the site adds nothing
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId('row-integration')).toHaveAttribute('data-count', '1');
  });
});
