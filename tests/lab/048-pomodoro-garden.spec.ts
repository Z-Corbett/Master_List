import { test, expect, Page } from '@playwright/test';

const URL = '/lab/048-pomodoro-garden.html';
const KEY = 'pomodoro-garden-v1';
const MIN = 60_000;

/** Fake clock at a fixed local time, paused, with empty storage. Optionally seed storage before the app boots. */
async function boot(page: Page, seed?: object, when = '2026-09-23T09:00:00') {
  await page.clock.install({ time: new Date(when) });
  await page.clock.pauseAt(new Date(new Date(when).getTime() + 1000));
  await page.goto(URL);
  await page.evaluate(([k, s]) => { localStorage.clear(); if (s) localStorage.setItem(k as string, JSON.stringify(s)); }, [KEY, seed ?? null] as const);
  await page.reload();
  await page.clock.runFor(300);
}
async function finish(page: Page, minutes: number) {
  await page.clock.fastForward(minutes * MIN);
  await page.clock.runFor(600);
}

test.describe('048 Pomodoro Garden', () => {
  test('a completed 25-minute focus session grows a bluebonnet, logs stats, chimes and moves to a break', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('time')).toHaveText('25:00');
    await expect(page.getByTestId('will-grow')).toHaveText('This session grows a bluebonnet');
    await expect(page.getByTestId('plant')).toHaveCount(0);
    await page.getByTestId('start').click();
    await expect(page.getByTestId('start')).toHaveText('Pause');
    await page.clock.runFor(61_500); // ticks every 250 ms, so allow one tick of slack
    await expect(page.getByTestId('time')).toHaveText('23:59');
    await finish(page, 24);
    await expect(page.getByTestId('plant')).toHaveCount(1);
    await expect(page.getByTestId('plant')).toHaveAttribute('data-species', 'bluebonnet');
    await expect(page.getByTestId('today-minutes')).toHaveText('25');
    await expect(page.getByTestId('today-sessions')).toHaveText('1');
    await expect(page.getByTestId('garden-total')).toHaveText('1 plant all-time');
    await expect(page.getByTestId('announce')).toHaveText('Focus session complete. A bluebonnet grew in your garden.');
    expect(await page.evaluate(() => (window as any).__pom.chimes)).toBe(1);
    // the gesture on Start created the audio context; no notifications are ever requested
    expect(await page.evaluate(() => (window as any).__pom.audio)).not.toBe('none');
    await expect(page.getByTestId('mode-short')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('time')).toHaveText('05:00');
    await expect(page.getByTestId('start')).toHaveText('Start'); // auto-start is off by default
    // finishing the break counts as a break, grows nothing, and returns to focus
    await page.getByTestId('start').click();
    await finish(page, 5);
    await expect(page.getByTestId('today-breaks')).toHaveText('1');
    await expect(page.getByTestId('plant')).toHaveCount(1);
    await expect(page.getByTestId('mode-focus')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('day-2026-09-23')).toHaveAttribute('data-count', '1');
  });

  test('species depend on session length, set in the settings', async ({ page }) => {
    await boot(page);
    const cases: Array<[number, string]> = [[15, 'paintbrush'], [40, 'pricklypear'], [50, 'liveoak'], [20, 'bluebonnet']];
    for (const [len, species] of cases) {
      await page.getByTestId('set-focus').fill(String(len));
      await page.getByTestId('set-focus').dispatchEvent('change');
      await page.getByTestId('mode-focus').click();
      await expect(page.getByTestId('time')).toHaveText(`${String(len).padStart(2, '0')}:00`);
      await page.getByTestId('start').click();
      await finish(page, len);
      await expect(page.getByTestId('plant').last()).toHaveAttribute('data-species', species);
    }
    await expect(page.getByTestId('plant')).toHaveCount(4);
    await expect(page.getByTestId('today-minutes')).toHaveText(String(15 + 40 + 50 + 20));
    // out-of-range settings are clamped
    await page.getByTestId('set-focus').fill('500');
    await page.getByTestId('set-focus').dispatchEvent('change');
    await expect(page.getByTestId('set-focus')).toHaveValue('120');
  });

  test('pausing freezes the countdown exactly; resume finishes on time', async ({ page }) => {
    await boot(page);
    await page.getByTestId('start').click();
    await page.clock.fastForward(10 * MIN);
    await page.clock.runFor(300);
    await expect(page.getByTestId('time')).toHaveText('15:00');
    await page.getByTestId('start').click();                 // pause
    await expect(page.getByTestId('start')).toHaveText('Resume');
    await expect(page.getByTestId('mode-label')).toHaveText('Focus · paused');
    await page.clock.fastForward(30 * MIN);
    await page.clock.runFor(300);
    await expect(page.getByTestId('time')).toHaveText('15:00');
    await expect(page.getByTestId('plant')).toHaveCount(0);
    await page.getByTestId('start').click();                 // resume
    await page.clock.fastForward(15 * MIN - 2000);
    await page.clock.runFor(300);
    await expect(page.getByTestId('plant')).toHaveCount(0);
    await expect(page.getByTestId('time')).toHaveText('00:02');
    await page.clock.runFor(2000);
    await expect(page.getByTestId('plant')).toHaveCount(1);
    // reset restores the full length without logging anything
    await page.getByTestId('start').click();
    await page.clock.runFor(90_000);
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('time')).toHaveText('05:00');
    await expect(page.getByTestId('today-breaks')).toHaveText('0');
  });

  test('every fourth focus session earns the long break; skipping grows nothing', async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page);
    for (let n = 1; n <= 4; n++) {
      await page.getByTestId('mode-focus').click();
      await page.getByTestId('start').click();
      await finish(page, 25);
      if (n < 4) {
        await expect(page.getByTestId('mode-short')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('cycle').locator('i.on')).toHaveCount(n);
        await page.getByTestId('skip').click();
        await expect(page.getByTestId('mode-focus')).toHaveAttribute('aria-pressed', 'true');
      }
    }
    await expect(page.getByTestId('mode-long')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('time')).toHaveText('15:00');
    await expect(page.getByTestId('cycle').locator('i.on')).toHaveCount(0);
    await expect(page.getByTestId('plant')).toHaveCount(4);
    // skipping a focus session does not plant anything
    await page.getByTestId('mode-focus').click();
    await page.getByTestId('start').click();
    await page.clock.runFor(60_000);
    await page.getByTestId('skip').click();
    await expect(page.getByTestId('plant')).toHaveCount(4);
    await expect(page.getByTestId('today-breaks')).toHaveText('0');
  });

  test('streaks, the calendar and a running timer all survive a reload', async ({ page }) => {
    const day = (d: string, h = 10) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();
    await boot(page, {
      settings: {},
      log: [
        { t: day('2026-09-15'), type: 'focus', min: 25 }, { t: day('2026-09-16'), type: 'focus', min: 25 },   // an older 2-day run
        { t: day('2026-09-21'), type: 'focus', min: 25 }, { t: day('2026-09-22'), type: 'focus', min: 25 }, { t: day('2026-09-22', 14), type: 'focus', min: 50 },
      ],
    });
    // yesterday counts until today is over
    await expect(page.getByTestId('streak')).toHaveText('2 days');
    await expect(page.getByTestId('day-2026-09-22')).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('day-2026-09-22')).toHaveAttribute('data-level', '2');
    await expect(page.getByTestId('day-2026-09-23')).toHaveClass(/today/);
    await expect(page.getByTestId('garden-total')).toHaveText('5 plants all-time');
    await expect(page.getByTestId('plant')).toHaveCount(0);       // today's bed is still empty

    await page.getByTestId('start').click();
    await page.clock.fastForward(10 * MIN);
    await page.clock.runFor(300);
    await page.reload();
    await page.clock.runFor(300);
    await expect(page.getByTestId('time')).toHaveText('15:00');
    await expect(page.getByTestId('start')).toHaveText('Pause');
    await finish(page, 15);
    await expect(page.getByTestId('streak')).toHaveText('3 days');
    await expect(page.getByTestId('best-streak')).toHaveText('3 days');
    await expect(page.getByTestId('week-minutes')).toHaveText(`${25 + 25 + 50 + 25} m`);
    await page.reload();
    await expect(page.getByTestId('plant')).toHaveCount(1);
    await expect(page.getByTestId('streak')).toHaveText('3 days');

    // clearing needs a second tap
    await page.getByTestId('clear-history').click();
    await expect(page.getByTestId('garden-total')).toHaveText('6 plants all-time');
    await page.getByTestId('clear-history').click();
    await expect(page.getByTestId('garden-total')).toHaveText('0 plants all-time');
    await expect(page.getByTestId('streak')).toHaveText('0 days');
  });
});
