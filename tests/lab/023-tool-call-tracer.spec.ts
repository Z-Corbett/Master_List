import { test, expect } from '@playwright/test';

test.describe('Tool-Call Tracer', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/023-tool-call-tracer.html');
  });

  test('trace summary stats and switching traces', async ({ page }) => {
    await expect(page.getByTestId('trace-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('wall')).toHaveText('64.8s');
    await expect(page.getByTestId('calls')).toHaveText('18');
    await expect(page.getByTestId('critlen')).toHaveText('62.9s');
    await expect(page.locator('.lane')).toHaveCount(3);

    await page.getByTestId('trace-1').click();
    await expect(page.locator('.lane')).toHaveCount(4);
    await expect(page.getByTestId('wall')).toHaveText('77.4s');
    // the failed first test run is marked
    await expect(page.locator('.span.fail')).toHaveCount(1);
    await page.getByTestId('trace-2').click();
    await expect(page.getByTestId('lane-migrate-web')).toBeVisible();
  });

  test('clicking a span shows its input/output; arrow keys walk the lane', async ({ page }) => {
    await page.getByTestId('span-s18').click();
    await expect(page.getByTestId('det-title')).toHaveText('playwright --repeat-each=20');
    await expect(page.getByTestId('det-lane')).toHaveText('orchestrator');
    await expect(page.getByTestId('det-dur')).toHaveText('41.00 s');
    await expect(page.getByTestId('det-input')).toContainText('npx playwright test checkout.spec.ts --repeat-each=20');
    await expect(page.getByTestId('det-output')).toHaveText('20 passed (41.0s)');
    await expect(page.getByTestId('det-crit')).toBeVisible();
    await expect(page.getByTestId('span-s18')).toHaveClass(/\bsel\b/);

    await page.getByTestId('span-s18').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('det-title')).toHaveText('summarise');
    await expect(page.getByTestId('span-s19')).toBeFocused();
  });

  test('critical path follows the slower sub-agent', async ({ page }) => {
    await page.getByTestId('crit-toggle').click();
    await expect(page.getByTestId('viewer')).toHaveClass(/critmode/);
    // ci-reader's 8.4s log fetch outlasts the investigator, so it is on the path
    await expect(page.getByTestId('span-s11')).toHaveClass(/\bcrit\b/);
    await expect(page.getByTestId('span-s6')).not.toHaveClass(/\bcrit\b/);
    // the join ("wait") never counts as critical work
    await expect(page.locator('.span.wait.crit')).toHaveCount(0);
    await expect(page.getByTestId('insight')).toContainText('Tests on the critical path take 41.0s of 64.8s');
  });

  test('tool filters hide spans and can be restored', async ({ page }) => {
    const viewer = page.getByTestId('viewer');
    const before = Number(await viewer.getAttribute('data-visible'));
    await expect(page.getByTestId('filter-bash')).toContainText('2');
    await page.getByTestId('filter-bash').click();
    await expect(page.getByTestId('filter-bash')).toHaveAttribute('aria-pressed', 'false');
    await expect(viewer).toHaveAttribute('data-visible', String(before - 2));
    await expect(page.getByTestId('span-s11')).toBeHidden();
    await page.getByTestId('filter-read').click();
    await expect(viewer).toHaveAttribute('data-visible', String(before - 6));
    await page.getByTestId('filter-bash').click();
    await page.getByTestId('filter-read').click();
    await expect(viewer).toHaveAttribute('data-visible', String(before));
  });

  test('zoom, pan by dragging, and fit', async ({ page }) => {
    await expect(page.getByTestId('range')).toHaveText('0.0–66.1 s');
    await page.getByTestId('zoom-in').click();
    await expect(page.getByTestId('range')).toHaveText('16.5–49.6 s');
    // drag the empty investigator track to the left: the view moves later in time
    const track = page.getByTestId('lane-investigator').locator('.track');
    const b = (await track.boundingBox())!;
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width * 0.9, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.6, y, { steps: 5 });
    await page.mouse.up();
    const [start] = (await page.getByTestId('range').textContent())!.split('–').map(parseFloat);
    expect(start).toBeGreaterThan(16.5);
    await page.getByTestId('zoom-fit').click();
    await expect(page.getByTestId('range')).toHaveText('0.0–66.1 s');
    await page.getByTestId('zoom-out').click();
    await expect(page.getByTestId('range')).toHaveText('0.0–66.1 s'); // cannot zoom out past the whole trace
  });
});
