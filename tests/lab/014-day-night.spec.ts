import { test, expect, Page } from '@playwright/test';

const URL = '/lab/014-day-night.html';
const scene = (page: Page) => page.evaluate(() => {
  const s = (window as any).__scene;
  return { hour: s.hour, daylight: s.daylight, mode: s.mode, animating: s.animating, stars: s.starsVisible, flies: s.firefliesLit };
});

// Install fake timers at a fixed local time and pause them, so animation only advances via runFor/fastForward.
async function freeze(page: Page, at: Date) {
  await page.clock.install({ time: at });
  await page.clock.pauseAt(new Date(at.getTime() + 1000));
}

test.describe('Day & Night 2.0', () => {
  test('real-time mode paints a night sky from the local clock', async ({ page }) => {
    await freeze(page, new Date(2026, 8, 22, 22, 30));
    await page.goto(URL);
    await page.clock.runFor(500);
    const sw = page.getByRole('switch', { name: 'Daylight' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('mode-realtime')).toBeChecked();
    await expect(page.getByTestId('readout')).toContainText('Local 22:30');
    await expect(page.getByTestId('state-label')).toContainText('Night');
    const s = await scene(page);
    expect(s.daylight).toBeLessThan(0.05);
    expect(s.stars).toBeGreaterThan(60);
    expect(s.flies).toBeGreaterThan(0);
  });

  test('real-time mode at midday shows a daylight sky with no stars or fireflies', async ({ page }) => {
    await freeze(page, new Date(2026, 8, 22, 12, 45));
    await page.goto(URL);
    await page.clock.runFor(500);
    await expect(page.getByRole('switch', { name: 'Daylight' })).toHaveAttribute('aria-checked', 'true');
    const s = await scene(page);
    expect(s.daylight).toBeGreaterThan(0.95);
    expect(s.stars).toBe(0);
    expect(s.flies).toBe(0);
    await expect(page.getByTestId('sun')).not.toHaveAttribute('opacity', '0');
    await expect(page.getByTestId('moon')).toHaveAttribute('opacity', '0');
  });

  test('flipping the switch time-lapses through dawn into day and switches to manual mode', async ({ page }) => {
    await freeze(page, new Date(2026, 8, 22, 22, 30));
    await page.goto(URL);
    await page.clock.runFor(300);
    const sw = page.getByRole('switch', { name: 'Daylight' });
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('mode-manual')).toBeChecked();
    await expect(page.getByTestId('announcer')).toContainText('Daylight');

    // mid-transition: still animating, hour has moved forward past midnight towards dawn
    await page.clock.runFor(1200);
    const mid = await scene(page);
    expect(mid.animating).toBe(true);
    expect(mid.hour).toBeGreaterThan(0);
    expect(mid.hour).toBeLessThan(13);

    await page.clock.runFor(3000);
    const end = await scene(page);
    expect(end.animating).toBe(false);
    expect(end.hour).toBeCloseTo(13, 5);
    expect(end.daylight).toBeGreaterThan(0.95);
    expect(end.stars).toBe(0);
  });

  test('switch is keyboard operable with Space and Enter (reduced motion = instant)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await freeze(page, new Date(2026, 8, 22, 23, 0));
    await page.goto(URL);
    const sw = page.getByRole('switch', { name: 'Daylight' });
    await sw.focus();
    await expect(sw).toBeFocused();
    await page.keyboard.press('Space');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    let s = await scene(page);
    expect(s.animating).toBe(false);          // no time-lapse under reduced motion
    expect(s.daylight).toBeGreaterThan(0.95);
    await page.keyboard.press('Enter');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    s = await scene(page);
    expect(s.hour).toBeCloseTo(22.5, 5);
    expect(s.stars).toBeGreaterThan(60);
    await expect(page.getByTestId('announcer')).toContainText('Night');
  });

  test('real-time mode follows the clock through sunrise, and can be re-enabled after manual use', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await freeze(page, new Date(2026, 8, 22, 5, 30));
    await page.goto(URL);
    const sw = page.getByRole('switch', { name: 'Daylight' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    // go manual (day), then hand control back to the clock: still before sunrise → night again
    await sw.click();
    await expect(page.getByTestId('mode-manual')).toBeChecked();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Real time' }).check();
    await expect(page.getByTestId('mode-realtime')).toBeChecked();
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    await page.clock.fastForward('03:00:00');
    await page.clock.fastForward(10_000);
    await page.clock.runFor(100);
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('readout')).toContainText(/Local 08:3\d/);
    await expect(page.getByTestId('announcer')).toContainText('The sun has risen');
  });
});
