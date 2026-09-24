import { test, expect, Page } from '@playwright/test';

const URL = '/lab/061-chapel-candles.html';
const KEY = 'chapel-candles-v1';

async function frozen(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-12-24T20:00:00') });
  await page.clock.pauseAt(new Date('2026-12-24T20:00:01'));
  await page.goto(URL);
}
async function lightSlot(page: Page, i: number, intention = '') {
  await page.getByTestId(`slot-${i}`).click();
  await expect(page.getByTestId('dialog')).toBeVisible();
  if (intention) await page.getByTestId('intent').fill(intention);
  await page.getByTestId('dlg-ok').click();
  await expect(page.getByTestId('dialog')).toBeHidden();
}
const flame = (page: Page, i: number) => page.evaluate((i) => { const c = (window as any).__chapel; c.frame(); const p = c.flamePoint(i); return c.pixel(p.x, p.y); }, i);
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);

test.describe('061 Chapel Candles', () => {
  test('lighting a candle with an intention keeps it on this device only, across a reload', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('privacy')).toContainText('Intentions stay on this device');
    await expect(page.getByTestId('slot-8')).toHaveAttribute('aria-label', /Candle 9, middle row: unlit/);
    await lightSlot(page, 8, 'For Grandma Rose, and safe travels home.');
    await expect(page.getByTestId('slot-8')).toHaveAttribute('aria-label', /Candle 9, middle row: lit, about 7 h 59 min left|about 8 h 00 min left/);
    await expect(page.getByTestId('d-intent')).toHaveText('For Grandma Rose, and safe travels home.');
    await expect(page.getByTestId('count')).toHaveText('1 candle burning.');
    const raw = JSON.parse((await stored(page))!);
    expect(raw.candles['8'].intention).toBe('For Grandma Rose, and safe travels home.');
    expect(raw.candles['8'].burnMs).toBe(8 * 3600e3);

    await page.reload();
    await expect(page.getByTestId('count')).toHaveText('1 candle burning.');
    await page.getByTestId('slot-8').click();
    await expect(page.getByTestId('dialog')).toBeHidden(); // a lit candle is not relit
    await expect(page.getByTestId('d-intent')).toHaveText('For Grandma Rose, and safe travels home.');
    await expect(page.getByTestId('b-out')).toBeVisible();
  });

  test('a one-hour candle burns down by the clock and goes out on its own', async ({ page }) => {
    await frozen(page);
    await page.getByTestId('hours').selectOption('1');
    await lightSlot(page, 0);
    await expect(page.getByTestId('d-meta')).toContainText('Lit just now · about 1 h 00 min left · 100% of the wax remains');
    const bright = await flame(page, 0);
    expect(bright[0]).toBeGreaterThan(200);
    expect(bright[1]).toBeGreaterThan(150);

    await page.clock.fastForward('30:00');
    expect(await page.evaluate(() => (window as any).__chapel.remaining(0))).toBeCloseTo(0.5, 3);
    await expect(page.getByTestId('d-meta')).toContainText('Lit 30 min ago · about 30 min left · 50% of the wax remains');
    await expect(page.getByTestId('slot-0')).toHaveAttribute('aria-label', /lit, about 30 min left/);

    await page.clock.fastForward('31:00');
    await expect(page.getByTestId('d-body')).toHaveText('This candle has burned all the way down.');
    await expect(page.getByTestId('slot-0')).toHaveAttribute('aria-label', /burned down/);
    await expect(page.getByTestId('count')).toHaveText('No candles lit.');
    expect(await page.evaluate(() => (window as any).__chapel.status(0))).toBe('spent');
    // a fresh candle can take its place
    await page.getByTestId('b-new').click();
    await expect(page.getByTestId('dialog')).toBeVisible();
    await page.getByTestId('dlg-ok').click();
    expect(await page.evaluate(() => (window as any).__chapel.remaining(0))).toBe(1);
  });

  test('extinguishing freezes the wax; relighting carries on from where it stopped', async ({ page }) => {
    await frozen(page);
    await lightSlot(page, 20, 'Thanksgiving');
    await page.clock.fastForward('02:00:00');
    await expect(page.getByTestId('d-meta')).toContainText('75% of the wax remains');
    await page.getByTestId('b-out').click();
    await expect(page.getByTestId('b-relight')).toBeVisible();
    await expect(page.getByTestId('slot-20')).toHaveAttribute('aria-label', /extinguished, 75% left/);
    const dark = await flame(page, 20);
    expect(dark[0]).toBeLessThan(140);

    await page.clock.fastForward('05:00:00');
    expect(await page.evaluate(() => (window as any).__chapel.remaining(20))).toBeCloseTo(0.75, 6);
    await expect(page.getByTestId('d-meta')).toContainText('75% left · about 6 h 00 min of burning');

    await page.getByTestId('b-relight').click();
    await expect(page.getByTestId('b-out')).toBeVisible();
    expect((await flame(page, 20))[0]).toBeGreaterThan(200);
    await page.clock.fastForward('01:00:00');
    expect(await page.evaluate(() => (window as any).__chapel.remaining(20))).toBeCloseTo(0.625, 3);
    await expect(page.getByTestId('d-meta')).toContainText('63% of the wax remains');
    const raw = JSON.parse((await stored(page))!);
    expect(raw.candles['20'].lit).toBe(true);
  });

  test('keyboard lighting, cancelling, forgetting an intention and clearing the device', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('slot-3').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('dialog')).toBeVisible();
    await expect(page.getByTestId('intent')).toBeFocused();
    await page.keyboard.type('Private words');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dialog')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__chapel.status(3))).toBe('unlit');
    await expect(page.getByTestId('slot-3')).toBeFocused();

    await lightSlot(page, 3, 'Private words');
    await expect(page.getByTestId('d-intent')).toBeVisible();
    await page.getByTestId('b-forget').click();
    await expect(page.getByTestId('d-intent')).toBeHidden();
    expect(JSON.parse((await stored(page))!).candles['3'].intention).toBe('');
    expect(await page.evaluate(() => (window as any).__chapel.status(3))).toBe('lit');

    await lightSlot(page, 4, 'Another');
    await page.getByTestId('b-clear').click();
    await expect(page.getByTestId('count')).toHaveText('No candles lit.');
    const raw = await stored(page);
    expect(raw === null || !raw.includes('Another')).toBe(true);
    expect(await page.evaluate(() => (window as any).__chapel.status(4))).toBe('unlit');
  });
});
