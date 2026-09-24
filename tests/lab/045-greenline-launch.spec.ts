import { test, expect, Page } from '@playwright/test';

const URL = '/lab/045-greenline-launch.html';

async function fresh(page: Page) {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test.describe('045 Greenline landing page', () => {
  test('pricing toggle: annual billing applies exactly 20% and shows the yearly total and savings', async ({ page }) => {
    await fresh(page);
    const toggle = page.getByTestId('billing-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('price-team')).toHaveText('$40');
    await expect(page.getByTestId('price-growth')).toHaveText('$125');
    await expect(page.getByTestId('billed-team')).toHaveText('Billed monthly, or $32/mo on annual.');
    await expect(page.getByTestId('plan-starter')).toContainText('$0');
    await expect(page.getByTestId('plan-enterprise')).toContainText('Custom');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    // oracle: monthly × 0.8, yearly = 12 × that, saving = 12 × monthly − yearly
    for (const [id, monthly] of [['team', 40], ['growth', 125]] as const) {
      const per = monthly * 0.8, yearly = per * 12, saved = monthly * 12 - yearly;
      await expect(page.getByTestId(`price-${id}`)).toHaveText(`$${per}`);
      await expect(page.getByTestId(`billed-${id}`)).toHaveText(
        `Billed $${yearly.toLocaleString('en-US')} yearly. $${(monthly * 12).toLocaleString('en-US')} save $${saved}`);
    }
    await expect(page.getByTestId('billed-growth')).toHaveText('Billed $1,200 yearly. $1,500 save $300');
    // the choice sticks
    await page.reload();
    await expect(page.getByTestId('billing-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('price-team')).toHaveText('$32');
  });

  test('feature tabs follow the ARIA tabs pattern with click and arrow keys', async ({ page }) => {
    await fresh(page);
    const ids = ['parallel', 'flake', 'visual', 'trace'];
    await expect(page.getByRole('tab', { name: 'Parallel runs' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('panel-parallel')).toBeVisible();
    for (const id of ids.slice(1)) await expect(page.getByTestId(`panel-${id}`)).toBeHidden();

    await page.getByTestId('tab-visual').click();
    await expect(page.getByTestId('tab-visual')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('panel-visual')).toBeVisible();
    await expect(page.getByTestId('panel-visual')).toContainText('Pixel diffs that ignore the noise');
    await expect(page.getByTestId('panel-parallel')).toBeHidden();

    await page.getByTestId('tab-visual').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-trace')).toBeFocused();
    await expect(page.getByTestId('tab-trace')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight'); // wraps
    await expect(page.getByTestId('tab-parallel')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page.getByTestId('panel-trace')).toBeVisible();
    // roving tabindex: only the selected tab is in the tab order
    await expect(page.locator('[role=tab][tabindex="0"]')).toHaveCount(1);
  });

  test('testimonial carousel: buttons, dots, keyboard and swipe', async ({ page }) => {
    await fresh(page);
    const car = page.getByTestId('carousel');
    await expect(page.getByTestId('car-count')).toHaveText('1 / 4');
    await page.getByTestId('car-next').click();
    await expect(page.getByTestId('car-count')).toHaveText('2 / 4');
    await expect(page.getByTestId('slide-1')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.getByTestId('slide-0')).toHaveAttribute('aria-hidden', 'true');
    await page.getByTestId('car-prev').click();
    await page.getByTestId('car-prev').click(); // wraps to the last one
    await expect(page.getByTestId('car-count')).toHaveText('4 / 4');
    await page.getByTestId('car-dot-2').click();
    await expect(page.getByTestId('car-dot-2')).toHaveAttribute('aria-current', 'true');
    await car.focus();
    await page.keyboard.press('ArrowRight');
    await expect(car).toHaveAttribute('data-index', '3');
    await page.keyboard.press('ArrowLeft');
    await expect(car).toHaveAttribute('data-index', '2');
    // swipe left = next, swipe right = previous, a vertical drag does nothing
    const vp = page.getByTestId('carousel-viewport');
    const swipe = async (x0: number, x1: number, y1 = 200) => {
      await vp.dispatchEvent('pointerdown', { clientX: x0, clientY: 200, pointerType: 'touch', isPrimary: true });
      await vp.dispatchEvent('pointerup', { clientX: x1, clientY: y1, pointerType: 'touch', isPrimary: true });
    };
    await swipe(300, 120);
    await expect(car).toHaveAttribute('data-index', '3');
    await swipe(100, 320);
    await expect(car).toHaveAttribute('data-index', '2');
    await swipe(200, 230, 420);
    await expect(car).toHaveAttribute('data-index', '2');
    await expect(page.getByTestId('slide-2')).toContainText('Hannah Okafor');
  });

  test('FAQ accordion toggles aria-expanded and its region independently', async ({ page }) => {
    await fresh(page);
    const q0 = page.getByTestId('faq-q-0'), q3 = page.getByTestId('faq-q-3');
    await expect(q0).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('faq-a-0')).toBeHidden();
    await q0.click();
    await expect(q0).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('faq-a-0')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Do I have to rewrite my tests?' })).toContainText('runs the tests you already have');
    await q3.focus();
    await page.keyboard.press('Enter');
    await expect(q3).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('faq-a-3')).toContainText('20% less');
    await expect(q0).toHaveAttribute('aria-expanded', 'true');
    await q0.click();
    await expect(q0).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('faq-a-0')).toBeHidden();
    await expect(q0).toHaveAttribute('aria-controls', 'faq-0');
  });

  test('cookie banner shows once and remembers accept or decline', async ({ page }) => {
    await fresh(page);
    const banner = page.getByTestId('cookie-banner');
    await expect(banner).toBeVisible();
    await page.getByTestId('cookie-decline').click();
    await expect(banner).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('greenline-consent'))).toBe('declined');
    await page.reload();
    await expect(page.getByTestId('hero-cta')).toBeVisible();
    await expect(banner).toBeHidden();
    await page.evaluate(() => localStorage.removeItem('greenline-consent'));
    await page.reload();
    await expect(banner).toBeVisible();
    await page.getByTestId('cookie-accept').click();
    await expect(banner).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('greenline-consent'))).toBe('accepted');
  });

  test('hero mock runs a full fake test run on the clock and restarts; reduced motion shows the result', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-23T10:00:00') });
    await page.clock.pauseAt(new Date('2026-09-23T10:00:01'));
    await page.goto(URL);
    await expect(page.getByTestId('m-passed')).toHaveText('0');
    await page.clock.runFor(2000);
    const mid = await page.evaluate(() => (window as any).__greenline.run);
    expect(mid.state.filter((s: string) => s === 'running').length).toBe(4);
    await expect(page.getByTestId('m-verdict')).toContainText('Running:');
    // step a second at a time until the run reports; it must finish within 15 s of fake time
    let seconds = 2;
    while (!(await page.evaluate(() => (window as any).__greenline.run.done)) && seconds < 15) { await page.clock.runFor(1000); seconds++; }
    expect(seconds).toBeLessThan(15);
    await expect(page.getByTestId('m-verdict')).toHaveText('All green: 24 passed, 1 flaky test quarantined and ticketed');
    await expect(page.getByTestId('m-passed')).toHaveText('23');
    await expect(page.getByTestId('m-flaky')).toHaveText('1');
    await expect(page.getByTestId('m-failed')).toHaveText('0');
    await page.clock.runFor(7000);
    await expect(page.getByTestId('run-no')).toHaveText('1483');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.getByTestId('m-verdict')).toHaveText('All green: 24 passed, 1 flaky test quarantined and ticketed');
    await expect(page.getByTestId('run-no')).toHaveText('1482');
  });
});
